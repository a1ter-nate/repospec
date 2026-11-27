import { describe, expect, test } from "bun:test";
import { binarySearch, hashJoin, memoize, mergeSorted, prefixSums, topK } from "@repospec/perf/algorithms";
import { BinaryHeap, LruCache, PrefixTrie, RingBufferDeque, UnionFind } from "@repospec/perf/data-structures";

const numCmp = (a: number, b: number): number => a - b;

describe("@repospec/perf data structures & algorithms unit", () => {
  test("RingBufferDeque supports O(1) push/pop on both ends across growth", () => {
    const dq = new RingBufferDeque<number>(2, 64);
    dq.pushBack(1);
    dq.pushBack(2);
    dq.pushFront(0);
    dq.pushBack(3);
    expect(dq.size).toBe(4);
    expect(dq.peekFront()).toBe(0);
    expect(dq.peekBack()).toBe(3);
    expect(dq.toArray()).toEqual([0, 1, 2, 3]);
    expect(dq.popFront()).toBe(0);
    expect(dq.popBack()).toBe(3);
    expect(dq.toArray()).toEqual([1, 2]);
  });

  test("BinaryHeap pops elements in comparator priority order", () => {
    const minHeap = new BinaryHeap<number>((a, b) => a - b);
    for (const v of [9, 3, 7, 1, 5, 2]) minHeap.push(v);
    const out: number[] = [];
    while (minHeap.size > 0) {
      const next = minHeap.pop();
      if (next !== undefined) out.push(next);
    }
    expect(out).toEqual([1, 2, 3, 5, 7, 9]);
  });

  test("PrefixTrie inserts, queries, and enumerates sorted prefix matches", () => {
    const trie = new PrefixTrie();
    for (const w of ["repospec", "report", "replay", "veristack", "report"]) trie.insert(w);
    expect(trie.size).toBe(4);
    expect(trie.has("report")).toBe(true);
    expect(trie.has("repo")).toBe(false);
    expect(trie.hasPrefix("repo")).toBe(true);
    expect(trie.findByPrefix("rep", 10)).toEqual(["replay", "report", "repospec"]);
  });

  test("UnionFind merges components with path compression and rank", () => {
    const uf = new UnionFind(5);
    expect(uf.components).toBe(5);
    expect(uf.union(0, 1)).toBe(true);
    expect(uf.union(1, 2)).toBe(true);
    expect(uf.union(0, 2)).toBe(false);
    expect(uf.connected(0, 2)).toBe(true);
    expect(uf.connected(0, 4)).toBe(false);
    expect(uf.components).toBe(3);
  });

  test("LruCache evicts least recently used entry on capacity overflow", () => {
    const lru = new LruCache<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.get("a")).toBe(1);
    lru.set("c", 3);
    expect(lru.has("b")).toBe(false);
    expect(lru.get("a")).toBe(1);
    expect(lru.get("c")).toBe(3);
  });

  test("algorithms binarySearch, topK, prefixSums, hashJoin, memoize, mergeSorted work accurately", () => {
    expect(binarySearch([1, 4, 7, 11, 20], 11, numCmp)).toBe(3);
    expect(binarySearch([1, 4, 7, 11, 20], 9, numCmp)).toBe(-1);
    expect(topK([5, 1, 9, 3, 12, 7, 4], 3, numCmp)).toEqual([12, 9, 7]);
    const ps = prefixSums([2, 3, 5, 7]);
    expect(Array.from(ps)).toEqual([0, 2, 5, 10, 17]);
    const joined = hashJoin(
      [{ id: 1, n: "a" }, { id: 2, n: "b" }],
      [{ uid: 2, role: "admin" }, { uid: 3, role: "guest" }],
      (l) => l.id,
      (r) => r.uid,
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]?.left.n).toBe("b");
    let calls = 0;
    const sq = memoize((n: number) => {
      calls += 1;
      return n * n;
    }, { capacityLimit: 4 });
    expect(sq(6)).toBe(36);
    expect(sq(6)).toBe(36);
    expect(calls).toBe(1);
    expect(mergeSorted([1, 4, 9], [2, 3, 8, 10], numCmp)).toEqual([1, 2, 3, 4, 8, 9, 10]);
  });
});
