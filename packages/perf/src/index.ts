import fs from "node:fs";
import path from "node:path";
import { Plugin, type RepoSpecV4 } from "@repospec/plugin";
import { analyzeComplexityProfile } from "./internal/complexityAdvisor.ts";
import { analyzeSourcePerformance } from "./internal/perfAstScanner.ts";
import { analyzeRepoPerformance, perfExtractorPlugin, renderPerfStudioTabHtml } from "./internal/perfExtractor.ts";

function resolvePerfRulesDir(): string {
  const candidates = [
    path.resolve(import.meta.dir, "../rules"),
    path.resolve(import.meta.dir, "./perf-rules"),
    path.resolve(import.meta.dir, "../perf-rules"),
    path.resolve(import.meta.dir, "../dist/perf-rules"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0] ?? "rules";
}

const PERF_RULES_DIR = resolvePerfRulesDir();

export {
  analyzeComplexityProfile,
  analyzeRepoPerformance,
  analyzeSourcePerformance,
  perfExtractorPlugin,
};

export type {
  BigOClass,
  ComplexityProfile,
  PerfAnalysisBundle,
  PerfAntiPatternFinding,
  PerfPatternId,
} from "./internal/types.ts";

export const perfPlugin = Plugin.define({
  id: "repospec.perf",
  async setup(ctx) {
    if (!ctx) throw new Error("repospec.perf requires plugin context");
    await ctx.extractor.transform((ed) => {
      ed.add(perfExtractorPlugin);
    });
    await ctx.rule.transform((ed) => {
      ed.add({ id: "repospec.perf.rules", dir: PERF_RULES_DIR });
    });
    await ctx.studio.transform((ed) => {
      ed.addCss(".rs-perf-panel{padding:16px}.rs-perf-table{width:100%;border-collapse:collapse;font-size:12px}.rs-perf-table th,.rs-perf-table td{border-bottom:1px solid rgba(148,163,184,.2);padding:6px 8px;text-align:left}");
      ed.addTab({
        id: "performance",
        label: "Performance",
        renderHtml: (input) => {
          const obj = input as { readonly spec?: RepoSpecV4 };
          return obj.spec ? renderPerfStudioTabHtml(obj.spec) : "";
        },
      });
    });
    await ctx.ci.transform((ed) => {
      ed.addGate({
        id: "repospec.perf.quadratic-watch",
        name: "Performance Hotspot & Complexity Watch",
        severity: "warn",
        evaluate: (input) => {
          const obj = input as { readonly spec?: RepoSpecV4 };
          const facts = obj.spec?.extensions.facts ?? [];
          const highHits = facts.filter((f) => f.kind === "perf_antipattern" && f.payload.severity === "high");
          const expHits = facts.filter((f) => f.kind === "complexity_profile" && f.payload.timeComplexity === "O(2^n)");
          const total = highHits.length + expHits.length;
          return {
            passed: total === 0,
            message:
              total === 0
                ? "Zero high-severity AST performance hotspots or exponential recursion sites detected."
                : `Detected ${highHits.length} high-severity AST hotspot(s) and ${expHits.length} O(2^n) recursion site(s).`,
            items: [...highHits, ...expHits].slice(0, 10).map((f) => `${f.file}:${f.line} (${f.key})`),
          };
        },
      });
    });
  },
});

export default perfPlugin;
