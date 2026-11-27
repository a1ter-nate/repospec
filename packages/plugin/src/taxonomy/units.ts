import fs from "node:fs";
import path from "node:path";
import type { LayerPolicy, UnitArchetype, UnitDescriptor } from "../schema.ts";
import { UNIT_DISCOVERY_HELPERS, workspaceNodeId, workspaceSlug } from "./unitHelpers.ts";

const {
  readTextSafe,
  expandDirGlobs,
  parseCargoSection,
  readNpmWorkspaceGlobs,
  inferTsArchetypeAndPolicy,
  isTemplateOrFixturePath,
  parsePyprojectPackageName,
} = UNIT_DISCOVERY_HELPERS;

function discoverCargoUnits(rootDir: string, allFiles: string[], units: Map<string, UnitDescriptor>): void {
  const cargoDirs = new Set<string>();
  if (allFiles.includes("Cargo.toml")) {
    const rootCargo = readTextSafe(path.join(rootDir, "Cargo.toml")) ?? "";
    const wsSection = parseCargoSection(rootCargo, "workspace");
    const membersMatch = wsSection.match(/members\s*=\s*\[([\s\S]*?)\]/);
    const memberPatterns = membersMatch?.[1]
      ? Array.from(membersMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1] ?? "").filter(Boolean)
      : [];
    const crateDirs = memberPatterns.length > 0 ? expandDirGlobs(rootDir, memberPatterns) : ["."];
    if (fs.existsSync(path.join(rootDir, "fuzz/Cargo.toml"))) crateDirs.push("fuzz");
    for (const d of crateDirs) cargoDirs.add(d);
  }
  for (const rel of allFiles) {
    if (rel.endsWith("/Cargo.toml") && !isTemplateOrFixturePath(rel)) {
      const cargoText = readTextSafe(path.join(rootDir, rel));
      if (cargoText && /\[package\]/.test(cargoText)) cargoDirs.add(path.posix.dirname(rel));
    }
  }
  for (const relDir of Array.from(cargoDirs).sort()) {
    const cargoRel = relDir === "." ? "Cargo.toml" : `${relDir}/Cargo.toml`;
    const cargoText = readTextSafe(path.join(rootDir, cargoRel));
    if (!cargoText) continue;
    const pkgSection = parseCargoSection(cargoText, "package");
    if (!pkgSection && relDir !== ".") continue;
    const crateName = pkgSection.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? path.posix.basename(relDir === "." ? rootDir : relDir);
    const binDir = path.join(rootDir, relDir, "src/bin");
    const hasBin =
      /\[\[bin\]\]/.test(cargoText) ||
      fs.existsSync(path.join(rootDir, relDir, "src/main.rs")) ||
      (fs.existsSync(binDir) && fs.readdirSync(binDir).some((f) => f.endsWith(".rs")));
    const isFuzzOrTest = relDir === "fuzz" || crateName.includes("fuzz") || crateName.includes("qa");
    const kind: "app" | "package" | "test_package" = isFuzzOrTest ? "test_package" : hasBin ? "app" : "package";
    const id = workspaceNodeId(kind, crateName);
    const binNames = Array.from(cargoText.matchAll(/\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/g)).map((m) => m[1] ?? "").filter(Boolean);
    const crateFiles = allFiles.filter((f) => (relDir === "." ? f.endsWith(".rs") : f.startsWith(`${relDir}/`) && f.endsWith(".rs")));
    const hasAxumOrHttp = /\b(?:axum|actix-web|warp|rocket|tonic|tauri)\b/.test(cargoText);
    const hasExplicitLayerDirs = crateFiles.some((f) => /\/src\/(?:routes|handlers|db|repositories|persistence|dao|services)\//.test(f));
    const archetype: UnitArchetype = isFuzzOrTest ? "test_suite" : hasAxumOrHttp ? "http_service" : hasBin ? "cli_worker" : "library_crate";
    const layerPolicy: LayerPolicy = hasExplicitLayerDirs ? "layered_backend" : "flat_library";
    units.set(id, {
      id,
      name: crateName,
      slug: crateName,
      dir: relDir,
      absDir: path.resolve(rootDir, relDir),
      manifestFile: cargoRel,
      ecosystem: "rust",
      kind,
      archetype,
      layerPolicy,
      external: false,
      entryFile: crateFiles.find((f) => f.endsWith("/src/lib.rs") || f.endsWith("/src/main.rs") || f === "src/lib.rs" || f === "src/main.rs") ?? null,
      targetFramework: null,
      bins: binNames,
    });
  }
}

