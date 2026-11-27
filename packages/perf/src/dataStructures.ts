function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(`@repospec/perf invariant failed: ${message}`);
}

export class RingBufferDeque<T> {
  private buffer: Array<T | undefined>;
  private headIdx = 0;
  private itemCount = 0;
  private readonly capacityLimit: number;

  constructor(capacityInitial = 16, capacityLimit = 1_048_576) {
    assertCondition(capacityInitial >= 1 && capacityLimit >= capacityInitial, "Invalid RingBufferDeque capacity bounds");
    this.buffer = Array.from<T | undefined>({ length: capacityInitial });
    this.capacityLimit = capacityLimit;
  }

  get size(): number {
    return this.itemCount;
  }

  get isEmpty(): boolean {
    return this.itemCount === 0;
  }

  private grow(): void {
    const capNew = Math.min(this.capacityLimit, this.buffer.length * 2);
    assertCondition(capNew > this.buffer.length, `RingBufferDeque exceeded capacityLimit (${this.capacityLimit})`);
    const next = Array.from<T | undefined>({ length: capNew });
    for (let i = 0; i < this.itemCount; i += 1) {
      next[i] = this.buffer[(this.headIdx + i) % this.buffer.length];
    }
    this.buffer = next;
    this.headIdx = 0;
  }

  pushBack(value: T): void {
    if (this.itemCount === this.buffer.length) this.grow();
    const tailIdx = (this.headIdx + this.itemCount) % this.buffer.length;
    this.buffer[tailIdx] = value;
    this.itemCount += 1;
  }

  pushFront(value: T): void {
    if (this.itemCount === this.buffer.length) this.grow();
    this.headIdx = (this.headIdx - 1 + this.buffer.length) % this.buffer.length;
    this.buffer[this.headIdx] = value;
    this.itemCount += 1;
  }

  popFront(): T | undefined {
    if (this.itemCount === 0) return undefined;
    const item = this.buffer[this.headIdx];
    this.buffer[this.headIdx] = undefined;
    this.headIdx = (this.headIdx + 1) % this.buffer.length;
    this.itemCount -= 1;
    return item;
  }

  popBack(): T | undefined {
    if (this.itemCount === 0) return undefined;
    const tailIdx = (this.headIdx + this.itemCount - 1) % this.buffer.length;
    const item = this.buffer[tailIdx];
    this.buffer[tailIdx] = undefined;
    this.itemCount -= 1;
    return item;
  }

  peekFront(): T | undefined {
    return this.itemCount === 0 ? undefined : this.buffer[this.headIdx];
  }

  peekBack(): T | undefined {
    if (this.itemCount === 0) return undefined;
    return this.buffer[(this.headIdx + this.itemCount - 1) % this.buffer.length];
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.itemCount; i += 1) {
      out.push(this.buffer[(this.headIdx + i) % this.buffer.length] as T);
    }
    return out;
  }
}

export class BinaryHeap<T> {
  private readonly items: T[] = [];
  private readonly compare: (a: T, b: T) => number;
  private readonly capacityLimit: number;

  constructor(compare: (a: T, b: T) => number, capacityLimit = 1_048_576) {
    assertCondition(typeof compare === "function" && capacityLimit >= 1, "Invalid BinaryHeap constructor arguments");
    this.compare = compare;
    this.capacityLimit = capacityLimit;
  }

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    assertCondition(this.items.length < this.capacityLimit, `BinaryHeap exceeded capacityLimit (${this.capacityLimit})`);
    this.items.push(value);
    let idx = this.items.length - 1;
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const cur = this.items[idx] as T;
      const parent = this.items[parentIdx] as T;
      if (this.compare(cur, parent) >= 0) break;
      this.items[idx] = parent;
      this.items[parentIdx] = cur;
      idx = parentIdx;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop() as T;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftDown(startIdx: number): void {
    let idx = startIdx;
    const len = this.items.length;
    while (idx < len) {
      const left = (idx << 1) + 1;
      const right = left + 1;
      let best = idx;
      if (left < len && this.compare(this.items[left] as T, this.items[best] as T) < 0) best = left;
      if (right < len && this.compare(this.items[right] as T, this.items[best] as T) < 0) best = right;
      if (best === idx) break;
      const tmp = this.items[idx] as T;
      this.items[idx] = this.items[best] as T;
      this.items[best] = tmp;
      idx = best;
    }
  }
}

