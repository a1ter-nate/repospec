import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGenerateRepoSpec } from "../src/effect/pipeline.ts";
import { renderDiffDiagramSvg, renderSymbolCardSvg } from "../packages/show-me/src/internal/svgRenderer.ts";
import { classifyFile, detectTestedInPr, parseIacDiff } from "../packages/show-me/src/internal/fileClass.ts";
import { renderIacCardSvg } from "../packages/show-me/src/internal/iacCardSvg.ts";
import { buildCompactDeltaGraph } from "../packages/show-me/src/internal/layoutFit.ts";
import { buildShowMePrComment } from "../packages/show-me/src/internal/markdown.ts";
import {
  parseRankPreset,
  rankChangedFiles,
  rankDiffDiagrams,
  type RankingSpecSlice,
} from "../packages/show-me/src/internal/ranking.ts";
import { runShowMeBundle, type ShowMeManifest } from "../packages/show-me/src/internal/runner.ts";
import { selectShots } from "../packages/show-me/src/internal/shots.ts";
import { rasterizeSvgToPng } from "../packages/show-me/src/internal/svgPrimitives.ts";
import { triageCommitDiff } from "../packages/show-me/src/internal/triage.ts";
import type { CommitArchDiff } from "../src/studio/commitDiff.ts";
import type { DiffDiagramBundle } from "../src/studio/diffOverlay.ts";
import type { DrilldownIndex } from "../src/studio/drilldown.ts";

function mkBundle(id: string, label: string, nodeId: string, changedEdges: number): DiffDiagramBundle {
  return {
    id,
    label,
    changedCount: 1 + changedEdges,
    before: null,
    after: null,
    overlay: {
      id,
      title: label,
      subtitle: `${label} overlay`,
      category: id === "diff:runtime" ? "runtime" : "modules",
      rankdir: "LR",
      width: 600,
      height: 240,
      lanes: [{ id: "L0", label: "Core", x: 20, y: 20, w: 260, h: 180 }],
      nodes: [
        {
          id: nodeId,
          label,
          kind: "module",
          domain: "arch",
          shape: "box",
          x: 150,
          y: 110,
          w: 180,
          h: 54,
          lane: "L0",
          diffStatus: "modified",
          deltaLabel: "+50/-10",
        },
      ],
      edges: Array.from({ length: changedEdges }, (_, idx) => ({
        id: `e-${idx}`,
        from: nodeId,
        to: nodeId,
        kind: "imports",
        tier: "spine" as const,
        confidence: "observed" as const,
        points: [{ x: 150, y: 110 }, { x: 240, y: 110 }],
        diffStatus: "added" as const,
      })),
    },
  };
}

function makeSyntheticOverlay(nodeCount: number): DiffDiagramBundle["overlay"] {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    label: `mod_${i}`,
    kind: "module",
    domain: "arch" as const,
    shape: "box" as const,
    x: 120 + (i % 4) * 220,
    y: 90 + Math.floor(i / 4) * 90,
    w: 170,
    h: 54,
    lane: `L${i % 4}`,
    diffStatus: (i === 1 ? "modified" : "unchanged") as "modified" | "unchanged",
    deltaLabel: i === 1 ? "+28/-4" : undefined,
  }));
  const edges = [
    { id: "e01", from: "n0", to: "n1", kind: "imports", tier: "spine" as const, confidence: "observed" as const, points: [{ x: 205, y: 90 }, { x: 255, y: 90 }], diffStatus: "unchanged" as const },
    { id: "e12", from: "n1", to: "n2", kind: "imports", tier: "spine" as const, confidence: "observed" as const, points: [{ x: 425, y: 90 }, { x: 475, y: 90 }], diffStatus: "added" as const },
    { id: "e910", from: "n9", to: "n10", kind: "imports", tier: "spine" as const, confidence: "observed" as const, points: [{ x: 425, y: 270 }, { x: 475, y: 270 }], diffStatus: "unchanged" as const },
  ];
  const lanes = [0, 1, 2, 3].map((i) => ({ id: `L${i}`, label: `Tier ${i}`, x: 20 + i * 220, y: 40, w: 200, h: 420 }));
  return { id: "diff:modules:app", title: "App Modules", subtitle: "Synthetic", category: "modules", rankdir: "LR", width: 1600, height: 600, lanes, nodes, edges };
}