function collectCsprojPaths(rootDir: string, allFiles: string[], hasRootManifest: boolean): { paths: Set<string>; sharedTfm: string | null } {
  const csprojPaths = new Set<string>(allFiles.filter((f) => f.endsWith(".csproj") && (!hasRootManifest || !isTemplateOrFixturePath(f))));
  for (const slnx of allFiles.filter((f) => f.endsWith(".slnx") && (!hasRootManifest || !isTemplateOrFixturePath(f)))) {
    const text = readTextSafe(path.join(rootDir, slnx));
    if (!text) continue;
    for (const m of text.matchAll(/<Project\s+Path="([^"]+\.csproj)"/gi)) {
      const norm = m[1]?.replace(/\\/g, "/");
      if (norm && fs.existsSync(path.resolve(rootDir, path.posix.dirname(slnx), norm))) csprojPaths.add(norm);
    }
  }
  for (const sln of allFiles.filter((f) => f.endsWith(".sln") && (!hasRootManifest || !isTemplateOrFixturePath(f)))) {
    const text = readTextSafe(path.join(rootDir, sln));
    if (!text) continue;
    for (const m of text.matchAll(/,\s*"([^"]+\.csproj)"/gi)) {
      const norm = m[1]?.replace(/\\/g, "/");
      if (norm && fs.existsSync(path.resolve(rootDir, path.posix.dirname(sln), norm))) csprojPaths.add(norm);
    }
  }
  const dirPropsText = readTextSafe(path.join(rootDir, "Directory.Build.props"));
  const sharedTfm = dirPropsText?.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i)?.[1]?.trim() ?? null;
  if (dirPropsText) {
    for (const m of dirPropsText.matchAll(/<ProjectReference\s+[^>]*Include="([^"]+\.csproj)"[^>]*>/gi)) {
      if (m[0] && m[1] && /OutputItemType="Analyzer"/i.test(m[0])) {
        const rawRef = m[1].replace(/\$\(MSBuildThisFileDirectory\)/g, "").replace(/\\/g, "/");
        const cands = [path.resolve(rootDir, rawRef), ...Array.from(csprojPaths).map((cp) => path.resolve(path.dirname(path.resolve(rootDir, cp)), rawRef))];
        const foundAbs = cands.find((c) => fs.existsSync(c));
        if (foundAbs) csprojPaths.add(path.relative(rootDir, foundAbs).replace(/\\/g, "/"));
      }
    }
  }
  return { paths: csprojPaths, sharedTfm };
}

function discoverCsharpUnits(rootDir: string, allFiles: string[], hasRootManifest: boolean, units: Map<string, UnitDescriptor>): void {
  const { paths: csprojPaths, sharedTfm } = collectCsprojPaths(rootDir, allFiles, hasRootManifest);
  const csUnitsTemp: UnitDescriptor[] = [];
  for (const relCsproj of Array.from(csprojPaths).sort()) {
    const absCsproj = path.resolve(rootDir, relCsproj);
    const text = readTextSafe(absCsproj);
    if (!text) continue;
    const projName = text.match(/<AssemblyName>([^<]+)<\/AssemblyName>/i)?.[1]?.trim() ?? path.basename(relCsproj, ".csproj");
    const isAnalyzer = /<IsRoslynComponent>\s*true\s*<\/IsRoslynComponent>/i.test(text);
    const isTest = /Microsoft\.NET\.Test\.Sdk|xunit|nunit|MSTest/i.test(text) || /\.Tests?$/i.test(projName);
    const isWeb = /Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(text);
    const isExe = /<OutputType>\s*(?:Exe|WinExe)\s*<\/OutputType>/i.test(text) || isWeb;
    const kind: "app" | "package" | "test_package" | "analyzer" = isAnalyzer ? "analyzer" : isTest ? "test_package" : isExe ? "app" : "package";
    const archetype: UnitArchetype = isAnalyzer ? "analyzer_plugin" : isTest ? "test_suite" : isWeb ? "http_service" : isExe ? "cli_worker" : "library_crate";
    csUnitsTemp.push({
      id: workspaceNodeId(kind, projName),
      name: projName,
      slug: projName,
      dir: path.posix.dirname(relCsproj.replace(/\\/g, "/")),
      absDir: path.dirname(absCsproj),
      manifestFile: relCsproj.replace(/\\/g, "/"),
      ecosystem: "csharp",
      kind,
      archetype,
      layerPolicy: "flat_library",
      external: relCsproj.startsWith(".."),
      entryFile: null,
      targetFramework: text.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i)?.[1]?.trim() ?? sharedTfm,
      bins: [],
    });
  }
  const hasCleanArch =
    csUnitsTemp.some((u) => /\.Domain$/i.test(u.name)) &&
    csUnitsTemp.some((u) => /\.(?:Application|Infrastructure|Api|Persistence)$/i.test(u.name));
  for (const u of csUnitsTemp) {
    if (hasCleanArch && u.kind !== "test_package" && u.kind !== "analyzer") u.layerPolicy = "layered_clean_arch";
    units.set(u.id, u);
  }
}

