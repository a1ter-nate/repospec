import fs from "node:fs";
import path from "node:path";
import type { ExtractorPlugin, FactRecord, GraphFragment, MetricRecord, RepoContext, RepoSpecV4 } from "@repospec/plugin";
import { analyzeComplexityProfile } from "./complexityAdvisor.ts";
import { analyzeSourcePerformance } from "./perfAstScanner.ts";
import type { ComplexityProfile, PerfAnalysisBundle, PerfAntiPatternFinding } from "./types.ts";

const TS_JS_EXT_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const IGNORED_PATH_RE = /(?:^|\/)(?:tests?|__tests__|fixtures?|examples?|dist|build|node_modules)\/|\.(?:test|spec|d)\.[a-z]+$/i;
const QUADRATIC_CLASSES = new Set(["O(n^2)", "O(n^2 log n)", "O(n^3)", "O(2^n)"]);

function assertPerf(condition: boolean, message: string): void {
  if (!condition) throw new Error(`@repospec/perf extractor invariant failed: ${message}`);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resolveUnitName(ctx: RepoContext, relFile: string): string {
  for (const u of ctx.units) {
    if (u.dir !== "." && (relFile === u.dir || relFile.startsWith(`${u.dir}/`))) return u.name;
  }
  return ctx.repoName;
}

export function analyzeRepoPerformance(ctx: RepoContext): PerfAnalysisBundle {
  assertPerf(Boolean(ctx && ctx.rootDir), "analyzeRepoPerformance requires a valid RepoContext");
  const findings: PerfAntiPatternFinding[] = [];
  const profiles: ComplexityProfile[] = [];
  let scannedFiles = 0;

  for (const rel of ctx.allFiles) {
    if (!TS_JS_EXT_RE.test(rel) || IGNORED_PATH_RE.test(rel)) continue;
    const abs = path.join(ctx.rootDir, rel);
    let sourceText = "";
    try {
      sourceText = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (sourceText.length === 0 || sourceText.length > 512_000) continue;
    scannedFiles += 1;
    findings.push(...analyzeSourcePerformance(sourceText, rel));
    profiles.push(...analyzeComplexityProfile(sourceText, rel));
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.patternId.localeCompare(b.patternId));
  profiles.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.symbol.localeCompare(b.symbol));

  return {
    scannedFiles,
    findings,
    profiles,
    highSeverityCount: findings.filter((f) => f.severity === "high").length,
    quadraticOrWorseCount: profiles.filter((p) => QUADRATIC_CLASSES.has(p.timeComplexity)).length,
  };
}

export const perfExtractorPlugin: ExtractorPlugin = {
  id: "perf.complexity.v1",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    if (!ctx || !ctx.rootDir) throw new Error("perfExtractorPlugin requires a valid RepoContext");
    const bundle = analyzeRepoPerformance(ctx);
    const facts: FactRecord[] = [];
    const metrics: MetricRecord[] = [
      { extractorId: "perf.complexity.v1", scopeKind: "repo", scopeId: ctx.repoName, name: "perf_scanned_files", valueNum: bundle.scannedFiles },
      { extractorId: "perf.complexity.v1", scopeKind: "repo", scopeId: ctx.repoName, name: "perf_antipattern_count", valueNum: bundle.findings.length },
      { extractorId: "perf.complexity.v1", scopeKind: "repo", scopeId: ctx.repoName, name: "perf_high_severity_count", valueNum: bundle.highSeverityCount },
      { extractorId: "perf.complexity.v1", scopeKind: "repo", scopeId: ctx.repoName, name: "perf_quadratic_functions", valueNum: bundle.quadraticOrWorseCount },
    ];

    for (const f of bundle.findings) {
      facts.push({
        extractorId: "perf.complexity.v1",
        kind: "perf_antipattern",
        key: `${f.patternId}:${f.file}:${f.line}`,
        file: f.file,
        line: f.line,
        unit: resolveUnitName(ctx, f.file),
        symbol: f.symbol,
        severity: f.severity === "high" ? "warn" : "info",
        payload: {
          patternId: f.patternId,
          severity: f.severity,
          symbol: f.symbol,
          currentComplexity: f.currentComplexity,
          targetComplexity: f.targetComplexity,
          summary: f.summary,
          swapTo: f.swapTo,
          helperRef: f.helperRef,
        },
      });
    }

    for (const p of bundle.profiles) {
      if (!QUADRATIC_CLASSES.has(p.timeComplexity) && p.timeComplexity !== "O(n log n)") continue;
      facts.push({
        extractorId: "perf.complexity.v1",
        kind: "complexity_profile",
        key: `${p.file}:${p.symbol}:${p.line}`,
        file: p.file,
        line: p.line,
        unit: resolveUnitName(ctx, p.file),
        symbol: p.symbol,
        severity: p.timeComplexity === "O(2^n)" || p.timeComplexity === "O(n^3)" ? "warn" : "info",
        payload: {
          symbol: p.symbol,
          timeComplexity: p.timeComplexity,
          spaceComplexity: p.spaceComplexity,
          loopDepthMax: p.loopDepthMax,
          hasBranchingRecursion: p.hasBranchingRecursion,
          recommendation: p.recommendation ?? "",
          suggestedPrimitive: p.suggestedPrimitive ?? "",
        },
      });
    }

    return { nodes: [], edges: [], rules: [], facts, metrics };
  },
};

