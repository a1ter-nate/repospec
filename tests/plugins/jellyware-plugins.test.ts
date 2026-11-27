import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineCi, evaluateCiGates, formatCiReport, renderGithubShowMeWorkflow } from "@repospec/ci";
import { defineExtractor, diffFactSets, queryFactsFromDb, scanRepo } from "@repospec/core";
import { ejectJellywareTarget, parseEjectTarget } from "@repospec/core/eject";
import { defineReport, renderReportHtml } from "@repospec/report";
import { defineShowMe, runShowMeBundle, type ShowMeManifest } from "@repospec/show-me";

describe("RepoSpec workspace packages, custom extractors, and jellyware UI/show-me/CI", () => {
  let tmpRoot = "";
  let repoDir = "";
  let showMeOutDir = "";
  let scanDbPath = "";
  let showMeManifest: ShowMeManifest | null = null;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-jelly-"));
    repoDir = path.join(tmpRoot, "repo");
    showMeOutDir = path.join(tmpRoot, "showme-out");
    scanDbPath = path.join(tmpRoot, "scan.sqlite");

    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "infra"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, ".repospec", "extractors"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, ".repospec", "rules"), { recursive: true });

    fs.writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "jelly-fixture", version: "1.0.0", main: "src/index.ts" }, null, 2),
    );
    fs.writeFileSync(
      path.join(repoDir, "src", "flags.ts"),
      'export function useFeatureFlag(name: string): boolean {\n  return name.length > 0;\n}\n',
    );
    fs.writeFileSync(
      path.join(repoDir, "src", "index.ts"),
      'import { useFeatureFlag } from "./flags.ts";\nexport const enabled = useFeatureFlag("base_flag");\n',
    );
    fs.writeFileSync(
      path.join(repoDir, "infra", "main.tf"),
      'data "google_project_iam_policy" "prod" {\n  project = "demo"\n}\n',
    );
    fs.writeFileSync(
      path.join(repoDir, ".repospec", "facts.yaml"),
      [
        "facts:",
        "  - kind: feature_flag",
        '    files: "src/**/*.ts"',
        "    match:",
        '      call: ["useFeatureFlag"]',
        "    extract:",
        '      key: "$arg0"',
        "      payload:",
        '        callee: "$callee"',
        "  - kind: tf_data",
        '    files: "infra/**/*.tf"',
        "    match:",
        '      hclBlock: ["data"]',
        "    extract:",
        '      key: "$type.$name"',
      ].join("\n"),
    );

    const coreImportPath = path.resolve(import.meta.dir, "../../packages/core/src/index.ts");
    const showMeImportPath = path.resolve(import.meta.dir, "../../packages/show-me/src/index.ts");
    fs.writeFileSync(
      path.join(repoDir, ".repospec", "extractors", "markers.ts"),
      [
        `import { defineExtractor } from ${JSON.stringify(coreImportPath)};`,
        "export default defineExtractor({",
        '  id: "custom.markers",',
        '  domain: "arch",',
        "  extract(kit) {",
        '    for (const f of kit.files("src/**/*.ts")) {',
        "      const sf = kit.tsSourceFile(f);",
        "      if (!sf) continue;",
        "      const text = kit.readText(f) ?? '';",
        "      if (text.includes('BETA_MODE')) {",
        "        kit.emitFact({ kind: 'beta_marker', key: f, file: f, line: 1, severity: 'warn', payload: { file: f } });",
        "        kit.emitMetric({ scopeKind: 'file', scopeId: f, name: 'has_beta', valueNum: 1 });",
        "      }",
        "    }",
        "  },",
        "});",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(repoDir, ".repospec", "rules", "01-flag-rule.sql"),
      [
        "-- @id: custom:beta-flag-warn",
        "-- @name: Beta Mode Marker Check",
        "-- @rung: R1",
        "-- @severity: warn",
        "-- @statement: Source files should not ship BETA_MODE markers.",
        "-- @why: Tracks custom facts in SQL invariants.",
        "-- @fix: Remove BETA_MODE before release.",
        "SELECT key AS subject, 'Beta marker in ' || file AS detail, file, line FROM facts WHERE kind = 'beta_marker';",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(repoDir, ".repospec", "show-me.ts"),
      [
        `import { defineShowMe } from ${JSON.stringify(showMeImportPath)};`,
        "export default defineShowMe({",
        "  triage(ctx, fallback) {",
        "    const base = fallback();",
        "    const added = ctx.factDiff('feature_flag').added;",
        "    if (added.length > 0) {",
        "      return {",
        "        ...base,",
        "        level: 'look',",
        "        attentionItems: [...base.attentionItems, { kind: 'contract', title: 'Custom flag added', detail: added.map((f) => f.key).join(', ') }],",
        "      };",
        "    }",
        "    return base;",
        "  },",
        "});",
      ].join("\n"),
    );

    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test Bot"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "chore: base commit"], { cwd: repoDir });

    fs.writeFileSync(
      path.join(repoDir, "src", "index.ts"),
      'import { useFeatureFlag } from "./flags.ts";\nexport const BETA_MODE = true;\nexport const enabled = useFeatureFlag("base_flag") && useFeatureFlag("checkout_v2");\n',
    );
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "feat: add checkout_v2 flag"], { cwd: repoDir });

    showMeManifest = await runShowMeBundle({
      repoDir,
      rangeArg: "HEAD~1..HEAD",
      outDir: showMeOutDir,
      top: 2,
      rank: "risk",
      format: "svg",
      focus: "auto",
      theme: "dark",
      includeTopFile: false,
      generateFn: (dir, dbPath) => scanRepo(dir, { dbPath }),
    });
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("@repospec/core extracts declarative facts, custom TS extractor facts, metrics, and runs custom SQL rules", async () => {
    const res = await scanRepo(repoDir, { dbPath: scanDbPath });
    expect(res.spec.repo.extractors).toContain("declarative.facts.v1");
    expect(res.spec.repo.extractors).toContain("custom.markers");

    const flags = res.spec.extensions.facts.filter((f) => f.kind === "feature_flag");
    expect(flags.map((f) => f.key).sort()).toEqual(["base_flag", "checkout_v2"]);

    const tfData = res.spec.extensions.facts.filter((f) => f.kind === "tf_data");
    expect(tfData.map((f) => f.key)).toContain("google_project_iam_policy.prod");

    const betas = res.spec.extensions.facts.filter((f) => f.kind === "beta_marker");
    expect(betas.length).toBe(1);
    expect(res.spec.extensions.metrics.some((m) => m.name === "has_beta" && m.valueNum === 1)).toBe(true);

    const customInv = res.spec.invariants.find((i) => i.id === "custom:beta-flag-warn");
    expect(customInv?.status).toBe("warn");
    expect(customInv?.violationCount).toBe(1);

    const db = new Database(scanDbPath, { readonly: true });
    try {
      const dbFlags = queryFactsFromDb(db, { kind: "feature_flag" });
      expect(dbFlags.length).toBe(2);
    } finally {
      db.close();
    }

    const diff = diffFactSets(
      flags.filter((f) => f.key === "base_flag"),
      flags,
      "feature_flag",
    );
    expect(diff.added.map((f) => f.key)).toEqual(["checkout_v2"]);
    expect(diff.unchangedCount).toBe(1);
  });

  test("@repospec/report allows full UI customization (theme, CSS, brand, briefing, extra tabs, full override)", async () => {
    const res = await scanRepo(repoDir, { dbPath: path.join(tmpRoot, "rep.sqlite") });
    const customReport = defineReport({
      title: "Acme Architecture Portal",
      brandLabel: "Acme Core",
      theme: { accent: "#ff5500", bg: "#05070c" },
      customCss: ".acme-banner { color: #ff5500; }",
      customBriefingHtml: (ctx) =>
        `<div class="acme-banner">Flags tracked: ${ctx.spec.extensions.facts.filter((f) => f.kind === "feature_flag").length}</div>`,
      extraTabs: [
        {
          id: "flags",
          label: "Feature Flags",
          renderHtml: (ctx) =>
            `<ul>${ctx.spec.extensions.facts
              .filter((f) => f.kind === "feature_flag")
              .map((f) => `<li>${f.key}</li>`)
              .join("")}</ul>`,
        },
      ],
    });

    const html = renderReportHtml(
      { spec: res.spec, digest: res.digest, inline: false, drilldown: res.drilldown },
      customReport,
    );
    expect(html).toContain("Acme Architecture Portal");
    expect(html).toContain("--accent:#ff5500;");
    expect(html).toContain(".acme-banner { color: #ff5500; }");
    expect(html).toContain("Flags tracked: 2");
    expect(html).toContain("Feature Flags");
    expect(html).toContain("checkout_v2");

    const fullOverride = defineReport({
      renderHtml: (ctx) => `<html><body><h1>Custom ${ctx.spec.repo.name}</h1></body></html>`,
    });
    const customHtml = renderReportHtml({ spec: res.spec, digest: res.digest, inline: false }, fullOverride);
    expect(customHtml).toBe("<html><body><h1>Custom jelly-fixture</h1></body></html>");
  });

  test("@repospec/show-me runs repo-local .repospec/show-me.ts hooks with custom factDiff", () => {
    expect(defineShowMe({}).triage).toBeUndefined();
    expect(showMeManifest).toBeDefined();
    const m = showMeManifest as ShowMeManifest;
    expect(m.reviewLevel).toBe("look");
    expect(m.attentionItems.some((a) => a.title === "Custom flag added" && a.detail.includes("checkout_v2"))).toBe(true);
    const md = fs.readFileSync(m.prCommentPath, "utf8");
    expect(md).toContain("Custom flag added");
    expect(md).toContain("checkout_v2");
  });

  test("@repospec/ci evaluates custom gates over facts and eject scaffolds clean starter files", async () => {
    const res = await scanRepo(repoDir, { dbPath: path.join(tmpRoot, "ci.sqlite") });
    const ciDef = defineCi({
      gates: [
        {
          id: "acme:no-beta",
          name: "Block beta markers",
          severity: "error",
          evaluate: (ctx) => {
            const hits = ctx.spec.extensions.facts.filter((f) => f.kind === "beta_marker");
            return { passed: hits.length === 0, message: `${hits.length} beta marker(s)` };
          },
        },
      ],
    });
    const evalRes = evaluateCiGates({ spec: res.spec, digest: res.digest }, ciDef);
    expect(evalRes.ok).toBe(false);
    expect(formatCiReport(evalRes, ciDef)).toContain("ERROR [acme:no-beta]");
    expect(renderGithubShowMeWorkflow({ rank: "contract", top: 2 })).toContain("--rank contract");

    const extPlugin = defineExtractor({
      id: "inline.check",
      extract(kit) {
        kit.emitFact({ kind: "ping", key: "ok", file: "src/index.ts", line: 1 });
      },
    });
    expect(extPlugin.id).toBe("inline.check");

    const ejectDir = path.join(tmpRoot, "eject-target");
    fs.mkdirSync(ejectDir, { recursive: true });
    expect(parseEjectTarget("all")).toBe("all");
    expect(parseEjectTarget("nope")).toBeNull();
    const ej = ejectJellywareTarget(ejectDir, "all");
    expect(ej.written.length).toBe(8);
    expect(fs.existsSync(path.join(ejectDir, ".repospec", "show-me.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ejectDir, ".repospec", "report.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ejectDir, ".repospec", "facts.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(ejectDir, ".repospec", "flows.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(ejectDir, ".repospec", "languages", "custom-language.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ejectDir, ".repospec", "extractors", "custom.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(ejectDir, ".repospec", "show-me.ts"), "utf8")).toContain('from "repospec/show-me"');
    expect(fs.readFileSync(path.join(ejectDir, ".repospec", "report.ts"), "utf8")).toContain('from "repospec/report"');
    expect(fs.readFileSync(path.join(ejectDir, ".repospec", "ci.ts"), "utf8")).toContain('from "repospec/ci"');
    expect(fs.readFileSync(path.join(ejectDir, ".repospec", "extractors", "custom.ts"), "utf8")).toContain('from "repospec/core"');
  });
});