function discoverPythonUnits(rootDir: string, allFiles: string[], units: Map<string, UnitDescriptor>): void {
  const pyprojectFiles = allFiles.filter((f) => (f === "pyproject.toml" || f.endsWith("/pyproject.toml")) && !isTemplateOrFixturePath(f));
  for (const pyManifest of pyprojectFiles.sort()) {
    const relDir = pyManifest === "pyproject.toml" ? "." : path.posix.dirname(pyManifest);
    if (relDir !== "." && relDir.split("/").length > 2) continue;
    const text = readTextSafe(path.join(rootDir, pyManifest));
    if (!text) continue;
    const pkgName = parsePyprojectPackageName(text, relDir === "." ? path.basename(rootDir) : path.posix.basename(relDir));
    const relFiles = allFiles.filter((f) => (relDir === "." ? f.endsWith(".py") : f.startsWith(`${relDir}/`) && f.endsWith(".py")));
    const isHttp = /\b(?:fastapi|flask|django|starlette|uvicorn|aiohttp|litestar|sanic)\b/i.test(text);
    const isCli = /\[project\.scripts\]|\[tool\.poetry\.scripts\]|\b(?:click|typer|argparse)\b/i.test(text);
    const kind: "app" | "package" = isHttp || isCli || relDir === "." ? "app" : "package";
    const id = workspaceNodeId(kind, pkgName);
    if (!units.has(id)) {
      units.set(id, {
        id,
        name: pkgName,
        slug: workspaceSlug(pkgName),
        dir: relDir,
        absDir: path.resolve(rootDir, relDir),
        manifestFile: pyManifest,
        ecosystem: "python",
        kind,
        archetype: isHttp ? "http_service" : isCli ? "cli_worker" : "library_crate",
        layerPolicy: isHttp ? "layered_backend" : "flat_library",
        external: false,
        entryFile: relFiles.find((f) => /(?:^|\/)(?:main|app|cli|__main__)\.py$/.test(f)) ?? null,
        targetFramework: null,
        bins: [],
      });
    }
  }
}

function discoverNpmUnits(rootDir: string, allFiles: string[], units: Map<string, UnitDescriptor>): void {
  if (!allFiles.some((f) => f === "package.json" || f.endsWith("/package.json")) && !allFiles.includes("pnpm-workspace.yaml")) return;
  const globs = readNpmWorkspaceGlobs(rootDir);
  const candidateDirs = new Set<string>(globs.length > 0 ? expandDirGlobs(rootDir, globs) : expandDirGlobs(rootDir, ["apps/*", "packages/*"]));
  for (const rel of allFiles) {
    if (rel.endsWith("/package.json") && !isTemplateOrFixturePath(rel)) {
      const d = path.posix.dirname(rel);
      if (d.split("/").length <= 3 && ["apps", "packages", "tests"].includes(d.split("/")[0] ?? "")) candidateDirs.add(d);
    }
  }
  for (const relDir of Array.from(candidateDirs).sort()) {
    if (isTemplateOrFixturePath(`${relDir}/`)) continue;
    const absDir = path.join(rootDir, relDir);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
    const pkgPath = path.join(absDir, "package.json");
    if (fs.existsSync(path.join(absDir, "Cargo.toml")) && !fs.existsSync(pkgPath)) continue;
    const topDir = relDir.split("/")[0] ?? "packages";
    const relFiles = allFiles.filter((f) => f.startsWith(`${relDir}/`));
    const pkgText = readTextSafe(pkgPath);
    if (pkgText) {
      try {
        const pkg = JSON.parse(pkgText) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        if (!pkg.name) continue;
        const kind: "app" | "package" | "test_package" = topDir === "apps" ? "app" : topDir === "tests" ? "test_package" : "package";
        const id = workspaceNodeId(kind, pkg.name);
        const { archetype, layerPolicy } = inferTsArchetypeAndPolicy(kind, { ...pkg.dependencies, ...pkg.devDependencies }, relFiles);
        const entryCandidates = [`${relDir}/src/index.ts`, `${relDir}/src/index.tsx`, `${relDir}/index.ts`, `${relDir}/src/index.js`, `${relDir}/index.js`, `${relDir}/functions/index.ts`];
        units.set(id, {
          id,
          name: pkg.name,
          slug: workspaceSlug(pkg.name),
          dir: relDir,
          absDir,
          manifestFile: `${relDir}/package.json`,
          ecosystem: relFiles.some((f) => /\.(ts|tsx|mts|cts)$/.test(f)) ? "typescript" : "javascript",
          kind,
          archetype,
          layerPolicy,
          external: false,
          entryFile: entryCandidates.find((c) => allFiles.includes(c)) ?? null,
          targetFramework: null,
          bins: [],
        });
      } catch {
        continue;
      }
    } else if (topDir === "apps" && relFiles.length > 0) {
      if (!relFiles.some((f) => /\.(swift|pbxproj|kt|gradle|gradle\.kts)$/.test(f))) continue;
      const baseName = path.posix.basename(relDir);
      const id = workspaceNodeId("native_app", baseName);
      units.set(id, {
        id,
        name: baseName,
        slug: baseName,
        dir: relDir,
        absDir,
        manifestFile: relDir,
        ecosystem: "native",
        kind: "native_app",
        archetype: "frontend_app",
        layerPolicy: "layered_frontend",
        external: false,
        entryFile: null,
        targetFramework: null,
        bins: [],
      });
    }
  }
}

