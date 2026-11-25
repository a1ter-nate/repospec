import type { LaneDef } from "../layout.ts";
import type { AstFileFact, CapabilityTag, ExportedSymbol } from "../schema.ts";

export interface TopologicalAnalysis {
  levels: Map<string, number>;
  sccs: string[][];
  inTangle: Map<string, string>;
}

export function computeTopologicalLevels(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): TopologicalAnalysis {
  const sortedIds = Array.from(new Set(nodeIds)).sort();
  const idSet = new Set(sortedIds);
  const adj = new Map<string, string[]>();
  for (const id of sortedIds) adj.set(id, []);
  for (const e of edges) {
    if (e.from === e.to || !idSet.has(e.from) || !idSet.has(e.to)) continue;
    adj.get(e.from)?.push(e.to);
  }
  for (const list of adj.values()) {
    const uniq = Array.from(new Set(list)).sort();
    list.length = 0;
    list.push(...uniq);
  }

  let nextIdx = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const rawSccs: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, nextIdx);
    lowlink.set(v, nextIdx);
    nextIdx += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      while (stack.length > 0) {
        const w = stack.pop();
        if (!w) break;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      comp.sort();
      rawSccs.push(comp);
    }
  };

  for (const id of sortedIds) {
    if (!indices.has(id)) strongConnect(id);
  }

  rawSccs.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
  const compOf = new Map<string, number>();
  const inTangle = new Map<string, string>();
  let tangleSeq = 0;
  for (let i = 0; i < rawSccs.length; i += 1) {
    const comp = rawSccs[i] ?? [];
    let tid: string | null = null;
    if (comp.length > 1) {
      tangleSeq += 1;
      tid = `tangle-${tangleSeq}`;
    }
    for (const member of comp) {
      compOf.set(member, i);
      if (tid) inTangle.set(member, tid);
    }
  }

  const dagOut = new Map<number, Set<number>>();
  const inDeg = new Map<number, number>();
  for (let i = 0; i < rawSccs.length; i += 1) {
    dagOut.set(i, new Set());
    inDeg.set(i, 0);
  }
  for (const [u, neighbors] of adj) {
    const cu = compOf.get(u);
    if (cu === undefined) continue;
    for (const v of neighbors) {
      const cv = compOf.get(v);
      if (cv === undefined || cu === cv) continue;
      const set = dagOut.get(cu);
      if (set && !set.has(cv)) {
        set.add(cv);
        inDeg.set(cv, (inDeg.get(cv) ?? 0) + 1);
      }
    }
  }

  const queue: number[] = [];
  const compLevel = new Map<number, number>();
  for (let i = 0; i < rawSccs.length; i += 1) {
    if ((inDeg.get(i) ?? 0) === 0) {
      queue.push(i);
      compLevel.set(i, 0);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const u = queue[head];
    head += 1;
    if (u === undefined) continue;
    const lu = compLevel.get(u) ?? 0;
    for (const v of dagOut.get(u) ?? []) {
      const nextLvl = Math.max(compLevel.get(v) ?? 0, lu + 1);
      compLevel.set(v, nextLvl);
      const deg = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, deg);
      if (deg === 0) queue.push(v);
    }
  }

  const levels = new Map<string, number>();
  for (const id of sortedIds) {
    const cid = compOf.get(id) ?? 0;
    levels.set(id, compLevel.get(cid) ?? 0);
  }

  return { levels, sccs: rawSccs, inTangle };
}

