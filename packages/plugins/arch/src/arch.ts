import fs from "node:fs";
import path from "node:path";
import type { ExtractorPlugin, GraphFragment, RepoContext, SpecEdge, SpecNode, SpecRule } from "@repospec/plugin";
import { inferNodeRole, workspaceSlug } from "@repospec/plugin";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface TurboConfig {
  tags?: string[];
}

function readJsonSafe<T>(absPath: string): T | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readTextSafe(absPath: string): string | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function parseCargoSection(text: string, sectionName: string): string {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\[${escaped}\\]\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const nextHeader = rest.search(/^\[/m);
  return nextHeader >= 0 ? rest.slice(0, nextHeader) : rest;
}

export const archExtractor: ExtractorPlugin = {
  id: "arch.polyglot-manifest.v4",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const rules: SpecRule[] = [];

    const unitByName = new Map(ctx.units.map((u) => [u.name, u]));
    const unitByDir = new Map(ctx.units.map((u) => [u.dir, u]));
    const unitByAbsDir = new Map(ctx.units.map((u) => [u.absDir, u]));

    for (const u of ctx.units) {
      const relFiles = ctx.allFiles.filter((f) => (u.dir === "." ? true : f.startsWith(`${u.dir}/`)));
      const tags: string[] = [u.ecosystem, u.archetype];
      const meta: Record<string, string | number | boolean | string[] | null> = {
        ecosystem: u.ecosystem,
        dir: u.dir,
        slug: u.slug,
        archetype: u.archetype,
        layerPolicy: u.layerPolicy,
        totalFiles: relFiles.length,
      };

      if (u.ecosystem === "typescript" || u.ecosystem === "javascript") {
        const pkg = readJsonSafe<PackageJson>(path.join(u.absDir, "package.json"));
        const turbo = readJsonSafe<TurboConfig>(path.join(u.absDir, "turbo.json"));
        const scripts = Object.keys(pkg?.scripts ?? {}).sort();
        const hasOpenApi =
          scripts.some((s) => s.includes("openapi")) || relFiles.some((f) => f.endsWith("openapi.json"));
        const hasGeneratedClient =
          scripts.some((s) => s.includes("client:generate")) ||
          ((u.name.includes("client") || u.name.includes("sdk")) && relFiles.some((f) => f.includes("/generated/")));
        if (hasOpenApi) tags.push("openapi-producer");
        if (hasGeneratedClient) tags.push("openapi-consumer");
        if (turbo?.tags) tags.push(...turbo.tags);
        meta.hasOpenApi = hasOpenApi;
        meta.hasGeneratedClient = hasGeneratedClient;
        meta.turboTags = turbo?.tags ?? [];
      } else if (u.ecosystem === "python") {
        meta.sourceFiles = relFiles.filter((f) => f.endsWith(".py")).length;
        tags.push("python");
      } else if (u.ecosystem === "rust") {
        meta.crateIdent = u.name.replace(/-/g, "_");
        meta.bins = u.bins;
        meta.sourceFiles = relFiles.filter((f) => f.endsWith(".rs")).length;
        tags.push(u.kind === "app" ? "bin" : "lib");
      } else if (u.ecosystem === "csharp") {
        meta.targetFramework = u.targetFramework;
        if (u.targetFramework) tags.push(u.targetFramework);
      } else if (u.ecosystem === "native") {
        const hasSwift = relFiles.some((f) => /\.(swift|pbxproj)$/.test(f));
        const hasKotlin = relFiles.some((f) => /\.(kt|gradle|gradle\.kts)$/.test(f));
        const lang = hasSwift ? "swift" : hasKotlin ? "kotlin" : "native";
        meta.language = lang;
        tags.push(lang);
      }

      const group =
        u.ecosystem === "rust"
          ? u.kind === "test_package"
            ? "rust-test"
            : u.kind === "app"
              ? "rust-bin"
              : "rust-lib"
          : u.ecosystem === "python"
            ? u.kind === "app"
              ? "python-app"
              : "python-lib"
            : u.ecosystem === "csharp"
              ? u.kind === "analyzer"
                ? "dotnet-analyzer"
                : u.kind === "test_package"
                  ? "dotnet-test"
                  : u.kind === "app"
                    ? "dotnet-app"
                    : "dotnet-lib"
              : u.archetype === "frontend_app"
                ? "frontend"
                : u.dir === "."
                  ? "root"
                  : u.dir.split("/")[0] ?? "packages";

      nodes.push({
        id: u.id,
        domain: "arch",
        kind: u.kind,
        role: inferNodeRole(u.kind, meta, group),
        label: u.name,
        group,
        provenance: { file: u.manifestFile, line: 1 },
        tags,
        meta,
      });
    }

    for (const u of ctx.units) {
      if (u.ecosystem === "typescript" || u.ecosystem === "javascript") {
        const pkg = readJsonSafe<PackageJson>(path.join(u.absDir, "package.json"));
        if (!pkg) continue;
        const depGroups: Array<{ deps: Record<string, string> | undefined; scope: string }> = [
          { deps: pkg.dependencies, scope: "runtime" },
          { deps: pkg.devDependencies, scope: "dev" },
          { deps: pkg.peerDependencies, scope: "peer" },
        ];
        for (const { deps, scope } of depGroups) {
          if (!deps) continue;
          for (const depName of Object.keys(deps).sort()) {
            const target = unitByName.get(depName);
            if (!target || target.id === u.id) continue;
            edges.push({
              from: u.id,
              to: target.id,
              kind: "depends_on",
              label: scope,
              confidence: "observed",
              provenance: { file: u.manifestFile },
              evidence: [{ file: u.manifestFile, detail: `${scope} dependency on ${depName}` }],
            });
          }
        }
      } else if (u.ecosystem === "rust") {
        const cargoText = readTextSafe(path.join(ctx.rootDir, u.manifestFile));
        if (!cargoText) continue;
        const depSections: Array<{ section: string; scope: string }> = [
          { section: "dependencies", scope: "runtime" },
          { section: "dev-dependencies", scope: "dev" },
          { section: "build-dependencies", scope: "build" },
        ];
        for (const { section, scope } of depSections) {
          const body = parseCargoSection(cargoText, section);
          if (!body) continue;
          for (const line of body.split("\n")) {
            const pathMatch = line.match(/path\s*=\s*"([^"]+)"/);
            const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
            if (!keyMatch?.[1]) continue;
            let target = pathMatch?.[1]
              ? unitByDir.get(path.posix.normalize(path.posix.join(u.dir, pathMatch[1])))
              : undefined;
            if (!target) {
              const pkgRename = line.match(/package\s*=\s*"([^"]+)"/);
              const lookupName = pkgRename?.[1] ?? keyMatch[1];
              target = unitByName.get(lookupName);
            }
            if (target && target.id !== u.id) {
              const featMatch = line.match(/features\s*=\s*\[([^\]]+)\]/);
              const label = featMatch?.[1] ? `${scope} (${featMatch[1].replace(/["'\s]/g, "")})` : scope;
              edges.push({
                from: u.id,
                to: target.id,
                kind: "depends_on",
                label,
                confidence: "observed",
                provenance: { file: u.manifestFile },
                evidence: [{ file: u.manifestFile, detail: `${scope} Cargo dep on ${target.name}` }],
              });
            }
          }
        }
      } else if (u.ecosystem === "csharp") {
        const csprojText = readTextSafe(path.resolve(ctx.rootDir, u.manifestFile));
        if (!csprojText) continue;
        for (const m of csprojText.matchAll(/<ProjectReference\s+[^>]*Include="([^"]+\.csproj)"[^>]*>/gi)) {
          const fullTag = m[0] ?? "";
          const refInc = (m[1] ?? "").replace(/\\/g, "/");
          const targetAbsDir = path.dirname(path.resolve(u.absDir, refInc));
          const target = unitByAbsDir.get(targetAbsDir);
          if (!target || target.id === u.id) continue;
          const isAnalyzerRef = /OutputItemType="Analyzer"/i.test(fullTag) || /ReferenceOutputAssembly="false"/i.test(fullTag);
          edges.push({
            from: isAnalyzerRef ? target.id : u.id,
            to: isAnalyzerRef ? u.id : target.id,
            kind: isAnalyzerRef ? "analyzes" : "depends_on",
            label: isAnalyzerRef ? "analyzes" : "ref",
            confidence: "observed",
            provenance: { file: u.manifestFile },
            evidence: [{ file: u.manifestFile, detail: isAnalyzerRef ? `Roslyn analyzer ${target.name}` : `ProjectReference to ${target.name}` }],
          });
        }
      }
    }

    const rootCargo = readTextSafe(path.join(ctx.rootDir, "Cargo.toml"));
    if (rootCargo) {
      const rustLints = parseCargoSection(rootCargo, "workspace.lints.rust");
      const clippyLints = parseCargoSection(rootCargo, "workspace.lints.clippy");
      if (rustLints || clippyLints) {
        const lintId = "rule:config:cargo-lints";
        const forbidUnsafe = /unsafe_code\s*=\s*"forbid"/.test(rustLints);
        const lintKeys = Array.from(`${rustLints}\n${clippyLints}`.matchAll(/^\s*([a-z0-9_]+)\s*=/gm))
          .map((m) => m[1] ?? "")
          .filter(Boolean);
        nodes.push({
          id: lintId,
          domain: "rules",
          kind: "linter_config",
          role: "rule",
          label: "Cargo [workspace.lints]",
          group: "static_config",
          provenance: { file: "Cargo.toml", line: 1 },
          tags: ["R1", "rust", ...(forbidUnsafe ? ["forbid-unsafe"] : [])],
          meta: { forbidUnsafe, lintCount: lintKeys.length },
        });
        rules.push({
          id: lintId,
          name: "cargo-workspace-lints",
          category: "lint_ratchet",
          enforcement: "static",
          rung: "R1",
          statement: `Cargo workspace declares ${lintKeys.length} rustc/clippy lint policies (unsafe_code=${forbidUnsafe ? "forbid" : "configured"})`,
          targets: ctx.units.filter((u) => u.ecosystem === "rust").map((u) => u.id),
          provenance: { file: "Cargo.toml", line: 1 },
        });
      }
    }

    const dirPropsText = readTextSafe(path.join(ctx.rootDir, "Directory.Build.props"));
    if (dirPropsText) {
      const warnErr = /<TreatWarningsAsErrors>\s*true\s*<\/TreatWarningsAsErrors>/i.test(dirPropsText);
      const nullable = /<Nullable>\s*enable\s*<\/Nullable>/i.test(dirPropsText);
      if (warnErr || nullable) {
        const ruleId = "rule:config:directory-build-props";
        nodes.push({
          id: ruleId,
          domain: "rules",
          kind: "linter_config",
          role: "rule",
          label: "Directory.Build.props",
          group: "static_config",
          provenance: { file: "Directory.Build.props", line: 1 },
          tags: ["R1", "csharp"],
          meta: { treatWarningsAsErrors: warnErr, nullable },
        });
        rules.push({
          id: ruleId,
          name: "dotnet-strict-build",
          category: "lint_ratchet",
          enforcement: "static",
          rung: "R1",
          statement: `Directory.Build.props enforces TreatWarningsAsErrors=${String(warnErr)}, Nullable=${String(nullable)}`,
          targets: ctx.units.filter((u) => u.ecosystem === "csharp" && u.kind !== "analyzer").map((u) => u.id),
          provenance: { file: "Directory.Build.props", line: 1 },
        });
      }

      for (const m of dirPropsText.matchAll(/<ProjectReference\s+[^>]*Include="([^"]+\.csproj)"[^>]*>/gi)) {
        if (m[0] && m[1] && /OutputItemType="Analyzer"/i.test(m[0])) {
          const rawRef = m[1].replace(/\$\(MSBuildThisFileDirectory\)/g, "").replace(/\\/g, "/");
          for (const u of ctx.units) {
            if (u.ecosystem !== "csharp") continue;
            const fromUnit = path.dirname(path.resolve(u.absDir, rawRef));
            const fromRoot = path.dirname(path.resolve(ctx.rootDir, rawRef));
            const analyzer = unitByAbsDir.get(fromUnit) ?? unitByAbsDir.get(fromRoot);
            if (!analyzer || analyzer.id === u.id) continue;
            edges.push({
              from: analyzer.id,
              to: u.id,
              kind: "analyzes",
              label: "analyzes",
              confidence: "observed",
              provenance: { file: "Directory.Build.props" },
              evidence: [{ file: "Directory.Build.props", detail: `Global Roslyn analyzer ${analyzer.name}` }],
            });
          }
        }
      }
    }

    if (nodes.length === 0) {
      nodes.push({
        id: `arch:app:${ctx.repoName}`,
        domain: "arch",
        kind: "app",
        role: "service",
        label: ctx.repoName,
        group: "root",
        provenance: { file: "." },
        tags: [ctx.ecosystem, "single-unit"],
        meta: { ecosystem: ctx.ecosystem, dir: ".", slug: workspaceSlug(ctx.repoName), totalFiles: ctx.allFiles.length },
      });
    }

    return { nodes, edges, rules };
  },
};
