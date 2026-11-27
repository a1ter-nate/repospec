import { describe, expect, test } from "bun:test";
import { analyzeComplexityProfile, analyzeSourcePerformance, perfPlugin } from "@repospec/perf";

const PERF_FIXTURE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly code: string;
  readonly expectedPattern: string;
}> = [
  {
    name: "linear-lookup-in-loop",
    code: "export function findDupes(a: number[], b: number[]) { const out: number[] = []; for (const x of a) { if (b.includes(x)) out.push(x); } return out; }",
    expectedPattern: "linear-lookup-in-loop",
  },
  {
    name: "array-shift-unshift-in-loop",
    code: "export function drain(q: number[]) { let sum = 0; while (q.length > 0) { sum += q.shift() ?? 0; } return sum; }",
    expectedPattern: "array-shift-unshift-in-loop",
  },
  {
    name: "spread-accumulator-in-reduce",
    code: "export function indexBy(xs: Array<{ id: string }>) { return xs.reduce((acc, x) => ({ ...acc, [x.id]: x }), {} as Record<string, unknown>); }",
    expectedPattern: "spread-accumulator-in-reduce",
  },
  {
    name: "regex-or-formatter-in-loop",
    code: "export function matchAll(xs: string[], p: string) { const out: boolean[] = []; for (const x of xs) { out.push(new RegExp(p).test(x)); } return out; }",
    expectedPattern: "regex-or-formatter-in-loop",
  },
  {
    name: "json-deep-clone-in-loop",
    code: "export function cloneAll(xs: unknown[]) { const out: unknown[] = []; for (const x of xs) { out.push(JSON.parse(JSON.stringify(x))); } return out; }",
    expectedPattern: "json-deep-clone-in-loop",
  },
  {
    name: "sort-to-find-extremum",
    code: "export function maxItem(xs: number[]) { return [...xs].sort((a, b) => b - a)[0]; }",
    expectedPattern: "sort-to-find-extremum",
  },
  {
    name: "string-concat-in-loop",
    code: "export function joinLines(xs: string[]) { let out = ''; for (const x of xs) { out += `${x}\\n`; } return out; }",
    expectedPattern: "string-concat-in-loop",
  },
  {
    name: "serial-await-in-loop",
    code: "export async function fetchAll(urls: string[]) { const out: unknown[] = []; for (const u of urls) { out.push(await Promise.resolve(u)); } return out; }",
    expectedPattern: "serial-await-in-loop",
  },
  {
    name: "chained-array-allocations",
    code: "export function transform(xs: number[]) { return xs.filter((x) => x > 0).map((x) => x * 2).filter((x) => x < 100); }",
    expectedPattern: "chained-array-allocations",
  },
  {
    name: "nested-loop-join",
    code: "export function joinUsers(as: Array<{ id: string }>, bs: Array<{ userId: string }>) { const out: unknown[] = []; for (const a of as) { for (const b of bs) { if (a.id === b.userId) out.push([a, b]); } } return out; }",
    expectedPattern: "nested-loop-join",
  },
];

describe("@repospec/perf AST scanner & complexity advisor unit", () => {
  test.each(PERF_FIXTURE_CASES)("detects anti-pattern $name with swap recommendation", ({ code, expectedPattern }) => {
    const hits = analyzeSourcePerformance(code, "src/sample.ts");
    const matched = hits.find((h) => h.patternId === expectedPattern);
    expect(matched).toBeDefined();
    expect(matched?.swapTo.length).toBeGreaterThan(10);
  });

  test("ignores literal string .includes() substring checks inside loops", () => {
    const hits = analyzeSourcePerformance(
      "export function filterLogs(lines: string[]) { const out: string[] = []; for (const l of lines) { if (l.includes('ERROR')) out.push(l); } return out; }",
      "src/logs.ts",
    );
    expect(hits.some((h) => h.patternId === "linear-lookup-in-loop")).toBe(false);
  });

  test("estimates O(1), O(log n), O(n), O(n log n), O(n^2), and O(2^n) complexity profiles", () => {
    const sample = `
export function constTime(x: number) { return x + 1; }
export function binSearch(xs: number[], t: number) {
  let lo = 0; let hi = xs.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid] === t) return mid; lo = mid + 1; }
  return -1;
}
export function linearScan(xs: number[]) { let s = 0; for (const x of xs) s += x; return s; }
export function sortValues(xs: number[]) { return [...xs].sort((a, b) => a - b); }
export function pairSums(xs: number[]) { const out: number[] = []; for (const a of xs) { for (const b of xs) out.push(a + b); } return out; }
export function fibNaive(n: number): number { return n <= 1 ? n : fibNaive(n - 1) + fibNaive(n - 2); }
`;
    const profiles = analyzeComplexityProfile(sample, "src/algos.ts");
    const byName = new Map(profiles.map((p) => [p.symbol, p]));
    expect(byName.get("constTime")?.timeComplexity).toBe("O(1)");
    expect(byName.get("binSearch")?.timeComplexity).toBe("O(log n)");
    expect(byName.get("linearScan")?.timeComplexity).toBe("O(n)");
    expect(byName.get("sortValues")?.timeComplexity).toBe("O(n log n)");
    expect(byName.get("pairSums")?.timeComplexity).toBe("O(n^2)");
    expect(byName.get("pairSums")?.recommendation).toContain("Quadratic");
    expect(byName.get("fibNaive")?.timeComplexity).toBe("O(2^n)");
    expect(byName.get("fibNaive")?.suggestedPrimitive).toBe("@repospec/perf/algorithms#memoize");
    expect(perfPlugin.id).toBe("repospec.perf");
  });
});
