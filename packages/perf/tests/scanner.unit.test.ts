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

  test("ignores literal string .includes(), string-cast .includes(v, pos), non-this property calls, and deferred event callbacks", () => {
    const hits = analyzeSourcePerformance(
      `export function filterLogs(lines: string[], needle: string) {
        const out: string[] = [];
        for (const l of lines) {
          if (l.includes('ERROR')) out.push(l);
          if ((l as string).includes(needle, 2)) out.push(l);
        }
        return out;
      }`,
      "src/logs.ts",
    );
    expect(hits.some((h) => h.patternId === "linear-lookup-in-loop")).toBe(false);

    const profiles = analyzeComplexityProfile(
      `export function match(path: string, re: RegExp) {
        const a = path.match(re);
        const b = path.match(re);
        return a ?? b;
      }
      export function drawStage(btn: { onclick?: () => void; onchange?: () => void }) {
        btn.onclick = () => drawStage(btn);
        btn.onchange = () => drawStage(btn);
      }`,
      "src/ui.ts",
    );
    const byName = new Map(profiles.map((p) => [p.symbol, p]));
    expect(byName.get("match")?.timeComplexity).toBe("O(1)");
    expect(byName.get("drawStage")?.timeComplexity).toBe("O(1)");
  });

  test("scans Rust, Python, and C# polyglot performance anti-patterns and complexity profiles", () => {
    const rustCode = `
pub async fn drain_jobs(mut q: Vec<String>, allowed: Vec<String>) {
  while !q.is_empty() {
    let item = q.remove(0);
    if allowed.contains(&item) {
      let _re = Regex::new("[a-z]+").unwrap();
      run_job(&item).await;
    }
  }
}
pub fn fib_rust(n: u32) -> u32 {
  if n <= 1 { return n; }
  fib_rust(n - 1) + fib_rust(n - 2)
}
#[cfg(test)]
mod tests {
  fn test_helper(mut q: Vec<u32>) {
    while !q.is_empty() { q.remove(0); }
  }
}
`;
    const rustHits = analyzeSourcePerformance(rustCode, "crates/worker/src/lib.rs");
    expect(rustHits.some((h) => h.patternId === "array-shift-unshift-in-loop")).toBe(true);
    expect(rustHits.some((h) => h.patternId === "linear-lookup-in-loop")).toBe(true);
    expect(rustHits.some((h) => h.patternId === "regex-or-formatter-in-loop")).toBe(true);
    expect(rustHits.some((h) => h.patternId === "serial-await-in-loop")).toBe(true);
    expect(rustHits.filter((h) => h.patternId === "array-shift-unshift-in-loop")).toHaveLength(1);
    const rustProfiles = analyzeComplexityProfile(rustCode, "crates/worker/src/lib.rs");
    expect(rustProfiles.find((p) => p.symbol === "fib_rust")?.timeComplexity).toBe("O(2^n)");

    const pyCode = `
def drain_py(q, items):
    while q:
        x = q.pop(0)
        p = re.compile(r"\\d+")
        c = copy.deepcopy(x)
    return sorted(items)[0]

def fib_py(n):
    if n <= 1:
        return n
    return fib_py(n - 1) + fib_py(n - 2)
`;
    const pyHits = analyzeSourcePerformance(pyCode, "app/worker.py");
    expect(pyHits.some((h) => h.patternId === "array-shift-unshift-in-loop")).toBe(true);
    expect(pyHits.some((h) => h.patternId === "regex-or-formatter-in-loop")).toBe(true);
    expect(pyHits.some((h) => h.patternId === "json-deep-clone-in-loop")).toBe(true);
    expect(pyHits.some((h) => h.patternId === "sort-to-find-extremum")).toBe(true);
    const pyProfiles = analyzeComplexityProfile(pyCode, "app/worker.py");
    expect(pyProfiles.find((p) => p.symbol === "fib_py")?.timeComplexity).toBe("O(2^n)");

    const csCode = `
public class Worker {
  public async Task RunAsync(List<string> queue, List<string> allowed) {
    string log = "";
    while (queue.Count > 0) {
      var item = queue[0];
      queue.RemoveAt(0);
      if (allowed.Contains(item)) {
        var rx = new Regex("abc");
        log += "ok";
        await ProcessAsync(item);
      }
    }
    var best = allowed.OrderBy(x => x).First();
  }
}
`;
    const csHits = analyzeSourcePerformance(csCode, "src/Worker.cs");
    expect(csHits.some((h) => h.patternId === "array-shift-unshift-in-loop")).toBe(true);
    expect(csHits.some((h) => h.patternId === "linear-lookup-in-loop")).toBe(true);
    expect(csHits.some((h) => h.patternId === "regex-or-formatter-in-loop")).toBe(true);
    expect(csHits.some((h) => h.patternId === "string-concat-in-loop")).toBe(true);
    expect(csHits.some((h) => h.patternId === "serial-await-in-loop")).toBe(true);
    expect(csHits.some((h) => h.patternId === "sort-to-find-extremum")).toBe(true);
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
