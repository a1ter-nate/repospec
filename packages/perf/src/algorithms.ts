import { BinaryHeap, LruCache } from "./dataStructures.ts";

function assertAlgo(condition: boolean, message: string): void {
  if (!condition) throw new Error(`@repospec/perf algorithm invariant failed: ${message}`);
}

export function binarySearch<T>(
  sortedItems: readonly T[],
  target: T,
  compare: (a: T, b: T) => number,
): number {
  assertAlgo(typeof compare === "function", "binarySearch requires a comparator");
  let lo = 0;
  let hi = sortedItems.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    const cmp = compare(sortedItems[mid] as T, target);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function topK<T>(
  items: readonly T[],
  k: number,
  compare: (a: T, b: T) => number,
): T[] {
  assertAlgo(Number.isInteger(k) && k >= 0, "topK requires non-negative integer k");
  if (k === 0 || items.length === 0) return [];
  const heap = new BinaryHeap<T>(compare, Math.max(k + 1, 16));
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as T;
    if (heap.size < k) {
      heap.push(item);
    } else {
      const smallest = heap.peek() as T;
      if (compare(item, smallest) > 0) {
        heap.pop();
        heap.push(item);
      }
    }
  }
  const desc: T[] = [];
  while (heap.size > 0) {
    desc.push(heap.pop() as T);
  }
  desc.reverse();
  return desc;
}

export function prefixSums(values: readonly number[]): Float64Array {
  assertAlgo(Array.isArray(values), "prefixSums requires an array of numbers");
  const out = new Float64Array(values.length + 1);
  let running = 0;
  for (let i = 0; i < values.length; i += 1) {
    running += values[i] ?? 0;
    out[i + 1] = running;
  }
  return out;
}

export function hashJoin<L, R, K>(
  leftItems: readonly L[],
  rightItems: readonly R[],
  leftKey: (item: L) => K,
  rightKey: (item: R) => K,
): Array<{ readonly left: L; readonly right: R }> {
  assertAlgo(typeof leftKey === "function" && typeof rightKey === "function", "hashJoin requires key extractors");
  const index = new Map<K, R[]>();
  for (let i = 0; i < rightItems.length; i += 1) {
    const right = rightItems[i] as R;
    const key = rightKey(right);
    const bucket = index.get(key);
    if (bucket) bucket.push(right);
    else index.set(key, [right]);
  }
  const matches: Array<{ readonly left: L; readonly right: R }> = [];
  for (let i = 0; i < leftItems.length; i += 1) {
    const left = leftItems[i] as L;
    const bucket = index.get(leftKey(left));
    if (!bucket) continue;
    for (let j = 0; j < bucket.length; j += 1) {
      matches.push({ left, right: bucket[j] as R });
    }
  }
  return matches;
}

export function memoize<A, R>(
  fn: (arg: A) => R,
  options?: { readonly capacityLimit?: number; readonly keyOf?: (arg: A) => string },
): (arg: A) => R {
  assertAlgo(typeof fn === "function", "memoize requires a function");
  const capacityLimit = options?.capacityLimit ?? 1024;
  const cache = new LruCache<string | A, R>(capacityLimit);
  const keyOf = options?.keyOf;
  return (arg: A): R => {
    const cacheKey = keyOf ? keyOf(arg) : arg;
    if (cache.has(cacheKey)) return cache.get(cacheKey) as R;
    const computed = fn(arg);
    cache.set(cacheKey, computed);
    return computed;
  };
}

export function mergeSorted<T>(
  leftSorted: readonly T[],
  rightSorted: readonly T[],
  compare: (a: T, b: T) => number,
): T[] {
  if (typeof compare !== "function") throw new Error("mergeSorted requires a comparator");
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < leftSorted.length && j < rightSorted.length) {
    const leftVal = leftSorted[i] as T;
    const rightVal = rightSorted[j] as T;
    if (compare(leftVal, rightVal) <= 0) {
      out.push(leftVal);
      i += 1;
    } else {
      out.push(rightVal);
      j += 1;
    }
  }
  while (i < leftSorted.length) {
    out.push(leftSorted[i] as T);
    i += 1;
  }
  while (j < rightSorted.length) {
    out.push(rightSorted[j] as T);
    j += 1;
  }
  return out;
}
