import type {
  DiagramLayout,
  LayoutEdge,
  SqlInvariantResult,
  StaticTrace,
} from "@repospec/plugin";

function diagramCategoryRank(c: DiagramLayout["category"]): number {
  return c === "layers" ? 0 : c === "modules" ? 1 : c === "domains" ? 2 : c === "runtime" ? 3 : c === "delivery" ? 4 : 5;
}

function firstUnvisitedEdge(list: LayoutEdge[], visited: Set<string>): LayoutEdge | undefined {
  for (const edge of list) {
    if (!visited.has(edge.to)) return edge;
  }
  return undefined;
}

export function resolveEvidenceAnchors(
  invariants: SqlInvariantResult[],
  diagrams: DiagramLayout[],
): SqlInvariantResult[] {
  const diagOrder = [...diagrams].sort((a, b) => diagramCategoryRank(a.category) - diagramCategoryRank(b.category));

  return invariants.map((inv) => ({
    ...inv,
    evidence: inv.evidence.map((ev) => {
      const anchors: Array<{ diagramId: string; nodeIds: string[]; edgeIds: string[] }> = [];
      for (const diag of diagOrder) {
        const matchedNodes = new Set<string>();
        const matchedEdges = new Set<string>();
        const diagNodeIds = new Set(diag.nodes.map((n) => n.id));

        if (ev.targetNodeId && diagNodeIds.has(ev.targetNodeId)) matchedNodes.add(ev.targetNodeId);
        if (ev.edgeFromId && diagNodeIds.has(ev.edgeFromId)) matchedNodes.add(ev.edgeFromId);
        if (ev.edgeToId && diagNodeIds.has(ev.edgeToId)) matchedNodes.add(ev.edgeToId);

        for (const le of diag.edges) {
          const matchesPair =
            ev.edgeFromId &&
            ev.edgeToId &&
            ((le.from === ev.edgeFromId && le.to === ev.edgeToId) ||
              (le.bidirectional && le.from === ev.edgeToId && le.to === ev.edgeFromId));
          const matchesEv =
            (le.ruleIds?.includes(inv.id) ?? false) &&
            (le.evidence?.some((x) => x.file === ev.file && (!ev.line || !x.line || x.line === ev.line)) ?? false);
          if (matchesPair || matchesEv) {
            matchedEdges.add(le.id);
            matchedNodes.add(le.from);
            matchedNodes.add(le.to);
          }
        }

        if (matchedNodes.size > 0 || matchedEdges.size > 0) {
          anchors.push({
            diagramId: diag.id,
            nodeIds: Array.from(matchedNodes).sort(),
            edgeIds: Array.from(matchedEdges).sort(),
          });
          if (anchors.length >= 2) break;
        }
      }
      return anchors.length > 0 ? { ...ev, anchors } : ev;
    }),
  }));
}

function findLongestObservedChain(
  diag: DiagramLayout,
): Array<{ nodeId: string; edgeId?: string; file?: string; line?: number }> {
  const outMap = new Map<string, LayoutEdge[]>();
  const inDeg = new Map<string, number>();
  for (const n of diag.nodes) inDeg.set(n.id, 0);
  for (const e of diag.edges) {
    if (e.confidence !== "observed" || e.violation || e.tier === "detail") continue;
    const list = outMap.get(e.from) ?? [];
    list.push(e);
    outMap.set(e.from, list);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  for (const list of outMap.values()) {
    list.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.to.localeCompare(b.to));
  }

  const starts = diag.nodes
    .filter((n) => (outMap.get(n.id)?.length ?? 0) > 0)
    .sort((a, b) => (inDeg.get(a.id) ?? 0) - (inDeg.get(b.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 6);

  let best: Array<{ nodeId: string; edgeId?: string; file?: string; line?: number }> = [];
  for (const s of starts) {
    const visited = new Set<string>([s.id]);
    const chain: Array<{ nodeId: string; edgeId?: string; file?: string; line?: number }> = [{ nodeId: s.id }];
    let cur = s.id;
    for (let hop = 0; hop < 6; hop += 1) {
      const nextEdge = firstUnvisitedEdge(outMap.get(cur) ?? [], visited);
      if (!nextEdge) break;
      visited.add(nextEdge.to);
      const ev0 = nextEdge.evidence?.[0];
      chain.push({
        nodeId: nextEdge.to,
        edgeId: nextEdge.id,
        file: ev0?.file,
        line: ev0?.line,
      });
      cur = nextEdge.to;
    }
    if (chain.length > best.length) best = chain;
  }
  return best;
}

export function buildStaticTraces(diagrams: DiagramLayout[]): StaticTrace[] {
  const traces: StaticTrace[] = [];
  const disclaimer = "Static path — imports & declared wiring, not observed runtime flow." as const;

  for (const diag of diagrams) {
    if (diag.category !== "modules" && diag.category !== "layers" && diag.category !== "runtime") continue;
    const chain = findLongestObservedChain(diag);
    if (chain.length >= 3) {
      traces.push({
        id: `trace:${diag.id}`,
        title:
          diag.category === "modules"
            ? `${diag.id.replace(/^modules:/, "")} Module Spine`
            : diag.category === "layers"
              ? `${diag.id.replace(/^layers:/, "")} Layer Spine`
              : "Observed Unit → Store Path",
        disclaimer,
        diagramId: diag.id,
        steps: chain,
      });
    }
    if (traces.length >= 4) break;
  }

  return traces;
}
