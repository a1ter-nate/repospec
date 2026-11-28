import type { MetricRecord, ModuleCard } from "@repospec/plugin";

const EXTRACTOR_ID = "module-atlas.structural-economics.v1";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function balancedBinaryTreeCcd(n: number): number {
  if (n <= 1) return 1;
  return (n + 1) * Math.log2(n + 1) - n;
}

function computeReachability(
  ids: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string }>,
): {
  readonly forward: Map<string, Set<string>>;
  readonly backward: Map<string, Set<string>>;
} {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list && adj.has(e.to)) list.push(e.to);
  }
  const forward = new Map<string, Set<string>>();
  const backward = new Map<string, Set<string>>();
  for (const id of ids) {
    forward.set(id, new Set([id]));
    backward.set(id, new Set([id]));
  }
  for (const start of ids) {
    const visited = forward.get(start);
    if (!visited) continue;
    const queue: string[] = [start];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head];
      head += 1;
      if (!cur) continue;
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          backward.get(next)?.add(start);
          queue.push(next);
        }
      }
    }
  }
  return { forward, backward };
}

function computeUnitEconomics(params: {
  scopeKind: "repo" | "unit";
  scopeId: string;
  cards: ModuleCard[];
  edges: ReadonlyArray<{ from: string; to: string }>;
}): MetricRecord[] {
  const { scopeKind, scopeId, cards, edges } = params;
  const n = cards.length;
  if (n === 0) return [];

  const ids = cards.map((c) => c.id);
  const { forward, backward } = computeReachability(ids, edges);

  let totalReachablePairs = 0;
  let ccd = 0;
  for (const c of cards) {
    const deps = forward.get(c.id)?.size ?? 1;
    totalReachablePairs += deps;
    ccd += deps;
    if (scopeKind === "unit") {
      c.cd = deps;
    }
  }

  const pcPct = round2((100 * totalReachablePairs) / (n * n));
  const nccd = round2(ccd / Math.max(1, balancedBinaryTreeCcd(n)));

  const connected = cards.filter((c) => c.fanIn > 0 || c.fanOut > 0);
  const sortedIn = connected.map((c) => (backward.get(c.id)?.size ?? 1) - 1).sort((a, b) => a - b);
  const sortedOut = connected.map((c) => (forward.get(c.id)?.size ?? 1) - 1).sort((a, b) => a - b);
  const medIn = sortedIn.length > 0 ? (sortedIn[Math.floor(sortedIn.length / 2)] ?? 1) : 1;
  const medOut = sortedOut.length > 0 ? (sortedOut[Math.floor(sortedOut.length / 2)] ?? 1) : 1;

  let coreCount = 0;
  let zoneOfPainCount = 0;
  for (const c of cards) {
    const tIn = (backward.get(c.id)?.size ?? 1) - 1;
    const tOut = (forward.get(c.id)?.size ?? 1) - 1;
    let cp: "core" | "periphery" | "isolated" = "periphery";
    if (c.fanIn === 0 && c.fanOut === 0) cp = "isolated";
    else if (c.inTangle || (tIn >= Math.max(1, medIn) && tOut >= Math.max(1, medOut))) cp = "core";
    if (cp === "core") coreCount += 1;

    const totalDeg = c.fanIn + c.fanOut;
    const instability = totalDeg > 0 ? round2(c.fanOut / totalDeg) : 0;
    const typeExports = c.topExports.filter((s) => s.kind === "type").length;
    const symTotal = Math.max(c.topExports.length, c.exportCount);
    const abstractness = symTotal > 0 ? round2(typeExports / symTotal) : 0;
    const mainSeqDistance = round2(Math.abs(abstractness + instability - 1));
    if (abstractness < 0.25 && instability < 0.25 && c.fanIn >= 3) {
      zoneOfPainCount += 1;
    }

    if (scopeKind === "unit") {
      c.corePeriphery = cp;
      c.instability = instability;
      c.abstractness = abstractness;
      c.mainSeqDistance = mainSeqDistance;
    }
  }

  const maxLevel = cards.reduce((m, c) => Math.max(m, c.level), 0);
  const drIds = new Set(cards.filter((c) => c.level === maxLevel && c.fanIn > 0).map((c) => c.id));
  const nonDrCards = cards.filter((c) => !drIds.has(c.id));
  let dlPct = 100;
  if (nonDrCards.length > 0) {
    const nonDrSet = new Set(nonDrCards.map((c) => c.id));
    const undirected = new Map<string, Set<string>>();
    for (const id of nonDrSet) undirected.set(id, new Set());
    for (const e of edges) {
      if (nonDrSet.has(e.from) && nonDrSet.has(e.to)) {
        undirected.get(e.from)?.add(e.to);
        undirected.get(e.to)?.add(e.from);
      }
    }
    const seen = new Set<string>();
    let independentWeight = 0;
    for (const id of nonDrSet) {
      if (seen.has(id)) continue;
      const comp: string[] = [];
      const stack: string[] = [id];
      seen.add(id);
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) break;
        comp.push(cur);
        for (const nb of undirected.get(cur) ?? []) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      const size = comp.length;
      const share = size / n;
      independentWeight += share * (1 - share);
    }
    const baseRatio = nonDrCards.length / n;
    dlPct = round2(Math.max(0, Math.min(100, (independentWeight + (drIds.size > 0 ? 0.5 * (1 - baseRatio) : 0)) * 100 + (nonDrCards.length === 1 ? 0 : 0))));
    if (edges.length === 0) dlPct = 100;
    else {
      const avgCoupling = (totalReachablePairs - n) / Math.max(1, n * (n - 1));
      dlPct = round2(Math.max(0, Math.min(100, (1 - avgCoupling) * (0.5 + 0.5 * (independentWeight / Math.max(0.01, baseRatio))) * 100)));
    }
  }

  const pureCount = cards.filter((c) => c.capabilities.every((cap) => cap === "PURE")).length;
  const pureCoreRatioPct = round2((100 * pureCount) / n);
  const coreRatioPct = round2((100 * coreCount) / n);

  return [
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "dsm_propagation_cost_pct", valueNum: pcPct },
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "dsm_core_ratio_pct", valueNum: coreRatioPct },
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "drh_decoupling_level_pct", valueNum: dlPct },
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "lakos_ccd", valueNum: ccd },
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "lakos_nccd", valueNum: nccd },
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "zone_of_pain_count", valueNum: zoneOfPainCount },
    { extractorId: EXTRACTOR_ID, scopeKind, scopeId, name: "pure_core_ratio_pct", valueNum: pureCoreRatioPct },
  ];
}

