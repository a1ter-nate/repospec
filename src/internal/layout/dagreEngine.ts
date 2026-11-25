import dagre from "@dagrejs/dagre";
import type {
  DiagramLayout,
  EdgeEvidenceItem,
  LayerAxis,
  LayoutEdge,
  LayoutNode,
  NodeFindingSummary,
  NodeRole,
} from "../../schema.ts";

export interface RawDiagramNode {
  id: string;
  label: string;
  sublabel: string;
  group?: string;
  lane?: string;
  layerAxis?: LayerAxis;
  layerRank?: number;
  kind: string;
  role?: NodeRole;
  domain: "arch" | "ci" | "test" | "iac" | "rules";
  shape: "box" | "pill" | "db" | "hex";
  expandable?: boolean;
  ambientBadges?: string[];
  findings?: NodeFindingSummary[];
  provenance?: { file: string; line?: number };
}

export interface RawDiagramEdge {
  from: string;
  to: string;
  kind: string;
  label?: string;
  weight?: number;
  violation?: boolean;
  bidirectional?: boolean;
  confidence?: "observed" | "inferred";
  ruleIds?: string[];
  evidence?: EdgeEvidenceItem[];
}

export interface LaneDef {
  id: string;
  label: string;
  lateral?: boolean;
}


export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function shortPkg(label: string): string {
  return label.replace(/^@[^/]+\//, "");
}

export function estimateNodeSize(
  label: string,
  sublabel?: string,
  ambientBadges?: string[],
): { width: number; height: number } {
  const fullSub =
    ambientBadges && ambientBadges.length > 0
      ? `${sublabel ?? ""} · ${ambientBadges[0]}`
      : (sublabel ?? "");
  const longest = Math.max(label.length, fullSub.length * 0.86);
  const width = Math.max(194, Math.min(308, longest * 8.2 + 72));
  const height = sublabel ? 62 : 48;
  return { width: Math.round(width), height };
}

export function mergeRawEdges(rawEdges: RawDiagramEdge[], nodeIds: Set<string>): RawDiagramEdge[] {
  const dedup = new Map<string, RawDiagramEdge>();
  for (const e of rawEdges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}|${e.to}`;
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, {
        ...e,
        ruleIds: e.ruleIds ? Array.from(new Set(e.ruleIds)).sort() : undefined,
        evidence: e.evidence ? [...e.evidence] : undefined,
      });
    } else {
      const mergedRules = Array.from(new Set([...(existing.ruleIds ?? []), ...(e.ruleIds ?? [])])).sort();
      const mergedEv = [...(existing.evidence ?? []), ...(e.evidence ?? [])]
        .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.detail.localeCompare(b.detail))
        .slice(0, 15);
      const existingW = existing.weight ?? 1;
      const incomingW = e.weight ?? 1;
      const nextWeight = Math.max(existingW, incomingW);
      const nextLabel =
        incomingW > existingW
          ? (e.label ?? existing.label)
          : existingW > incomingW
            ? (existing.label ?? e.label)
            : [existing.label, e.label].filter((v): v is string => typeof v === "string").sort()[0];
      dedup.set(key, {
        ...existing,
        label: nextLabel ?? existing.label,
        violation: Boolean(existing.violation || e.violation),
        weight: nextWeight,
        confidence: existing.confidence === "observed" || e.confidence === "observed" ? "observed" : "inferred",
        ruleIds: mergedRules.length > 0 ? mergedRules : undefined,
        evidence: mergedEv.length > 0 ? mergedEv : undefined,
      });
    }
  }
  return Array.from(dedup.values()).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export function classifyEdgeTiers(
  category: DiagramLayout["category"],
  nodes: LayoutNode[],
  edges: RawDiagramEdge[],
  laneIndexById: Map<string, number>,
  lateralLaneIds: Set<string>,
): Map<string, "spine" | "violation" | "detail"> {
  const tiers = new Map<string, "spine" | "violation" | "detail">();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const isDense = edges.length > 20;

  if (category === "layers" || category === "modules" || category === "subsystem") {
    const primaryOutByNode = new Map<string, RawDiagramEdge[]>();
    for (const e of edges) {
      const k = `${e.from}|${e.to}`;
      if (e.violation) {
        tiers.set(k, "violation");
        continue;
      }
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      const touchesLateral = lateralLaneIds.has(a?.lane ?? "") || lateralLaneIds.has(b?.lane ?? "");
      if (touchesLateral) {
        tiers.set(k, "detail");
        continue;
      }
      const la = laneIndexById.get(a?.lane ?? "") ?? 0;
      const lb = laneIndexById.get(b?.lane ?? "") ?? 0;
      if (!isDense) {
        tiers.set(k, "spine");
        continue;
      }
      if (lb === la + 1) {
        tiers.set(k, "spine");
      } else {
        tiers.set(k, "detail");
      }
      if (lb > la) {
        const list = primaryOutByNode.get(e.from) ?? [];
        list.push(e);
        primaryOutByNode.set(e.from, list);
      }
    }

    if (isDense) {
      for (const [, outs] of primaryOutByNode) {
        const hasSpine = outs.some((e) => tiers.get(`${e.from}|${e.to}`) === "spine");
        if (!hasSpine && outs.length > 0) {
          const best = [...outs].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.to.localeCompare(b.to))[0];
          if (best) tiers.set(`${best.from}|${best.to}`, "spine");
        }
      }
    }
    return tiers;
  }

  if (category === "domains" && isDense) {
    const nonViol = edges.filter((e) => !e.violation);
    const ranked = [...nonViol].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.from.localeCompare(b.from));
    const spineSet = new Set(ranked.slice(0, 14).map((e) => `${e.from}|${e.to}`));
    for (const e of edges) {
      const k = `${e.from}|${e.to}`;
      if (e.violation) tiers.set(k, "violation");
      else tiers.set(k, spineSet.has(k) ? "spine" : "detail");
    }
    return tiers;
  }

  if (category === "delivery" && edges.length > 26) {
    const bestVerifyByTo = new Map<string, string>();
    for (const e of edges) {
      if (e.kind === "verifies" && !bestVerifyByTo.has(e.to)) {
        bestVerifyByTo.set(e.to, `${e.from}|${e.to}`);
      }
    }
    for (const e of edges) {
      const k = `${e.from}|${e.to}`;
      if (e.violation) tiers.set(k, "violation");
      else if (e.kind === "deploys" || e.kind === "builds_image" || bestVerifyByTo.get(e.to) === k) {
        tiers.set(k, "spine");
      } else {
        tiers.set(k, "detail");
      }
    }
    return tiers;
  }

  for (const e of edges) {
    const k = `${e.from}|${e.to}`;
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (e.violation) tiers.set(k, "violation");
    else if (lateralLaneIds.has(a?.lane ?? "") || lateralLaneIds.has(b?.lane ?? "")) tiers.set(k, "detail");
    else tiers.set(k, "spine");
  }
  return tiers;
}

export function layoutWithDagre(
  id: string,
  title: string,
  subtitle: string,
  category: DiagramLayout["category"],
  rankdir: "LR" | "TB",
  rawNodes: RawDiagramNode[],
  rawEdges: RawDiagramEdge[],
  opts?: {
    nodesep?: number;
    ranksep?: number;
    ownerId?: string;
    unconnectedNodes?: Array<{ id: string; label: string; kind: string }>;
    foldedCount?: number;
  },
): DiagramLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir,
    nodesep: opts?.nodesep ?? 24,
    ranksep: opts?.ranksep ?? 64,
    marginx: 24,
    marginy: 24,
    edgesep: 14,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const sortedNodes = [...rawNodes].sort((a, b) => (a.layerRank ?? 0) - (b.layerRank ?? 0) || a.id.localeCompare(b.id));
  const nodeIds = new Set(sortedNodes.map((n) => n.id));
  for (const n of sortedNodes) {
    const { width, height } = estimateNodeSize(n.label, n.sublabel, n.ambientBadges);
    g.setNode(n.id, { width, height });
  }

  const sortedEdges = mergeRawEdges(rawEdges, nodeIds);
  for (const e of sortedEdges) {
    g.setEdge(e.from, e.to, { weight: e.weight ?? 1 });
  }

  dagre.layout(g);

  const layoutNodes: LayoutNode[] = sortedNodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number; width: number; height: number };
    return {
      id: n.id,
      label: n.label,
      sublabel: n.sublabel,
      group: n.group,
      lane: n.lane,
      layerAxis: n.layerAxis,
      layerRank: n.layerRank,
      kind: n.kind,
      role: n.role,
      domain: n.domain,
      shape: n.shape,
      expandable: n.expandable ? true : undefined,
      ambientBadges: n.ambientBadges && n.ambientBadges.length > 0 ? n.ambientBadges : undefined,
      findings: n.findings && n.findings.length > 0 ? n.findings : undefined,
      x: round1(pos.x),
      y: round1(pos.y),
      w: round1(pos.width),
      h: round1(pos.height),
      provenance: n.provenance,
    };
  });

  const tiers = classifyEdgeTiers(category, layoutNodes, sortedEdges, new Map(), new Set());

  const layoutEdges: LayoutEdge[] = sortedEdges.map((e, idx) => {
    const ge = g.edge(e.from, e.to);
    const points = (ge?.points ?? []).map((p: { x: number; y: number }) => ({
      x: round1(p.x),
      y: round1(p.y),
    }));
    const tier = tiers.get(`${e.from}|${e.to}`) ?? "spine";
    return {
      id: `${id}:e${idx}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      tier,
      label: e.label,
      weight: e.weight,
      violation: e.violation ? true : undefined,
      bidirectional: e.bidirectional ? true : undefined,
      confidence: e.confidence ?? "observed",
      ruleIds: e.ruleIds && e.ruleIds.length > 0 ? e.ruleIds : undefined,
      evidence: e.evidence && e.evidence.length > 0 ? e.evidence : undefined,
      points,
    };
  });

  const gMeta = g.graph();
  return {
    id,
    title,
    subtitle,
    category,
    ownerId: opts?.ownerId,
    rankdir,
    width: Math.max(360, round1(gMeta.width ?? 720)),
    height: Math.max(200, round1(gMeta.height ?? 320)),
    unconnectedNodes: opts?.unconnectedNodes && opts.unconnectedNodes.length > 0 ? opts.unconnectedNodes : undefined,
    foldedCount: opts?.foldedCount && opts.foldedCount > 0 ? opts.foldedCount : undefined,
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}