export function renderPerfStudioTabHtml(spec: RepoSpecV4): string {
  assertPerf(Boolean(spec && spec.extensions), "renderPerfStudioTabHtml requires a valid RepoSpecV4");
  const allFacts = spec.extensions.facts;
  const antipatterns = allFacts.filter((f) => f.kind === "perf_antipattern");
  const profiles = allFacts.filter((f) => f.kind === "complexity_profile");
  const patternRows = antipatterns
    .slice(0, 40)
    .map((f) => {
      const p = f.payload;
      return `<tr><td><code>${escapeHtml(String(p.patternId ?? f.key))}</code></td><td>${escapeHtml(f.file)}:${f.line}</td><td>${escapeHtml(String(p.currentComplexity ?? ""))} &rarr; ${escapeHtml(String(p.targetComplexity ?? ""))}</td><td>${escapeHtml(String(p.swapTo ?? ""))}</td></tr>`;
    })
    .join("");
  const profileRows = profiles
    .slice(0, 40)
    .map((f) => {
      const p = f.payload;
      return `<tr><td><code>${escapeHtml(String(p.symbol ?? f.symbol ?? ""))}</code></td><td>${escapeHtml(f.file)}:${f.line}</td><td><strong>${escapeHtml(String(p.timeComplexity ?? ""))}</strong> / ${escapeHtml(String(p.spaceComplexity ?? ""))}</td><td>${escapeHtml(String(p.recommendation ?? "Within linear/n-log-n budget"))}</td></tr>`;
    })
    .join("");

  return `<div class="rs-perf-panel">
    <h3>Performance &amp; Complexity Advisor</h3>
    <p>AST anti-patterns detected: <strong>${antipatterns.length}</strong> &middot; Non-linear complexity profiles: <strong>${profiles.length}</strong></p>
    <h4>Code Performance Anti-Patterns &amp; Swap Recommendations</h4>
    <table class="rs-perf-table"><thead><tr><th>Pattern</th><th>Location</th><th>Complexity</th><th>Recommended Swap</th></tr></thead><tbody>${patternRows || "<tr><td colspan='4'>No AST performance anti-patterns detected.</td></tr>"}</tbody></table>
    <h4>Function Space-Time Complexity Profiles</h4>
    <table class="rs-perf-table"><thead><tr><th>Function</th><th>Location</th><th>Time / Space</th><th>Algorithmic Recommendation</th></tr></thead><tbody>${profileRows || "<tr><td colspan='4'>All scanned functions are O(n) or faster.</td></tr>"}</tbody></table>
  </div>`;
}
