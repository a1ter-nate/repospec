import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { auditDirectory, collectTsFiles, REPOSPEC_ROOT, resolveRelativeImport } from "./contract.ts";

const BUILTIN_MANIFEST_ALLOWLIST = new Set([
  "packages/core/src/plugin/internal.ts",
  "packages/core/src/builtins.ts",
]);

const REQUIRED_PLUGIN_GROUPS = [
  "lang-typescript",
  "lang-rust",
  "lang-python",
  "lang-csharp",
  "arch",
  "ci",
  "iac",
  "testing",
  "surfaces",
  "flows",
  "module-atlas",
  "passport",
  "sdk-gen",
  "studio",
  "show-me",
] as const;

const REQUIRED_DOMAINS = [
  "language",
  "extractor",
  "linker",
  "rule",
  "query",
  "diagram",
  "studio",
  "showMe",
  "ci",
  "command",
] as const;

const MAX_CORE_KERNEL_LINES = 8_000;

function readRootPackageJson(): {
  workspaces?: string[] | { packages?: string[] };
  exports?: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(REPOSPEC_ROOT, "package.json"), "utf8")) as {
    workspaces?: string[] | { packages?: string[] };
    exports?: Record<string, string>;
  };
}

function listWorkspacePackageDirs(): string[] {
  const pkgRoot = path.join(REPOSPEC_ROOT, "packages");
  if (!fs.existsSync(pkgRoot)) return [];
  const dirs: string[] = [];
  for (const entry of fs.readdirSync(pkgRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = `packages/${entry.name}`;
    if (entry.name === "plugins") {
      const pluginsRoot = path.join(pkgRoot, "plugins");
      for (const sub of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
        if (sub.isDirectory()) dirs.push(`packages/plugins/${sub.name}`);
      }
    } else {
      dirs.push(rel);
    }
  }
  return dirs.sort();
}

describe("Law 1: Tight Core & Real Package Boundary (No Barrel Illusion)", () => {
  test("dedicated packages/plugin SDK package exists and is exported from root package.json", () => {
    const pkgJson = readRootPackageJson();
    expect(fs.existsSync(path.join(REPOSPEC_ROOT, "packages/plugin/package.json"))).toBe(true);
    expect(fs.existsSync(path.join(REPOSPEC_ROOT, "packages/plugin/src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(REPOSPEC_ROOT, "packages/plugin/src/effect/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(REPOSPEC_ROOT, "packages/plugin/src/promise/adapter.ts"))).toBe(true);
    expect(pkgJson.exports?.["./plugin"]).toBeDefined();
    expect(pkgJson.exports?.["./plugin/effect"]).toBeDefined();
  });

  test("no package under packages/* reaches backward into legacy src/** (kills barrel illusion)", () => {
    const violations: string[] = [];
    for (const pkgDir of listWorkspacePackageDirs()) {
      const audit = auditDirectory(REPOSPEC_ROOT, pkgDir);
      for (const edge of audit.imports) {
        const resolved = resolveRelativeImport(edge.fromRel, edge.specifier);
        if (resolved === "src" || resolved?.startsWith("src/")) {
          violations.push(`${edge.fromRel}:${edge.line} imports legacy monolith "${edge.specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("core kernel does not import feature plugins outside the single built-in manifest", () => {
    const violations: string[] = [];
    const coreAudit = auditDirectory(REPOSPEC_ROOT, "packages/core/src");
    for (const edge of coreAudit.imports) {
      if (BUILTIN_MANIFEST_ALLOWLIST.has(edge.fromRel)) continue;
      const resolved = resolveRelativeImport(edge.fromRel, edge.specifier);
      const importsFeaturePlugin =
        resolved?.startsWith("packages/plugins/") ||
        edge.specifier.startsWith("@repospec/plugin-") ||
        edge.specifier === "@repospec/flows" ||
        edge.specifier === "@repospec/show-me" ||
        edge.specifier === "@repospec/report" ||
        edge.specifier === "@repospec/ci";
      if (importsFeaturePlugin) {
        violations.push(`${edge.fromRel}:${edge.line} imports feature plugin "${edge.specifier}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("packages/plugin SDK has zero imports from packages/core or packages/plugins", () => {
    const sdkAudit = auditDirectory(REPOSPEC_ROOT, "packages/plugin/src");
    expect(sdkAudit.files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const edge of sdkAudit.imports) {
      const resolved = resolveRelativeImport(edge.fromRel, edge.specifier);
      const target = resolved ?? edge.specifier;
      if (
        target.startsWith("packages/core") ||
        target.startsWith("packages/plugins") ||
        target.startsWith("@repospec/core") ||
        target.startsWith("@repospec/plugin-")
      ) {
        violations.push(`${edge.fromRel}:${edge.line} leaks upward dependency "${edge.specifier}"`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("Law 2: Dogfooded Built-In Plugins (Zero Privileged Backdoors)", () => {
  test("packages/plugins/* workspace holds real dogfooded first-party plugins for every major feature", () => {
    const pkgJson = readRootPackageJson();
    const workspaceList = Array.isArray(pkgJson.workspaces)
      ? pkgJson.workspaces
      : (pkgJson.workspaces?.packages ?? []);
    expect(workspaceList).toContain("packages/plugins/*");

    const pluginsRoot = path.join(REPOSPEC_ROOT, "packages/plugins");
    const present = fs.existsSync(pluginsRoot)
      ? fs
          .readdirSync(pluginsRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];

    const missing = REQUIRED_PLUGIN_GROUPS.filter(
      (req) => !present.some((dir) => dir === req || dir.includes(req)),
    );
    expect(missing).toEqual([]);
  });

  test("built-in plugins under packages/plugins/* never import packages/core internals (dogfood parity)", () => {
    const pluginsAudit = auditDirectory(REPOSPEC_ROOT, "packages/plugins");
    expect(pluginsAudit.files.length).toBeGreaterThanOrEqual(REQUIRED_PLUGIN_GROUPS.length);

    const violations: string[] = [];
    for (const edge of pluginsAudit.imports) {
      const resolved = resolveRelativeImport(edge.fromRel, edge.specifier);
      const target = resolved ?? edge.specifier;
      if (
        target.startsWith("packages/core/src/internal") ||
        target.startsWith("src/") ||
        target.includes("/core/src/internal")
      ) {
        violations.push(`${edge.fromRel}:${edge.line} bypasses public SDK via "${edge.specifier}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("every built-in plugin defines itself via Plugin.define / definePlugin", () => {
    const pluginsRoot = path.join(REPOSPEC_ROOT, "packages/plugins");
    const dirs = fs.existsSync(pluginsRoot)
      ? fs
          .readdirSync(pluginsRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];
    expect(dirs.length).toBeGreaterThanOrEqual(REQUIRED_PLUGIN_GROUPS.length);

    const missingDefine: string[] = [];
    for (const dir of dirs) {
      const files = collectTsFiles(REPOSPEC_ROOT, `packages/plugins/${dir}`);
      const combined = files.map((f) => fs.readFileSync(path.join(REPOSPEC_ROOT, f), "utf8")).join("\n");
      const usesDefine = combined.match(/\b(?:Plugin\.define|definePlugin|defineEffect)\s*\(/) !== null;
      if (!usesDefine) missingDefine.push(dir);
    }
    expect(missingDefine).toEqual([]);
  });
});

describe("Law 3 & 4: Replayable State, Pre/Post/Guarded Boot & No Singleton Overrides", () => {
  test("core implements replayable State.create with group isolation and batching", () => {
    const coreFiles = collectTsFiles(REPOSPEC_ROOT, "packages/core/src");
    const stateFiles = coreFiles.filter((f) => f.match(/(?:^|\/)state\.ts$/) !== null);
    expect(stateFiles.length).toBeGreaterThanOrEqual(1);
    const combined = stateFiles.map((f) => fs.readFileSync(path.join(REPOSPEC_ROOT, f), "utf8")).join("\n");
    expect(combined).toContain("transform");
    expect(combined).toContain("batch");
    expect(combined).toContain("group");
  });

  test("plugin SDK exposes unified replayable transforms for every core domain", () => {
    const sdkFiles = collectTsFiles(REPOSPEC_ROOT, "packages/plugin/src");
    const combined = sdkFiles.map((f) => fs.readFileSync(path.join(REPOSPEC_ROOT, f), "utf8")).join("\n");
    const missingDomains = REQUIRED_DOMAINS.filter(
      (domain) => combined.match(new RegExp(`\\b${domain}\\b`)) === null,
    );
    expect(missingDomains).toEqual([]);
  });

  test("core eliminates legacy singleton override slots (reportOverride/showMeOverride/ciOverride) and hardcoded DEFAULT_PLUGINS", () => {
    const coreFiles = [
      ...collectTsFiles(REPOSPEC_ROOT, "packages/core/src"),
      ...collectTsFiles(REPOSPEC_ROOT, "src"),
    ];
    const violations: string[] = [];
    for (const rel of coreFiles) {
      const text = fs.readFileSync(path.join(REPOSPEC_ROOT, rel), "utf8");
      if (text.match(/\breportOverride\b|\bshowMeOverride\b|\bciOverride\b/) !== null) {
        violations.push(`${rel}: retains legacy singleton override slot`);
      }
      if (text.match(/\bconst\s+DEFAULT_PLUGINS\s*:/) !== null) {
        violations.push(`${rel}: retains hardcoded non-removable DEFAULT_PLUGINS array`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("built-in plugin manifest enforces pre/post boot ordering and guarded policy set", () => {
    const manifestPath = Array.from(BUILTIN_MANIFEST_ALLOWLIST).find((rel) =>
      fs.existsSync(path.join(REPOSPEC_ROOT, rel)),
    );
    expect(manifestPath).toBeDefined();
    if (!manifestPath) throw new Error("Missing core built-in plugin manifest (packages/core/src/plugin/internal.ts)");
    const text = fs.readFileSync(path.join(REPOSPEC_ROOT, manifestPath), "utf8");
    expect(text).toContain("guarded");
    expect(text.match(/\bpre\b/) !== null).toBe(true);
    expect(text.match(/\bpost\b/) !== null).toBe(true);
  });
});

describe("Law 9: Core Kernel Tightness Budget", () => {
  test.each([{ maxLines: MAX_CORE_KERNEL_LINES }])(
    "core kernel (packages/core/src + packages/plugin/src) stays tight (<= $maxLines LOC) and language-agnostic",
    ({ maxLines }) => {
      const coreAudit = auditDirectory(REPOSPEC_ROOT, "packages/core/src");
      const sdkAudit = auditDirectory(REPOSPEC_ROOT, "packages/plugin/src");
      const totalKernelLines = coreAudit.totalLines + sdkAudit.totalLines;
      expect(coreAudit.files.length).toBeGreaterThan(0);
      expect(sdkAudit.files.length).toBeGreaterThan(0);
      expect(totalKernelLines).toBeLessThanOrEqual(maxLines);

    const leakedParsers = coreAudit.files.filter(
      (f) => f.match(/(?:rustAst|csharpAst|pythonAst|codeAst|studioClient|flowsClient|entityJourney)/i) !== null,
    );
    expect(leakedParsers).toEqual([]);

      const legacySrcAudit = auditDirectory(REPOSPEC_ROOT, "src");
      expect(legacySrcAudit.totalLines).toBeLessThanOrEqual(500);
    },
  );
});