interface TrieNode {
  readonly children: Map<string, TrieNode>;
  isTerminal: boolean;
}

export class PrefixTrie {
  private readonly root: TrieNode = { children: new Map(), isTerminal: false };
  private wordCount = 0;

  get size(): number {
    return this.wordCount;
  }

  insert(word: string): void {
    assertCondition(typeof word === "string", "PrefixTrie.insert requires a string");
    let node = this.root;
    for (let i = 0; i < word.length; i += 1) {
      const ch = word[i] ?? "";
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), isTerminal: false };
        node.children.set(ch, next);
      }
      node = next;
    }
    if (!node.isTerminal) {
      node.isTerminal = true;
      this.wordCount += 1;
    }
  }

  has(word: string): boolean {
    const node = this.walkPrefix(word);
    return Boolean(node?.isTerminal);
  }

  hasPrefix(prefix: string): boolean {
    return this.walkPrefix(prefix) !== undefined;
  }

  findByPrefix(prefix: string, resultLimit = 100): string[] {
    assertCondition(resultLimit >= 0, "PrefixTrie.findByPrefix requires non-negative resultLimit");
    const start = this.walkPrefix(prefix);
    if (!start || resultLimit === 0) return [];
    const out: string[] = [];
    const stack: Array<{ readonly node: TrieNode; readonly text: string }> = [{ node: start, text: prefix }];
    while (stack.length > 0 && out.length < resultLimit) {
      const cur = stack.pop();
      if (!cur) break;
      if (cur.node.isTerminal) out.push(cur.text);
      const keys = Array.from(cur.node.children.keys()).sort();
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const key = keys[i] ?? "";
        const child = cur.node.children.get(key);
        if (child) stack.push({ node: child, text: `${cur.text}${key}` });
      }
    }
    return out;
  }

  private walkPrefix(prefix: string): TrieNode | undefined {
    let node: TrieNode | undefined = this.root;
    for (let i = 0; i < prefix.length; i += 1) {
      node = node.children.get(prefix[i] ?? "");
      if (!node) return undefined;
    }
    return node;
  }
}

export class UnionFind {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;
  private componentCount: number;

  constructor(nodeCount: number) {
    assertCondition(Number.isInteger(nodeCount) && nodeCount >= 0, "UnionFind requires non-negative integer nodeCount");
    this.parent = new Int32Array(nodeCount);
    this.rank = new Uint8Array(nodeCount);
    this.componentCount = nodeCount;
    for (let i = 0; i < nodeCount; i += 1) this.parent[i] = i;
  }

  get components(): number {
    return this.componentCount;
  }

  find(index: number): number {
    assertCondition(index >= 0 && index < this.parent.length, `UnionFind index out of bounds: ${index}`);
    let root = index;
    while ((this.parent[root] ?? root) !== root) {
      root = this.parent[root] ?? root;
    }
    let cur = index;
    while (cur !== root) {
      const next = this.parent[cur] ?? root;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;
    const rankA = this.rank[rootA] ?? 0;
    const rankB = this.rank[rootB] ?? 0;
    if (rankA < rankB) {
      this.parent[rootA] = rootB;
    } else if (rankA > rankB) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] = rankA + 1;
    }
    this.componentCount -= 1;
    return true;
  }

  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

export class LruCache<K, V> {
  private readonly store = new Map<K, V>();
  private readonly capacityLimit: number;

  constructor(capacityLimit: number) {
    assertCondition(Number.isInteger(capacityLimit) && capacityLimit >= 1, "LruCache requires capacityLimit >= 1");
    this.capacityLimit = capacityLimit;
  }

  get size(): number {
    return this.store.size;
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;
    const value = this.store.get(key) as V;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacityLimit) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, value);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