export function computeStructuralEconomics(params: {
  modules: ModuleCard[];
  unitEdges: ReadonlyArray<{ unitSlug: string; from: string; to: string }>;
}): MetricRecord[] {
  const { modules, unitEdges } = params;
  if (modules.length === 0) return [];
  const metrics: MetricRecord[] = [];
  const byUnit = new Map<string, ModuleCard[]>();
  for (const m of modules) {
    const list = byUnit.get(m.unitSlug) ?? [];
    list.push(m);
    byUnit.set(m.unitSlug, list);
  }
  const edgesByUnit = new Map<string, Array<{ from: string; to: string }>>();
  for (const e of unitEdges) {
    const list = edgesByUnit.get(e.unitSlug) ?? [];
    list.push({ from: e.from, to: e.to });
    edgesByUnit.set(e.unitSlug, list);
  }
  for (const [slug, cards] of Array.from(byUnit.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    metrics.push(...computeUnitEconomics({ scopeKind: "unit", scopeId: slug, cards, edges: edgesByUnit.get(slug) ?? [] }));
  }
  metrics.push(
    ...computeUnitEconomics({
      scopeKind: "repo",
      scopeId: "repo",
      cards: modules,
      edges: unitEdges.map((e) => ({ from: e.from, to: e.to })),
    }),
  );
  return metrics;
}