export function buildLanesForLevels(
  maxLevel: number,
  hasStandalone: boolean,
): { laneOrder: LaneDef[]; laneIdFor: (level: number, standalone: boolean) => string } {
  const primaryCount = Math.min(5, Math.max(1, maxLevel + 1));
  const labelTemplates: Record<number, string[]> = {
    1: ["L0 · Modules"],
    2: ["L0 · Entry & Orchestration", "L1 · Foundation"],
    3: ["L0 · Entry", "L1 · Core", "L2 · Foundation"],
    4: ["L0 · Entry", "L1 · Orchestration", "L2 · Core", "L3 · Foundation"],
    5: ["L0 · Entry", "L1 · Orchestration", "L2 · Core", "L3 · Support", "L4 · Foundation"],
  };
  const labels = labelTemplates[primaryCount] ?? labelTemplates[5] ?? [];
  const laneOrder: LaneDef[] = labels.map((label, idx) => ({ id: `L${idx}`, label }));
  if (hasStandalone) {
    laneOrder.push({ id: "standalone", label: "Standalone", lateral: true });
  }

  const laneIdFor = (level: number, standalone: boolean): string => {
    if (standalone) return "standalone";
    if (primaryCount <= 1 || maxLevel <= 0) return "L0";
    if (level <= 0) return "L0";
    if (level >= maxLevel) return `L${primaryCount - 1}`;
    const scaled = 1 + Math.floor(((level - 1) / Math.max(1, maxLevel - 1)) * (primaryCount - 2));
    return `L${Math.min(primaryCount - 2, Math.max(1, scaled))}`;
  };

  return { laneOrder, laneIdFor };
}

function normalizeIdent(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function peelUnitModulePaths(
  unitFiles: AstFileFact[],
  unitDir: string,
  unitSlug: string,
): Array<{ fact: AstFileFact; rel: string }> {
  let current = unitFiles.map((fact) => {
    const inner = unitDir !== "." && fact.file.startsWith(`${unitDir}/`) ? fact.file.slice(unitDir.length + 1) : fact.file;
    return { fact, rel: inner.replace(/^(?:src|app|lib|functions)\//, "") };
  });
  for (let round = 0; round < 2; round += 1) {
    if (current.length < 2) break;
    const dirCounts = new Map<string, number>();
    let allNested = true;
    for (const item of current) {
      const parts = item.rel.split("/");
      if (parts.length < 2 || !parts[0]) {
        allNested = false;
        break;
      }
      dirCounts.set(parts[0], (dirCounts.get(parts[0]) ?? 0) + 1);
    }
    if (allNested && dirCounts.size === 1) {
      const onlyDir = Array.from(dirCounts.keys())[0];
      if (!onlyDir) break;
      const prefix = `${onlyDir}/`;
      current = current.map((item) => ({ fact: item.fact, rel: item.rel.slice(prefix.length) }));
      continue;
    }
    if (allNested && dirCounts.size >= 2 && dirCounts.size <= 3) {
      const unitNorm = normalizeIdent(unitSlug);
      const ranked = Array.from(dirCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const dominant = ranked[0];
      if (
        dominant &&
        dominant[1] >= 4 &&
        dominant[1] / current.length >= 0.6 &&
        normalizeIdent(dominant[0]) === unitNorm
      ) {
        const prefix = `${dominant[0]}/`;
        current = current.map((item) =>
          item.rel.startsWith(prefix) ? { fact: item.fact, rel: item.rel.slice(prefix.length) } : item,
        );
      }
    }
    break;
  }
  return current;
}

export function summarizeModuleMetadata(facts: AstFileFact[]): {
  capabilities: CapabilityTag[];
  topExports: ExportedSymbol[];
} {
  const capSet = new Set<CapabilityTag>();
  for (const f of facts) {
    for (const c of f.capabilities ?? ["PURE"]) {
      if (c !== "PURE") capSet.add(c);
    }
  }
  const capOrder: CapabilityTag[] = ["DB", "HTTP", "FS", "PROC", "ENV"];
  const capabilities: CapabilityTag[] = capSet.size === 0 ? ["PURE"] : capOrder.filter((c) => capSet.has(c));

  const kindRank: Record<ExportedSymbol["kind"], number> = {
    route: 0,
    command: 1,
    class: 2,
    function: 3,
    type: 4,
    const: 5,
  };
  const seen = new Set<string>();
  const topExports: ExportedSymbol[] = [];
  const allSymbols = facts
    .flatMap((f) => f.exportedSymbols ?? [])
    .sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.file.localeCompare(b.file) || a.line - b.line);
  for (const s of allSymbols) {
    const key = `${s.name}|${s.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    topExports.push(s);
    if (topExports.length >= 12) break;
  }
  return { capabilities, topExports };
}