function mkModule(
  slug: string,
  file: string,
  fanIn: number,
  capabilities: Array<"FS" | "DB" | "HTTP" | "PROC" | "ENV" | "PURE">,
) {
  return {
    id: `mod:${slug}`,
    unitId: `u:${slug}`,
    unitName: slug,
    unitSlug: slug,
    name: slug,
    kind: "directory" as const,
    relPath: `src/${slug}`,
    language: "typescript",
    level: 1,
    role: "core" as const,
    depth: "deep" as const,
    fileCount: 1,
    lines: 120,
    exportCount: 2,
    fanIn,
    fanOut: 1,
    inTangle: false,
    tangleId: null,
    hasSubsystemDiagram: false,
    capabilities,
    topExports: [],
    files: [{ file, lines: 120, exports: 2, capabilities }],
  };
}

function makeFixtureCommitDiff(): { commitDiff: CommitArchDiff; headSpec: RankingSpecSlice; drilldown: DrilldownIndex } {
  const commitDiff: CommitArchDiff = {
    range: "aaa1111..bbb2222",
    baseRef: "origin/main",
    headRef: "HEAD",
    baseSha: "aaa1111",
    headSha: "bbb2222",
    commitSubject: "feat(billing): rewrite webhook handler",
    author: "dev",
    date: "2026-11-25",
    commitCount: 1,
    verdict: "caution",
    verdictSummary: "This change adds 1 new warning, touches 4 files (+220/-30).",
    kpis: {
      failures: { before: 0, after: 0, delta: 0 },
      warnings: { before: 0, after: 1, delta: 1 },
      coveragePct: { before: 70, after: 65, delta: -5 },
      files: { added: 1, modified: 3, deleted: 0, insertions: 220, deletions: 30 },
      nodes: { added: 0, modified: 3, removed: 0 },
      edges: { added: 2, removed: 0 },
    },
    surfaces: {
      endpointsAdded: ["POST /api/webhooks/stripe"],
      endpointsRemoved: [],
      externalAdded: ["stripe"],
      externalRemoved: [],
      envAdded: ["STRIPE_SECRET"],
      envRemoved: [],
      entitiesAdded: ["postgres:invoices"],
      entitiesRemoved: [],
    },
    findings: {
      introduced: [
        { invariantId: "sql:boundary", invariantName: "Boundary Check", severity: "warn", subject: "src/api/webhook.ts", detail: "New warning", file: "src/api/webhook.ts" },
      ],
      resolved: [],
      persistentCount: 0,
    },
    edgeChanges: { added: [{ from: "api", to: "core", kind: "imports" }], removed: [] },
    changedFiles: [
      { path: "src/churn/legacy.ts", status: "modified", insertions: 80, deletions: 25, unitSlug: "churn", moduleId: "mod:churn", blastRadius: 1, hunk: "@@ -10,4 +10,6 @@\n+export function hotFn() {\n+  return helper();\n+}" },
      { path: "src/core/kernel.ts", status: "modified", insertions: 12, deletions: 2, unitSlug: "core", moduleId: "mod:core", blastRadius: 22, hunk: "@@ -1,3 +1,4 @@\n+export function coreStep() { return 1; }" },
      { path: "src/api/webhook.ts", status: "modified", insertions: 28, deletions: 3, unitSlug: "api", moduleId: "mod:api", blastRadius: 2, hunk: "@@ -4,2 +4,4 @@\n+export function handleWebhook() { return true; }" },
      { path: "tests/webhook.test.ts", status: "added", insertions: 100, deletions: 0, unitSlug: "api", moduleId: null, blastRadius: 0, hunk: "@@ -0,0 +1,4 @@\n+handleWebhook();\n" },
    ],
    diagrams: [
      mkBundle("diff:modules:churn", "churn Modules", "mod:churn", 0),
      mkBundle("diff:modules:core", "core Modules", "mod:core", 2),
      mkBundle("diff:modules:api", "api Modules", "mod:api", 1),
    ],
  };

  const headSpec: RankingSpecSlice = {
    verification: {
      totalSourceFiles: 3,
      directlyTestedSourceFiles: 1,
      directTestCoveragePct: 65,
      realLineCoveragePct: 48,
      registeredGates: 0,
      ciWiredGates: 0,
      unwiredGateNames: [],
      invariantsPassed: 1,
      invariantsWarned: 1,
      invariantsFailed: 0,
      invariantsNa: 0,
    },
    modules: [
      mkModule("churn", "src/churn/legacy.ts", 1, ["PURE"]),
      mkModule("core", "src/core/kernel.ts", 22, ["PURE"]),
      mkModule("api", "src/api/webhook.ts", 2, ["HTTP", "DB"]),
    ],
  };

  const drilldown: DrilldownIndex = {
    files: [
      { p: "src/churn/legacy.ts", u: "churn", d: "src", l: 200, e: 2, c: ["PURE"], s: [["hotFn", "function", 10]], x: [], t: [], v: [], tc: 0, fc: 5, ch: 48, m: [["hotFn", "pub", "fn", 10, 14], ["helper", "priv", "fn", 20, 25]], k: [[0, 1, 11]], o: [[0, "Date.now", 12]] },
      { p: "src/core/kernel.ts", u: "core", d: "src", l: 120, e: 5, c: ["PURE"], s: [["coreStep", "function", 1]], x: [], t: [], v: [], tc: 1, fc: 92, ch: 2 },
      { p: "src/api/webhook.ts", u: "api", d: "src", l: 90, e: 2, c: ["HTTP", "DB"], s: [["handleWebhook", "function", 4]], x: ["stripe"], t: ["postgres:invoices"], v: ["STRIPE_SECRET"], tc: 0, ch: 6 },
    ],
    edges: [],
  };
  return { commitDiff, headSpec, drilldown };
}

