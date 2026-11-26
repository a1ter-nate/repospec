import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGenerateRepoSpec } from "../src/effect/pipeline.ts";
import { buildShowMePrComment } from "../src/internal/showme/markdown.ts";
import {
  cropFocusedSubgraph,
  parseRankPreset,
  rankChangedFiles,
  rankDiffDiagrams,
  type RankingSpecSlice,
} from "../src/internal/showme/ranking.ts";
import { runShowMeBundle, type ShowMeManifest } from "../src/internal/showme/runner.ts";
import { rasterizeSvgToPng, renderDiffDiagramSvg, renderTopFileCardSvg } from "../src/internal/showme/svgRenderer.ts";
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
        points: [
          { x: 150, y: 110 },
          { x: 240, y: 110 },
        ],
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
  return { id: "diff:modules:app", title: "App Modules", subtitle: "Synthetic modules overlay", category: "modules", rankdir: "LR", width: 960, height: 480, lanes, nodes, edges };
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

function makeFixtureCommitDiff(): {
  commitDiff: CommitArchDiff;
  headSpec: RankingSpecSlice;
  drilldown: DrilldownIndex;
} {
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
    verdictSummary: "This change adds 1 new warning, touches 3 files (+120/-30).",
    kpis: {
      failures: { before: 0, after: 0, delta: 0 },
      warnings: { before: 0, after: 1, delta: 1 },
      coveragePct: { before: 70, after: 65, delta: -5 },
      files: { added: 0, modified: 3, deleted: 0, insertions: 120, deletions: 30 },
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
        {
          invariantId: "sql:boundary",
          invariantName: "Boundary Check",
          severity: "warn",
          subject: "src/api/webhook.ts",
          detail: "New warning",
          file: "src/api/webhook.ts",
        },
      ],
      resolved: [],
      persistentCount: 0,
    },
    edgeChanges: { added: [{ from: "api", to: "core", kind: "imports" }], removed: [] },
    changedFiles: [
      {
        path: "src/churn/legacy.ts",
        status: "modified",
        insertions: 80,
        deletions: 25,
        unitSlug: "churn",
        moduleId: "mod:churn",
        blastRadius: 1,
        hunk: "@@ -10,4 +10,6 @@\n+export function hotFn() {\n+  return helper();\n+}",
      },
      {
        path: "src/core/kernel.ts",
        status: "modified",
        insertions: 12,
        deletions: 2,
        unitSlug: "core",
        moduleId: "mod:core",
        blastRadius: 22,
        hunk: "@@ -1,3 +1,4 @@\n+export function coreStep() { return 1; }",
      },
      {
        path: "src/api/webhook.ts",
        status: "modified",
        insertions: 28,
        deletions: 3,
        unitSlug: "api",
        moduleId: "mod:api",
        blastRadius: 2,
        hunk: "@@ -4,2 +4,4 @@\n+export function handleWebhook() { return true; }",
      },
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
      realLineCoveragePct: 65,
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
      {
        p: "src/churn/legacy.ts",
        u: "churn",
        d: "src",
        l: 200,
        e: 2,
        c: ["PURE"],
        s: [["hotFn", "function", 10]],
        x: [],
        t: [],
        v: [],
        tc: 0,
        fc: 5,
        ch: 48,
        m: [
          ["hotFn", "pub", "fn", 10, 14],
          ["helper", "priv", "fn", 20, 25],
        ],
        k: [[0, 1, 11]],
        o: [[1, "Date.now", 22]],
      },
      {
        p: "src/core/kernel.ts",
        u: "core",
        d: "src",
        l: 120,
        e: 5,
        c: ["PURE"],
        s: [["coreStep", "function", 1]],
        x: [],
        t: [],
        v: [],
        tc: 1,
        fc: 92,
        ch: 2,
      },
      {
        p: "src/api/webhook.ts",
        u: "api",
        d: "src",
        l: 90,
        e: 2,
        c: ["HTTP", "DB"],
        s: [["handleWebhook", "function", 4]],
        x: ["stripe"],
        t: ["postgres:invoices"],
        v: ["STRIPE_SECRET"],
        tc: 0,
        fc: 25,
        ch: 6,
      },
    ],
    edges: [],
  };

  return { commitDiff, headSpec, drilldown };
}

