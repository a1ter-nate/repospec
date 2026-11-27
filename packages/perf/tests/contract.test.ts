import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { PluginHost } from "@repospec/core";
import { binarySearch, hashJoin, mergeSorted, topK } from "@repospec/perf/algorithms";
import { BinaryHeap, LruCache, RingBufferDeque, UnionFind } from "@repospec/perf/data-structures";

const numCmp = (a: number, b: number): number => a - b;

interface DequeModel {
  readonly items: number[];
}

class PushBackCmd implements fc.Command<DequeModel, RingBufferDeque<number>> {
  constructor(readonly value: number) {}
  check(): boolean {
    return true;
  }
  run(model: DequeModel, real: RingBufferDeque<number>): void {
    model.items.push(this.value);
    real.pushBack(this.value);
    expect(real.size).toBe(model.items.length);
    expect(real.toArray()).toEqual(model.items);
  }
  toString(): string {
    return `pushBack(${this.value})`;
  }
}

class PushFrontCmd implements fc.Command<DequeModel, RingBufferDeque<number>> {
  constructor(readonly value: number) {}
  check(): boolean {
    return true;
  }
  run(model: DequeModel, real: RingBufferDeque<number>): void {
    model.items.unshift(this.value);
    real.pushFront(this.value);
    expect(real.size).toBe(model.items.length);
    expect(real.toArray()).toEqual(model.items);
  }
  toString(): string {
    return `pushFront(${this.value})`;
  }
}

class PopFrontCmd implements fc.Command<DequeModel, RingBufferDeque<number>> {
  check(): boolean {
    return true;
  }
  run(model: DequeModel, real: RingBufferDeque<number>): void {
    expect(real.popFront()).toBe(model.items.shift());
    expect(real.size).toBe(model.items.length);
  }
  toString(): string {
    return "popFront()";
  }
}

class PopBackCmd implements fc.Command<DequeModel, RingBufferDeque<number>> {
  check(): boolean {
    return true;
  }
  run(model: DequeModel, real: RingBufferDeque<number>): void {
    expect(real.popBack()).toBe(model.items.pop());
    expect(real.size).toBe(model.items.length);
  }
  toString(): string {
    return "popBack()";
  }
}

describe("@repospec/perf PBT & MBT contracts (R3 MBT)", () => {
  test("RingBufferDeque matches reference array model under stateful fc.commands sequences", () => {
    const allCmds = [
      fc.integer({ min: -500, max: 500 }).map((v) => new PushBackCmd(v)),
      fc.integer({ min: -500, max: 500 }).map((v) => new PushFrontCmd(v)),
      fc.constant(new PopFrontCmd()),
      fc.constant(new PopBackCmd()),
    ];
    fc.assert(
      fc.property(fc.commands(allCmds, { maxCommands: 30 }), (cmds) => {
        fc.modelRun(() => ({ model: { items: [] }, real: new RingBufferDeque<number>(2, 1024) }), cmds);
      }),
      { numRuns: 40 },
    );
  });

  test("BinaryHeap, topK, binarySearch, and mergeSorted match sorted reference oracle", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 60 }), fc.integer({ min: 0, max: 15 }), (xs, k) => {
        const heap = new BinaryHeap<number>(numCmp);
        for (const x of xs) heap.push(x);
        const drained: number[] = [];
        while (heap.size > 0) {
          const v = heap.pop();
          if (v !== undefined) drained.push(v);
        }
        const sortedAsc = [...xs].sort(numCmp);
        expect(drained).toEqual(sortedAsc);

        const expectedTopK = [...xs].sort((a, b) => b - a).slice(0, k);
        expect(topK(xs, k, numCmp)).toEqual(expectedTopK);

        const target = sortedAsc[Math.floor(sortedAsc.length / 2)] as number;
        const idx = binarySearch(sortedAsc, target, numCmp);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(sortedAsc[idx]).toBe(target);
      }),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -200, max: 200 }), { maxLength: 30 }),
        fc.array(fc.integer({ min: -200, max: 200 }), { maxLength: 30 }),
        (a, b) => {
          const sa = [...a].sort(numCmp);
          const sb = [...b].sort(numCmp);
          expect(mergeSorted(sa, sb, numCmp)).toEqual([...sa, ...sb].sort(numCmp));
        },
      ),
      { numRuns: 40 },
    );
  });

  test("hashJoin matches nested-loop join oracle and UnionFind/LruCache preserve invariants", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 25 }),
        fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 25 }),
        (left, right) => {
          const fast = hashJoin(left, right, (x) => x, (y) => y);
          const slow: Array<{ left: number; right: number }> = [];
          for (const l of left) {
            for (const r of right) {
              if (l === r) slow.push({ left: l, right: r });
            }
          }
          expect(fast).toEqual(slow);
        },
      ),
      { numRuns: 40 },
    );

    const uf = new UnionFind(10);
    uf.union(0, 3);
    uf.union(3, 7);
    expect(uf.connected(0, 7)).toBe(true);
    const cache = new LruCache<number, number>(3);
    for (let i = 0; i < 10; i += 1) cache.set(i, i * 2);
    expect(cache.size).toBe(3);
  });

  test("repospec.perf plugin integrates end-to-end across facts, SQL invariants, Studio tab, CI gate, and cleanly toggles OFF", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-perf-e2e-"));
    try {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "perf-fixture", version: "1.0.0" }));
      fs.writeFileSync(
        path.join(tmp, "src/hot.ts"),
        `export function slowMatch(a: number[], b: number[]): number[] {
  const out: number[] = [];
  for (const x of a) {
    if (b.includes(x)) out.push(x);
  }
  return out;
}
export function fibSlow(n: number): number {
  return n <= 1 ? n : fibSlow(n - 1) + fibSlow(n - 2);
}
`,
      );

      const hostOn = await PluginHost.create({ includeBuiltins: true });
      const scanOn = await hostOn.scan(tmp, { dbPath: path.join(tmp, "on.sqlite") });
      const htmlOn = hostOn.renderStudio(scanOn);
      const checkOn = await hostOn.check(tmp);
      await hostOn.dispose();

      expect(scanOn.spec.extensions.facts.some((f) => f.kind === "perf_antipattern")).toBe(true);
      expect(scanOn.spec.extensions.facts.some((f) => f.kind === "complexity_profile")).toBe(true);
      expect(scanOn.spec.invariants.some((i) => i.id === "perf:quadratic-hotspots" && i.status === "warn")).toBe(true);
      expect(scanOn.spec.invariants.some((i) => i.id === "perf:exponential-recursion" && i.status === "warn")).toBe(true);
      expect(htmlOn).toContain("Performance &amp; Complexity Advisor");
      expect(checkOn.customGates.some((g) => g.id === "repospec.perf.quadratic-watch" && !g.passed)).toBe(true);

      const hostOff = await PluginHost.create({
        includeBuiltins: true,
        operations: [{ type: "remove", target: "repospec.perf" }],
      });
      const scanOff = await hostOff.scan(tmp, { dbPath: path.join(tmp, "off.sqlite") });
      const htmlOff = hostOff.renderStudio(scanOff);
      const checkOff = await hostOff.check(tmp);
      await hostOff.dispose();

      expect(scanOff.spec.extensions.facts.some((f) => f.extractorId === "perf.complexity.v1")).toBe(false);
      expect(scanOff.spec.invariants.some((i) => i.id.startsWith("perf:"))).toBe(false);
      expect(htmlOff).not.toContain("Performance &amp; Complexity Advisor");
      expect(checkOff.customGates.some((g) => g.id === "repospec.perf.quadratic-watch")).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