function discoverRootFallbackUnit(rootDir: string, allFiles: string[], units: Map<string, UnitDescriptor>): void {
  const nonTestChildDirs = Array.from(units.values()).filter((u) => u.dir !== "." && u.kind !== "test_package").map((u) => u.dir);
  if (Array.from(units.values()).some((u) => u.dir === ".")) return;
  const unclaimed = allFiles.filter((f) => {
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/.test(f) || isTemplateOrFixturePath(f)) return false;
    if (/^(?:tests?|__tests__|docs?|scripts)\//i.test(f) || /\.(?:test|spec|config)\.[a-zA-Z0-9]+$/i.test(f)) return false;
    return !nonTestChildDirs.some((d) => f.startsWith(`${d}/`));
  });
  if (nonTestChildDirs.length > 0 && unclaimed.length < 2) return;
  const rootPkgText = readTextSafe(path.join(rootDir, "package.json"));
  type RootPkgShape = { name?: string; bin?: string | Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  let rootPkg: RootPkgShape | null = null;
  if (rootPkgText) {
    try {
      rootPkg = JSON.parse(rootPkgText) as RootPkgShape;
    } catch {
      rootPkg = null;
    }
  }
  const hasTs = unclaimed.some((f) => /\.(?:ts|tsx|mts|cts)$/.test(f));
  const hasJs = unclaimed.some((f) => /\.(?:js|jsx|mjs|cjs)$/.test(f));
  const hasPy = unclaimed.some((f) => f.endsWith(".py"));
  if (!rootPkg && !hasTs && !hasJs && !hasPy) return;
  const rootName = rootPkg?.name ?? path.basename(rootDir);
  const id = workspaceNodeId("app", rootName);
  if (units.has(id)) return;
  const { archetype, layerPolicy } = inferTsArchetypeAndPolicy("app", { ...rootPkg?.dependencies, ...rootPkg?.devDependencies }, unclaimed);
  const entryCandidates = ["src/cli.ts", "src/index.ts", "src/main.ts", "src/index.tsx", "index.ts", "src/index.js", "index.js", "main.py", "app.py"];
  units.set(id, {
    id,
    name: rootName,
    slug: workspaceSlug(rootName),
    dir: ".",
    absDir: rootDir,
    manifestFile: rootPkg ? "package.json" : ".",
    ecosystem: hasTs ? "typescript" : hasJs ? "javascript" : hasPy ? "python" : "typescript",
    kind: "app",
    archetype,
    layerPolicy,
    external: false,
    entryFile: entryCandidates.find((c) => allFiles.includes(c)) ?? null,
    targetFramework: null,
    bins: rootPkg?.bin ? (typeof rootPkg.bin === "string" ? [rootName] : Object.keys(rootPkg.bin)) : [],
  });
}

export function discoverUnits(rootDir: string, allFiles: string[]): UnitDescriptor[] {
  const units = new Map<string, UnitDescriptor>();
  const hasRootManifest = allFiles.includes("package.json") || allFiles.includes("Cargo.toml") || allFiles.includes("pyproject.toml");
  discoverCargoUnits(rootDir, allFiles, units);
  discoverCsharpUnits(rootDir, allFiles, hasRootManifest, units);
  discoverPythonUnits(rootDir, allFiles, units);
  discoverNpmUnits(rootDir, allFiles, units);
  discoverRootFallbackUnit(rootDir, allFiles, units);
  return Array.from(units.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveUnitForFile(relFile: string, units: UnitDescriptor[]): UnitDescriptor | null {
  const sorted = [...units].filter((u) => !u.external && u.dir !== ".").sort((a, b) => b.dir.length - a.dir.length);
  for (const u of sorted) {
    if (relFile === u.dir || relFile.startsWith(`${u.dir}/`)) return u;
  }
  return units.find((u) => u.dir === ".") ?? null;
}