describe("RepoSpec /show-me CI architectural diff screenshots", () => {
  let tmpRoot = "";
  let outDir = "";
  let bundleManifest: ShowMeManifest | null = null;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-showme-"));
    const repoDir = path.join(tmpRoot, "repo");
    outDir = path.join(tmpRoot, "out");
    fs.mkdirSync(path.join(repoDir, "src", "core"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "src", "api"), { recursive: true });

    fs.writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "showme-fixture", version: "1.0.0", main: "src/index.ts" }, null, 2),
    );
    fs.writeFileSync(
      path.join(repoDir, "src", "core", "calc.ts"),
      "export function doubleValue(n: number): number {\n  return n * 2;\n}\n",
    );
    fs.writeFileSync(
      path.join(repoDir, "src", "api", "handler.ts"),
      'import { doubleValue } from "../core/calc.ts";\nexport function runHandler(x: number): number {\n  return doubleValue(x) + 1;\n}\n',
    );
    fs.writeFileSync(
      path.join(repoDir, "src", "index.ts"),
      'import { runHandler } from "./api/handler.ts";\nexport const result = runHandler(4);\n',
    );

    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test Bot"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "chore: initial commit"], { cwd: repoDir });

    fs.writeFileSync(
      path.join(repoDir, "src", "core", "calc.ts"),
      "function clamp(n: number): number {\n  return Math.max(0, n);\n}\nexport function doubleValue(n: number): number {\n  return clamp(n) * 2;\n}\n",
    );
    fs.writeFileSync(
      path.join(repoDir, "src", "api", "routes.ts"),
      'import { runHandler } from "./handler.ts";\nexport function serveRoute(x: number): number {\n  return runHandler(x);\n}\n',
    );
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
      theme: "dark",
      includeTopFile: true,
      generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
    });
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("ranking presets differentiate hotspot, contract, blast, and composite risk", () => {
    expect(parseRankPreset("hotspot")).toBe("hotspot");
    expect(parseRankPreset("invalid")).toBe("risk");

    const fx = makeFixtureCommitDiff();
    expect(rankChangedFiles({ ...fx, preset: "hotspot" })[0]?.file.path).toBe("src/churn/legacy.ts");
    expect(rankChangedFiles({ ...fx, preset: "blast" })[0]?.file.path).toBe("src/core/kernel.ts");
    expect(rankChangedFiles({ ...fx, preset: "contract" })[0]?.file.path).toBe("src/api/webhook.ts");
    expect(rankDiffDiagrams({ ...fx, preset: "contract", focusMode: "off" })[0]?.bundle.id).toBe("diff:modules:api");
    expect(rankDiffDiagrams({ ...fx, preset: "blast", focusMode: "off" })[0]?.bundle.id).toBe("diff:modules:core");
  });

  test("cropFocusedSubgraph keeps changed nodes + 1-hop neighbors and hides distant context", () => {
    const big = makeSyntheticOverlay(18);
    const autoCrop = cropFocusedSubgraph(big, "auto", 14);
    expect(autoCrop.focused).toBe(true);
    expect(autoCrop.hiddenNodes).toBe(15);
    expect(autoCrop.overlay.nodes.map((n) => n.id).sort()).toEqual(["n0", "n1", "n2"]);
    expect(autoCrop.overlay.edges.map((e) => e.id).sort()).toEqual(["e01", "e12"]);

    const noCrop = cropFocusedSubgraph(big, "off", 14);
    expect(noCrop.focused).toBe(false);
    expect(noCrop.overlay.nodes.length).toBe(18);
  });

  test("SVG + PNG rasterizer and /show-me PR comment emit valid PNGs and sticky Markdown", () => {
    const fx = makeFixtureCommitDiff();
    const rankedDiags = rankDiffDiagrams({ ...fx, preset: "risk", focusMode: "auto" });
    const rankedFiles = rankChangedFiles({ ...fx, preset: "risk" });

    const topDiag = rankedDiags[0];
    expect(topDiag).toBeDefined();
    const svg = renderDiffDiagramSvg({
      ranked: topDiag as NonNullable<typeof topDiag>,
      commitDiff: fx.commitDiff,
      repoName: "demo-app",
      theme: "dark",
    });
    expect(svg).toContain("<svg ");
    expect(svg).toContain("demo-app");

    const png = rasterizeSvgToPng(svg, 2);
    expect(png.length).toBeGreaterThan(1000);
    expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);

    const topFile = rankedFiles.find((f) => f.file.path === "src/churn/legacy.ts");
    expect(topFile).toBeDefined();
    const fileSvg = renderTopFileCardSvg({
      rankedFile: topFile as NonNullable<typeof topFile>,
      drillFile: fx.drilldown.files[0],
      commitDiff: fx.commitDiff,
      theme: "light",
    });
    expect(fileSvg).toContain("hotFn");
    expect(fileSvg).toContain("KEY DIFF EXCERPT");
    const filePng = rasterizeSvgToPng(fileSvg, 2);
    expect([filePng[0], filePng[1], filePng[2], filePng[3]]).toEqual([137, 80, 78, 71]);

    const md = buildShowMePrComment({
      repoName: "demo-app",
      commitDiff: fx.commitDiff,
      preset: "risk",
      shots: [
        {
          rank: 1,
          kind: "diagram",
          id: (topDiag as NonNullable<typeof topDiag>).bundle.id,
          title: (topDiag as NonNullable<typeof topDiag>).bundle.label,
          priority: (topDiag as NonNullable<typeof topDiag>).priority,
          score: (topDiag as NonNullable<typeof topDiag>).score,
          focused: false,
          hiddenNodes: 0,
          reasons: (topDiag as NonNullable<typeof topDiag>).breakdown.reasons,
          pngFile: "01-api-modules.png",
        },
      ],
      topFiles: rankedFiles,
      imageBaseUrl: "https://example.com/assets",
    });
    expect(md).toContain("<!-- repospec-show-me -->");
    expect(md).toContain("## Why the change");
    expect(md).toContain("## Special things to note");
    expect(md).toContain("![api Modules](https://example.com/assets/01-api-modules.png)");
    expect(md).toContain("cross-repo wire contracts");
  });

  test("runShowMeBundle generates ranked PNG/SVG screenshots, top-file card, manifest, and pr-comment.md", () => {
    expect(bundleManifest).toBeDefined();
    const manifest = bundleManifest as ShowMeManifest;
    expect(manifest.shots.length).toBeGreaterThanOrEqual(2);
    expect(manifest.shots.some((s) => s.kind === "diagram")).toBe(true);
    expect(manifest.shots.some((s) => s.kind === "top_file")).toBe(true);
    expect(fs.existsSync(manifest.prCommentPath)).toBe(true);
    expect(fs.existsSync(manifest.manifestPath)).toBe(true);

    const pngHeaders = manifest.shots.map((shot) => {
      const pngFile = shot.pngFile ?? "";
      const bytes = fs.readFileSync(path.join(outDir, pngFile));
      return [bytes[0], bytes[1], bytes[2], bytes[3]];
    });
    expect(pngHeaders.every((h) => h[0] === 137 && h[1] === 80 && h[2] === 78 && h[3] === 71)).toBe(true);

    const md = fs.readFileSync(manifest.prCommentPath, "utf8");
    expect(md).toContain("<!-- repospec-show-me -->");
    expect(md).toContain("feat: add clamp and route handler");
  });
});