describe("RepoSpec /show-me minimum-attention CI diff screenshots", () => {
  let tmpRoot = "";
  let outDir = "";
  let bundleManifest: ShowMeManifest | null = null;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-showme-"));
    const repoDir = path.join(tmpRoot, "repo");
    outDir = path.join(tmpRoot, "out");
    fs.mkdirSync(path.join(repoDir, "src", "core"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "src", "api"), { recursive: true });

    fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "showme-fixture", version: "1.0.0", main: "src/index.ts" }, null, 2));
    fs.writeFileSync(path.join(repoDir, "src", "core", "calc.ts"), "export function doubleValue(n: number): number {\n  return n * 2;\n}\n");
    fs.writeFileSync(path.join(repoDir, "src", "api", "handler.ts"), 'import { doubleValue } from "../core/calc.ts";\nexport function runHandler(x: number): number {\n  return doubleValue(x) + 1;\n}\n');
    fs.writeFileSync(path.join(repoDir, "src", "index.ts"), 'import { runHandler } from "./api/handler.ts";\nexport const result = runHandler(4);\n');

    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test Bot"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "chore: initial commit"], { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, "src", "core", "calc.ts"), "function clamp(n: number): number {\n  return Math.max(0, n);\n}\nexport function doubleValue(n: number): number {\n  return clamp(n) * 2;\n}\n");
    fs.writeFileSync(path.join(repoDir, "src", "api", "routes.ts"), 'import { runHandler } from "./handler.ts";\nexport function serveRoute(x: number): number {\n  return runHandler(x);\n}\n');
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "feat: add clamp and route handler"], { cwd: repoDir });

    bundleManifest = await runShowMeBundle({
      repoDir,
      rangeArg: "HEAD~1..HEAD",
      outDir,
      top: 2,
      rank: "risk",
      format: "both",
      focus: "auto",
      theme: "auto",
      includeTopFile: true,
      generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
    });
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("file classification, same-PR test pairing, and honest coverage avoid fake fallbacks", () => {
    expect(classifyFile("infra/edge/iam_allowlist.tf")).toBe("iac");
    expect(classifyFile("infra/edge/tests/iam_allowlist.tftest.hcl")).toBe("test");
    expect(classifyFile("apps/mcp-server/tests/fixtures/tool-list-wire.json")).toBe("fixture");
    expect(classifyFile("docs/contracts/mcp-read-api.md")).toBe("contract");

    const fx = makeFixtureCommitDiff();
    const tested = detectTestedInPr(fx.commitDiff.changedFiles, fx.drilldown);
    expect(tested.has("src/api/webhook.ts")).toBe(true);

    const ranked = rankChangedFiles({ ...fx, preset: "risk" });
    const webhook = ranked.find((f) => f.file.path === "src/api/webhook.ts");
    const testEntry = ranked.find((f) => f.file.path === "tests/webhook.test.ts");
    expect(webhook?.coverageKnown).toBe(false);
    expect(webhook?.coveragePct).toBeUndefined();
    expect(webhook?.testedInPr).toBe(true);
    expect(testEntry?.score).toBe(0);

    expect(parseRankPreset("hotspot")).toBe("hotspot");
    expect(rankChangedFiles({ ...fx, preset: "hotspot" })[0]?.file.path).toBe("src/churn/legacy.ts");
    expect(rankChangedFiles({ ...fx, preset: "blast" })[0]?.file.path).toBe("src/core/kernel.ts");
    expect(rankChangedFiles({ ...fx, preset: "contract" })[0]?.file.path).toBe("src/api/webhook.ts");
  });

  test("adding tests never inflates diagram risk score and IaC triage catches sensitive read-only checks", () => {
    const fx = makeFixtureCommitDiff();
    const withoutTest = {
      ...fx,
      commitDiff: {
        ...fx.commitDiff,
        changedFiles: fx.commitDiff.changedFiles.filter((f) => f.path !== "tests/webhook.test.ts"),
      },
    };
    const scoreWithTest = rankDiffDiagrams({ ...fx, preset: "risk", focusMode: "auto" }).find((d) => d.bundle.id === "diff:modules:api")?.score;
    const scoreWithoutTest = rankDiffDiagrams({ ...withoutTest, preset: "risk", focusMode: "auto" }).find((d) => d.bundle.id === "diff:modules:api")?.score;
    expect(scoreWithTest).toBe(scoreWithoutTest);

    const iacFiles = [
      { path: "infra/edge/iam_allowlist.tf", status: "added" as const, insertions: 28, deletions: 0, unitSlug: "platform", moduleId: "mod:infra", blastRadius: 0, hunk: '@@ -0,0 +1,8 @@\n+locals {\n+  x = 1\n+}\n+check "production_iam_allowlist" {\n+  data "google_project_iam_policy" "production" {\n+    project = "prod"\n+  }\n+}' },
      { path: "infra/edge/tests/iam_allowlist.tftest.hcl", status: "added" as const, insertions: 87, deletions: 0, unitSlug: "platform", moduleId: null, blastRadius: 0 },
    ];
    const iacDelta = parseIacDiff(iacFiles);
    expect(iacDelta.resourcesAdded).toBe(0);
    expect(iacDelta.dataAdded).toBe(1);
    expect(iacDelta.checksAdded).toBe(1);
    expect(iacDelta.sensitiveBlocks.length).toBe(2);
    expect(iacDelta.mutatingSensitiveBlocks.length).toBe(0);

    const iacCommit: CommitArchDiff = {
      ...fx.commitDiff,
      verdict: "safe",
      surfaces: { endpointsAdded: [], endpointsRemoved: [], externalAdded: [], externalRemoved: [], envAdded: [], envRemoved: [], entitiesAdded: [], entitiesRemoved: [] },
      findings: { introduced: [], resolved: [], persistentCount: 0 },
      edgeChanges: { added: [], removed: [] },
      changedFiles: iacFiles,
      diagrams: [mkBundle("diff:modules:platform", "platform Modules", "mod:infra", 0)],
    };
    const rankedIacFiles = rankChangedFiles({ commitDiff: iacCommit, headSpec: fx.headSpec, preset: "risk" });
    const rankedIacDiags = rankDiffDiagrams({ commitDiff: iacCommit, headSpec: fx.headSpec, preset: "risk", focusMode: "auto" });
    const triage = triageCommitDiff({ commitDiff: iacCommit, rankedDiagrams: rankedIacDiags, rankedFiles: rankedIacFiles });
    expect(triage.level).toBe("look");
    expect(triage.archetype).toBe("iac_sensitive");

    const plan = selectShots({ triage, rankedDiagrams: rankedIacDiags, rankedFiles: rankedIacFiles, top: 3, includeTopFile: true });
    expect(plan.heroShots.length).toBe(1);
    expect(plan.heroShots[0]?.kind).toBe("iac");
    expect(plan.suppressedShots.some((s) => s.id === "diff:modules:platform")).toBe(true);

    const iacSvg = renderIacCardSvg({ primaryFile: rankedIacFiles[0] as NonNullable<typeof rankedIacFiles[0]>, iacDelta, theme: "dark" });
    expect(iacSvg).toContain('xml:space="preserve"');
    expect(iacSvg).toContain("google_project_iam_policy");
    const iacPng = rasterizeSvgToPng(iacSvg, 2);
    expect([iacPng[0], iacPng[1], iacPng[2], iacPng[3]]).toEqual([137, 80, 78, 71]);
  });

  test("buildCompactDeltaGraph fits <= 840px, drops non-incident edges, and chromeless SVGs rasterize cleanly", () => {
    const big = makeSyntheticOverlay(18);
    const compact = buildCompactDeltaGraph(big, "auto");
    expect(compact.focused).toBe(true);
    expect(compact.hiddenNodes).toBe(15);
    expect(compact.overlay.width).toBeLessThanOrEqual(840);
    expect(compact.overlay.nodes.map((n) => n.id).sort()).toEqual(["n0", "n1", "n2"]);
    expect(compact.overlay.edges.map((e) => e.id).sort()).toEqual(["e01", "e12"]);

    const fx = makeFixtureCommitDiff();
    const rankedDiags = rankDiffDiagrams({ ...fx, preset: "risk", focusMode: "auto" });
    const rankedFiles = rankChangedFiles({ ...fx, preset: "risk" });
    const triage = triageCommitDiff({ commitDiff: fx.commitDiff, rankedDiagrams: rankedDiags, rankedFiles });

    const topDiag = rankedDiags[0] as NonNullable<typeof rankedDiags[0]>;
    const svg = renderDiffDiagramSvg({ ranked: topDiag, theme: "dark" });
    expect(svg).not.toContain("P0 CRITICAL");
    expect(svg).not.toContain("rank=risk");
    const png = rasterizeSvgToPng(svg, 2);
    expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);

    const legacy = rankedFiles.find((f) => f.file.path === "src/churn/legacy.ts") as NonNullable<typeof rankedFiles[0]>;
    const symSvg = renderSymbolCardSvg({ rankedFile: legacy, drillFile: fx.drilldown.files[0] as NonNullable<typeof fx.drilldown.files[0]>, theme: "light" });
    expect(symSvg).toContain("hotFn");
    expect(symSvg).not.toContain("KEY DIFF EXCERPT");
    const symPng = rasterizeSvgToPng(symSvg, 2);
    expect([symPng[0], symPng[1], symPng[2], symPng[3]]).toEqual([137, 80, 78, 71]);

    const md = buildShowMePrComment({
      repoName: "demo-app",
      commitDiff: fx.commitDiff,
      preset: "risk",
      triage,
      shots: [{ rank: 1, placement: "hero", kind: "diagram", id: topDiag.bundle.id, title: topDiag.bundle.label, altText: "Shape delta", score: topDiag.score, focused: true, hiddenNodes: 0, reasons: [], pngFile: "01-dark.png", lightPngFile: "01-light.png" }],
      topFiles: rankedFiles,
      imageBaseUrl: "https://example.com/assets",
    });
    const visibleBeforeDetails = md.split("<details>")[0] ?? md;
    expect(visibleBeforeDetails).not.toContain("P0");
    expect(visibleBeforeDetails).not.toContain("score ");
    expect(visibleBeforeDetails).not.toContain("rank=");
    expect(md).toContain("<picture>");
    expect(md).toContain("prefers-color-scheme: dark");
  });

  test("runShowMeBundle emits dark+light PNGs, triage metadata, and compact PR comment on a real git repo", () => {
    expect(bundleManifest).toBeDefined();
    const manifest = bundleManifest as ShowMeManifest;
    expect(["skim", "look", "scrutinize"]).toContain(manifest.reviewLevel);
    expect(manifest.shots.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(manifest.prCommentPath)).toBe(true);
    expect(fs.existsSync(manifest.manifestPath)).toBe(true);

    const pngHeaders = manifest.shots.flatMap((shot) => {
      const files = [shot.pngFile, shot.lightPngFile].filter((f): f is string => Boolean(f));
      return files.map((f) => {
        const bytes = fs.readFileSync(path.join(outDir, f));
        return [bytes[0], bytes[1], bytes[2], bytes[3]];
      });
    });
    expect(pngHeaders.length).toBeGreaterThanOrEqual(2);
    expect(pngHeaders.every((h) => h[0] === 137 && h[1] === 80 && h[2] === 78 && h[3] === 71)).toBe(true);

    const md = fs.readFileSync(manifest.prCommentPath, "utf8");
    expect(md).toContain("<!-- repospec-show-me -->");
    expect(md).toContain("<picture>");
    expect(md).toContain("<sub>RepoSpec · static structure only");
  });
});
