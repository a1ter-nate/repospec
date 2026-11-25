import dagre from "@dagrejs/dagre";
import type {
  DiagramLane,
  DiagramLayout,
  EdgeEvidenceItem,
  LayerAxis,
  LayoutEdge,
  LayoutNode,
  NodeFindingSummary,
  NodeRole,
  SpecEdge,
  SpecNode,
  SqlInvariantResult,
  StateMachineRecord,
  StaticTrace,
} from "./schema.ts";

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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function shortPkg(label: string): string {
  return label.replace(/^@[^/]+\//, "");
}

function estimateNodeSize(
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

function mergeRawEdges(rawEdges: RawDiagramEdge[], nodeIds: Set<string>): RawDiagramEdge[] {
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
        ...(nextLabel ? { label: nextLabel } : {}),
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

function classifyEdgeTiers(
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

function layoutWithDagre(
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
      ...(n.layerAxis ? { layerAxis: n.layerAxis } : {}),
      ...(n.layerRank !== undefined ? { layerRank: n.layerRank } : {}),
      kind: n.kind,
      role: n.role,
      domain: n.domain,
      shape: n.shape,
      ...(n.expandable ? { expandable: true } : {}),
      ...(n.ambientBadges && n.ambientBadges.length > 0 ? { ambientBadges: n.ambientBadges } : {}),
      ...(n.findings && n.findings.length > 0 ? { findings: n.findings } : {}),
      x: round1(pos.x),
      y: round1(pos.y),
      w: round1(pos.width),
      h: round1(pos.height),
      ...(n.provenance ? { provenance: n.provenance } : {}),
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
      ...(e.label ? { label: e.label } : {}),
      ...(e.weight ? { weight: e.weight } : {}),
      ...(e.violation ? { violation: true } : {}),
      ...(e.bidirectional ? { bidirectional: true } : {}),
      confidence: e.confidence ?? "observed",
      ...(e.ruleIds && e.ruleIds.length > 0 ? { ruleIds: e.ruleIds } : {}),
      ...(e.evidence && e.evidence.length > 0 ? { evidence: e.evidence } : {}),
      points,
    };
  });

  const gMeta = g.graph();
  return {
    id,
    title,
    subtitle,
    category,
    ...(opts?.ownerId ? { ownerId: opts.ownerId } : {}),
    rankdir,
    width: Math.max(360, round1(gMeta.width ?? 720)),
    height: Math.max(200, round1(gMeta.height ?? 320)),
    ...(opts?.unconnectedNodes && opts.unconnectedNodes.length > 0 ? { unconnectedNodes: opts.unconnectedNodes } : {}),
    ...(opts?.foldedCount && opts.foldedCount > 0 ? { foldedCount: opts.foldedCount } : {}),
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}

export function layoutFixedLanes(
  id: string,
  title: string,
  subtitle: string,
  category: DiagramLayout["category"],
  laneOrder: LaneDef[],
  rawNodes: RawDiagramNode[],
  rawEdges: RawDiagramEdge[],
  opts?: {
    ownerId?: string;
    parentDiagramId?: string;
    unconnectedNodes?: Array<{ id: string; label: string; kind: string }>;
    foldedCount?: number;
  },
): DiagramLayout {
  const byLane = new Map<string, RawDiagramNode[]>();
  for (const ld of laneOrder) byLane.set(ld.id, []);
  const fallbackLane = laneOrder[laneOrder.length - 1]?.id ?? "lateral";

  for (const n of [...rawNodes].sort((a, b) => (a.layerRank ?? 0) - (b.layerRank ?? 0) || a.id.localeCompare(b.id))) {
    const laneKey = n.lane && byLane.has(n.lane) ? n.lane : fallbackLane;
    byLane.get(laneKey)?.push(n);
  }

  const primaryLanes = laneOrder.filter((ld) => !ld.lateral && (byLane.get(ld.id)?.length ?? 0) > 0);
  const lateralLanes = laneOrder.filter((ld) => ld.lateral && (byLane.get(ld.id)?.length ?? 0) > 0);
  const lateralLaneIds = new Set(lateralLanes.map((l) => l.id));

  const marginX = 28;
  const topCorridorH = 42;
  const primaryTopY = 20 + topCorridorH;
  const laneGap = 76;
  const nodeGapY = 22;
  const lanePadX = 16;
  const lanePadTop = 34;
  const lanePadBottom = 18;

  const layoutNodes: LayoutNode[] = [];
  const nodePosById = new Map<string, LayoutNode>();
  const lanes: DiagramLane[] = [];
  const laneIndexById = new Map<string, number>();

  let curX = marginX;
  let primaryMaxBottom = primaryTopY + 150;

  for (let li = 0; li < primaryLanes.length; li += 1) {
    const ld = primaryLanes[li];
    if (!ld) continue;
    laneIndexById.set(ld.id, li);
    const items = byLane.get(ld.id) ?? [];
    const sized = items.map((n) => ({ node: n, ...estimateNodeSize(n.label, n.sublabel, n.ambientBadges) }));
    const colW = Math.max(152, ...sized.map((s) => s.width));
    const laneW = colW + lanePadX * 2;

    let curY = primaryTopY + lanePadTop;
    for (const entry of sized) {
      const cx = round1(curX + lanePadX + colW / 2);
      const cy = round1(curY + entry.height / 2);
      const ln: LayoutNode = {
        id: entry.node.id,
        label: entry.node.label,
        sublabel: entry.node.sublabel,
        group: entry.node.group,
        lane: ld.id,
        ...(entry.node.layerAxis ? { layerAxis: entry.node.layerAxis } : {}),
        ...(entry.node.layerRank !== undefined ? { layerRank: entry.node.layerRank } : {}),
        kind: entry.node.kind,
        role: entry.node.role,
        domain: entry.node.domain,
        shape: entry.node.shape,
        ...(entry.node.expandable ? { expandable: true } : {}),
        ...(entry.node.ambientBadges && entry.node.ambientBadges.length > 0 ? { ambientBadges: entry.node.ambientBadges } : {}),
        ...(entry.node.findings && entry.node.findings.length > 0 ? { findings: entry.node.findings } : {}),
        x: cx,
        y: cy,
        w: round1(colW),
        h: round1(entry.height),
        ...(entry.node.provenance ? { provenance: entry.node.provenance } : {}),
      };
      layoutNodes.push(ln);
      nodePosById.set(ln.id, ln);
      curY += entry.height + nodeGapY;
    }

    const laneH = Math.max(116, curY - nodeGapY + lanePadBottom - primaryTopY);
    lanes.push({
      id: ld.id,
      label: ld.label,
      x: round1(curX),
      y: primaryTopY,
      w: round1(laneW),
      h: round1(laneH),
    });

    if (primaryTopY + laneH > primaryMaxBottom) primaryMaxBottom = primaryTopY + laneH;
    curX += laneW + laneGap;
  }

  for (const lane of lanes) {
    lane.h = round1(primaryMaxBottom - primaryTopY);
  }

  const primarySpanW = Math.max(460, round1(curX - laneGap - marginX));
  const midCorridorH = 54;
  let totalBottom = primaryMaxBottom + 36;
  let totalWidth = primarySpanW + marginX * 2;

  for (const ld of lateralLanes) {
    const items = byLane.get(ld.id) ?? [];
    if (items.length === 0) continue;
    laneIndexById.set(ld.id, primaryLanes.length);
    const sized = items.map((n) => ({ node: n, ...estimateNodeSize(n.label, n.sublabel, n.ambientBadges) }));
    const stripY = primaryMaxBottom + midCorridorH;
    const itemGapX = 16;
    const itemGapY = 14;
    const maxRowW = Math.max(primarySpanW - lanePadX * 2, 760);

    let rowX = marginX + lanePadX;
    let rowY = stripY + lanePadTop;
    let maxRowRight = marginX + lanePadX;
    let rowH = 52;

    for (const entry of sized) {
      if (rowX > marginX + lanePadX && rowX + entry.width > marginX + lanePadX + maxRowW) {
        rowX = marginX + lanePadX;
        rowY += rowH + itemGapY;
        rowH = entry.height;
      }
      const cx = round1(rowX + entry.width / 2);
      const cy = round1(rowY + entry.height / 2);
      const ln: LayoutNode = {
        id: entry.node.id,
        label: entry.node.label,
        sublabel: entry.node.sublabel,
        group: entry.node.group,
        lane: ld.id,
        ...(entry.node.layerAxis ? { layerAxis: entry.node.layerAxis } : {}),
        ...(entry.node.layerRank !== undefined ? { layerRank: entry.node.layerRank } : {}),
        kind: entry.node.kind,
        role: entry.node.role,
        domain: entry.node.domain,
        shape: entry.node.shape,
        ...(entry.node.expandable ? { expandable: true } : {}),
        ...(entry.node.ambientBadges && entry.node.ambientBadges.length > 0 ? { ambientBadges: entry.node.ambientBadges } : {}),
        ...(entry.node.findings && entry.node.findings.length > 0 ? { findings: entry.node.findings } : {}),
        x: cx,
        y: cy,
        w: round1(entry.width),
        h: round1(entry.height),
        ...(entry.node.provenance ? { provenance: entry.node.provenance } : {}),
      };
      layoutNodes.push(ln);
      nodePosById.set(ln.id, ln);
      rowX += entry.width + itemGapX;
      if (rowX - itemGapX > maxRowRight) maxRowRight = rowX - itemGapX;
      if (entry.height > rowH) rowH = entry.height;
    }

    const stripW = Math.max(primarySpanW, round1(maxRowRight - marginX + lanePadX));
    const stripH = round1(rowY + rowH + lanePadBottom - stripY);
    lanes.push({
      id: ld.id,
      label: ld.label,
      x: marginX,
      y: round1(stripY),
      w: stripW,
      h: stripH,
      lateral: true,
    });
    if (marginX * 2 + stripW > totalWidth) totalWidth = marginX * 2 + stripW;
    totalBottom = Math.max(totalBottom, stripY + stripH + 24);
  }

  const nodeIds = new Set(layoutNodes.map((n) => n.id));
  const sortedEdges = mergeRawEdges(rawEdges, nodeIds);
  const tiers = classifyEdgeTiers(category, layoutNodes, sortedEdges, laneIndexById, lateralLaneIds);

  const outPortGroups = new Map<string, RawDiagramEdge[]>();
  const inPortGroups = new Map<string, RawDiagramEdge[]>();
  for (const e of sortedEdges) {
    const a = nodePosById.get(e.from);
    const b = nodePosById.get(e.to);
    if (!a || !b) continue;
    const touchesLat = lateralLaneIds.has(a.lane ?? "") || lateralLaneIds.has(b.lane ?? "");
    if (touchesLat) continue;
    const la = laneIndexById.get(a.lane ?? "") ?? 0;
    const lb = laneIndexById.get(b.lane ?? "") ?? 0;
    if (lb > la) {
      const og = outPortGroups.get(e.from) ?? [];
      og.push(e);
      outPortGroups.set(e.from, og);
      const ig = inPortGroups.get(e.to) ?? [];
      ig.push(e);
      inPortGroups.set(e.to, ig);
    }
  }

  const portY = (node: LayoutNode, list: RawDiagramEdge[] | undefined, edge: RawDiagramEdge, peerId: (e: RawDiagramEdge) => string): number => {
    if (!list || list.length <= 1) return node.y;
    const ordered = [...list].sort((e1, e2) => {
      const p1 = nodePosById.get(peerId(e1))?.y ?? 0;
      const p2 = nodePosById.get(peerId(e2))?.y ?? 0;
      return p1 - p2 || peerId(e1).localeCompare(peerId(e2));
    });
    const idx = ordered.findIndex((x) => x.from === edge.from && x.to === edge.to);
    if (idx < 0) return node.y;
    const usable = Math.max(14, node.h - 20);
    const step = ordered.length > 1 ? usable / (ordered.length - 1) : 0;
    return round1(node.y - usable / 2 + idx * step);
  };

  let skipSlot = 0;
  let backSlot = 0;

  const layoutEdges: LayoutEdge[] = sortedEdges.map((e, idx) => {
    const a = nodePosById.get(e.from);
    const b = nodePosById.get(e.to);
    const tier = tiers.get(`${e.from}|${e.to}`) ?? "spine";
    const points: Array<{ x: number; y: number }> = [];

    if (a && b) {
      const aLat = lateralLaneIds.has(a.lane ?? "");
      const bLat = lateralLaneIds.has(b.lane ?? "");
      const la = laneIndexById.get(a.lane ?? "") ?? 0;
      const lb = laneIndexById.get(b.lane ?? "") ?? 0;

      if (aLat || bLat) {
        if (!aLat && bLat) {
          const sx = a.x;
          const sy = a.y + a.h / 2;
          const tx = b.x;
          const ty = b.y - b.h / 2;
          const midY = round1(primaryMaxBottom + 16 + (idx % 4) * 6);
          points.push({ x: round1(sx), y: round1(sy) }, { x: round1(sx), y: midY }, { x: round1(tx), y: midY }, { x: round1(tx), y: round1(ty) });
        } else if (aLat && !bLat) {
          const sx = a.x;
          const sy = a.y - a.h / 2;
          const tx = b.x;
          const ty = b.y + b.h / 2;
          const midY = round1(primaryMaxBottom + 20 + (idx % 4) * 6);
          points.push({ x: round1(sx), y: round1(sy) }, { x: round1(sx), y: midY }, { x: round1(tx), y: midY }, { x: round1(tx), y: round1(ty) });
        } else {
          const sy = a.y - a.h / 2;
          const ty = b.y - b.h / 2;
          const arcY = round1(Math.min(sy, ty) - 18 - (idx % 3) * 7);
          points.push({ x: a.x, y: round1(sy) }, { x: round1((a.x + b.x) / 2), y: arcY }, { x: b.x, y: round1(ty) });
        }
      } else if (lb === la + 1) {
        const sx = round1(a.x + a.w / 2);
        const sy = portY(a, outPortGroups.get(e.from), e, (x) => x.to);
        const tx = round1(b.x - b.w / 2);
        const ty = portY(b, inPortGroups.get(e.to), e, (x) => x.from);
        const dx = Math.max(24, (tx - sx) * 0.48);
        points.push(
          { x: sx, y: sy },
          { x: round1(sx + dx), y: sy },
          { x: round1(tx - dx), y: ty },
          { x: tx, y: ty },
        );
      } else if (lb > la + 1) {
        const sx = round1(a.x + a.w / 2);
        const sy = portY(a, outPortGroups.get(e.from), e, (x) => x.to);
        const tx = round1(b.x - b.w / 2);
        const ty = portY(b, inPortGroups.get(e.to), e, (x) => x.from);
        const slot = skipSlot % 6;
        const laneY = round1(14 + slot * 6.5);
        const outGutterX = round1(sx + 18 + (slot % 3) * 7);
        const inGutterX = round1(tx - 18 - (slot % 3) * 7);
        skipSlot += 1;
        points.push(
          { x: sx, y: sy },
          { x: outGutterX, y: sy },
          { x: outGutterX, y: laneY },
          { x: inGutterX, y: laneY },
          { x: inGutterX, y: ty },
          { x: tx, y: ty },
        );
      } else if (lb < la) {
        const sx = round1(a.x - a.w / 2);
        const sy = round1(a.y + a.h * 0.22);
        const tx = round1(b.x + b.w / 2);
        const ty = round1(b.y + b.h * 0.22);
        const slot = backSlot % 5;
        const arcY = round1(primaryMaxBottom + 14 + slot * 8);
        const outGutterX = round1(sx - 18 - (slot % 3) * 7);
        const inGutterX = round1(tx + 18 + (slot % 3) * 7);
        backSlot += 1;
        points.push(
          { x: sx, y: sy },
          { x: outGutterX, y: sy },
          { x: outGutterX, y: arcY },
          { x: inGutterX, y: arcY },
          { x: inGutterX, y: ty },
          { x: tx, y: ty },
        );
      } else {
        const rightEdge = round1(Math.max(a.x + a.w / 2, b.x + b.w / 2) + 22 + (idx % 3) * 8);
        points.push(
          { x: round1(a.x + a.w / 2), y: a.y },
          { x: rightEdge, y: round1((a.y + b.y) / 2) },
          { x: round1(b.x + b.w / 2), y: b.y },
        );
      }
    }

    return {
      id: `${id}:e${idx}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      tier,
      ...(e.label ? { label: e.label } : {}),
      ...(e.weight ? { weight: e.weight } : {}),
      ...(e.violation ? { violation: true } : {}),
      ...(e.bidirectional ? { bidirectional: true } : {}),
      confidence: e.confidence ?? "observed",
      ...(e.ruleIds && e.ruleIds.length > 0 ? { ruleIds: e.ruleIds } : {}),
      ...(e.evidence && e.evidence.length > 0 ? { evidence: e.evidence } : {}),
      points,
    };
  });

  return {
    id,
    title,
    subtitle,
    category,
    ...(opts?.ownerId ? { ownerId: opts.ownerId } : {}),
    ...(opts?.parentDiagramId ? { parentDiagramId: opts.parentDiagramId } : {}),
    rankdir: "LR",
    width: Math.max(460, round1(totalWidth)),
    height: Math.max(240, round1(totalBottom)),
    lanes,
    ...(opts?.unconnectedNodes && opts.unconnectedNodes.length > 0 ? { unconnectedNodes: opts.unconnectedNodes } : {}),
    ...(opts?.foldedCount && opts.foldedCount > 0 ? { foldedCount: opts.foldedCount } : {}),
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}

function runtimeLaneForNode(n: SpecNode): string {
  if (n.kind === "native_app" || n.meta.archetype === "frontend_app") return "clients";
  if (
    n.meta.hasGeneratedClient === true ||
    n.role === "ingress" ||
    (n.kind === "iac_resource" && n.meta.plane === "network")
  ) {
    return "ingress";
  }
  if (n.kind === "app") return "services";
  if (n.kind === "package" || n.kind === "analyzer" || n.kind === "test_package") return "libraries";
  if (n.kind === "datastore" || n.kind === "external_service") return "state_outside";
  return "lateral";
}

function buildSystemTopologyDiagram(
  nodes: SpecNode[],
  edges: SpecEdge[],
  expandableOwners: Set<string>,
): DiagramLayout {
  const totalUnitFiles = nodes
    .filter((n) => ["app", "package", "native_app"].includes(n.kind))
    .reduce((sum, n) => sum + (typeof n.meta.totalFiles === "number" ? n.meta.totalFiles : 0), 0);

  const unitHasDirectRuntimeSink = new Set<string>();
  for (const e of edges) {
    if (["reads_writes", "calls_external", "routes_to", "analyzes"].includes(e.kind)) {
      unitHasDirectRuntimeSink.add(e.from);
      unitHasDirectRuntimeSink.add(e.to);
    }
  }

  const appsAndNative = nodes.filter((n) => n.kind === "app" || n.kind === "native_app");
  const analyzers = nodes.filter((n) => n.kind === "analyzer");
  const importantPackages = nodes.filter((n) => {
    if (n.kind !== "package") return false;
    if (n.meta.hasGeneratedClient === true) return true;
    if (unitHasDirectRuntimeSink.has(n.id)) return true;
    const files = typeof n.meta.totalFiles === "number" ? n.meta.totalFiles : 0;
    if (totalUnitFiles > 0 && files / totalUnitFiles >= 0.1) return true;
    return appsAndNative.length === 0;
  });

  const extraTestPkgs = appsAndNative.length === 0 ? nodes.filter((n) => n.kind === "test_package") : [];
  const allCandidateUnits = [...appsAndNative, ...importantPackages, ...analyzers, ...extraTestPkgs];
  const uniqueUnits = Array.from(new Map(allCandidateUnits.map((n) => [n.id, n])).values());
  const allPackagesCount = nodes.filter((n) => n.kind === "package").length;
  const foldedPackages = Math.max(0, allPackagesCount - importantPackages.length);

  const edgeLb = nodes.find((n) => n.kind === "iac_resource" && n.meta.resourceType === "google_compute_url_map");
  const scheduler = nodes.find((n) => n.kind === "iac_resource" && n.meta.resourceType === "google_cloud_scheduler_job");
  const datastores = nodes.filter((n) => n.kind === "datastore");
  const allExternals = nodes.filter((n) => n.kind === "external_service");

  const ambientExtIds = new Set<string>();
  const callerCountByExt = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === "calls_external") {
      callerCountByExt.set(e.to, (callerCountByExt.get(e.to) ?? 0) + 1);
    }
  }
  for (const ext of allExternals) {
    const cat = String(ext.meta.category ?? ext.group ?? "");
    const callers = callerCountByExt.get(ext.id) ?? 0;
    if (cat === "observability" || (appsAndNative.length >= 4 && callers >= Math.ceil(appsAndNative.length * 0.5))) {
      ambientExtIds.add(ext.id);
    }
  }

  const ambientBadgesByCaller = new Map<string, Set<string>>();
  const extLabelById = new Map(allExternals.map((e) => [e.id, e.label]));
  for (const e of edges) {
    if (e.kind === "calls_external" && ambientExtIds.has(e.to)) {
      const set = ambientBadgesByCaller.get(e.from) ?? new Set<string>();
      set.add(extLabelById.get(e.to) ?? "Telemetry");
      ambientBadgesByCaller.set(e.from, set);
    }
  }

  const visibleExternals = allExternals
    .filter((e) => !ambientExtIds.has(e.id))
    .sort((a, b) => {
      const av = (a.findings?.length ?? 0) > 0 ? 1 : 0;
      const bv = (b.findings?.length ?? 0) > 0 ? 1 : 0;
      if (av !== bv) return bv - av;
      return Number(b.meta.refCount ?? 0) - Number(a.meta.refCount ?? 0) || a.id.localeCompare(b.id);
    });
  const keptExternals = visibleExternals.slice(0, 12);
  const foldedExternals = Math.max(0, visibleExternals.length - keptExternals.length);

  const rawNodes: RawDiagramNode[] = [];
  for (const u of uniqueUnits) {
    const badges = Array.from(ambientBadgesByCaller.get(u.id) ?? []).sort();
    const shape: "box" | "hex" = u.kind === "package" || u.kind === "analyzer" ? "hex" : "box";
    const subParts: string[] = [u.meta.hasGeneratedClient ? "OpenAPI SDK" : String(u.meta.language ?? u.meta.ecosystem ?? u.kind)];
    if (expandableOwners.has(u.id)) subParts.push("⊞ layers");
    rawNodes.push({
      id: u.id,
      label: shortPkg(u.label),
      sublabel: subParts.join(" · "),
      group: u.group ?? u.kind,
      lane: runtimeLaneForNode(u),
      kind: u.kind,
      role: u.role,
      domain: "arch",
      shape,
      expandable: expandableOwners.has(u.id),
      ambientBadges: badges,
      findings: u.findings,
      provenance: u.provenance,
    });
  }

  if (edgeLb) {
    rawNodes.push({
      id: edgeLb.id,
      label: "Edge HTTPS LB",
      sublabel: "Load Balancer",
      group: "edge",
      lane: "ingress",
      kind: edgeLb.kind,
      role: "ingress",
      domain: "iac",
      shape: "pill",
      findings: edgeLb.findings,
      provenance: edgeLb.provenance,
    });
  }
  if (scheduler) {
    rawNodes.push({
      id: scheduler.id,
      label: "Cloud Scheduler",
      sublabel: "cron triggers",
      group: "edge",
      lane: "ingress",
      kind: scheduler.kind,
      role: "ingress",
      domain: "iac",
      shape: "pill",
      findings: scheduler.findings,
      provenance: scheduler.provenance,
    });
  }
  for (const ds of datastores) {
    const count = ds.meta.collectionCount ?? ds.meta.tableCount ?? ds.meta.entityCount ?? 0;
    const suffix = ds.meta.tableCount ? "tables" : ds.meta.collectionCount ? "collections" : "entities";
    rawNodes.push({
      id: ds.id,
      label: ds.label,
      sublabel: `${String(count)} ${suffix}`,
      group: "data",
      lane: "state_outside",
      kind: ds.kind,
      role: "datastore",
      domain: "arch",
      shape: "db",
      findings: ds.findings,
      provenance: ds.provenance,
    });
  }
  for (const ext of keptExternals) {
    rawNodes.push({
      id: ext.id,
      label: ext.label,
      sublabel: `${String(ext.meta.category ?? "api")}`,
      group: "external",
      lane: "state_outside",
      kind: ext.kind,
      role: "external",
      domain: "arch",
      shape: "pill",
      findings: ext.findings,
      provenance: ext.provenance,
    });
  }

  const candidateIds = new Set(rawNodes.map((n) => n.id));
  const rawEdges: RawDiagramEdge[] = [];
  for (const e of edges) {
    if (!candidateIds.has(e.from) || !candidateIds.has(e.to)) continue;
    if (["depends_on", "analyzes", "routes_to", "reads_writes", "calls_external", "triggers"].includes(e.kind)) {
      rawEdges.push({
        from: e.from,
        to: e.to,
        kind: e.kind,
        label: e.label,
        weight: e.weight,
        violation: e.violation,
        confidence: e.confidence,
        ruleIds: e.ruleIds,
        evidence: e.evidence,
      });
    }
  }

  if (edgeLb) {
    const apiNode = uniqueUnits.find((n) => n.kind === "app" && (n.meta.hasOpenApi === true || n.label.includes("api")));
    const openApiClients = uniqueUnits.filter((n) => n.meta.hasGeneratedClient === true);
    if (apiNode) {
      for (const client of openApiClients) {
        rawEdges.push({ from: client.id, to: edgeLb.id, kind: "routes_to", label: "HTTPS", confidence: "inferred" });
      }
      rawEdges.push({ from: edgeLb.id, to: apiNode.id, kind: "routes_to", label: "HTTPS", confidence: "observed" });
      if (scheduler) {
        rawEdges.push({ from: scheduler.id, to: apiNode.id, kind: "triggers", label: "cron", confidence: "inferred" });
      }
    }
  }

  const connectedIds = new Set<string>();
  for (const e of rawEdges) {
    if (candidateIds.has(e.from) && candidateIds.has(e.to) && e.from !== e.to) {
      connectedIds.add(e.from);
      connectedIds.add(e.to);
    }
  }

  const visibleNodes = rawEdges.length > 0 ? rawNodes.filter((n) => connectedIds.has(n.id) || (n.findings?.length ?? 0) > 0) : rawNodes;
  const unconnectedNodes = rawEdges.length > 0
    ? rawNodes
        .filter((n) => !connectedIds.has(n.id) && (n.findings?.length ?? 0) === 0)
        .map((n) => ({ id: n.id, label: n.label, kind: n.kind }))
    : [];

  return layoutFixedLanes(
    "system_topology",
    "Runtime Map — End-to-End Architecture",
    "Fixed-rank lanes from clients & ingress through services to datastores & external services. Hover any node to trace its connections; double-click ⊞ to inspect layers.",
    "runtime",
    [
      { id: "clients", label: "Clients" },
      { id: "ingress", label: "Ingress & SDK" },
      { id: "services", label: "Services" },
      { id: "libraries", label: "Libraries & Analyzers" },
      { id: "state_outside", label: "State & External" },
      { id: "lateral", label: "Cross-Cutting", lateral: true },
    ],
    visibleNodes,
    rawEdges,
    {
      unconnectedNodes,
      foldedCount: foldedPackages + foldedExternals,
    },
  );
}

function buildOwnerLayersDiagram(
  ownerId: string,
  ownerLabel: string,
  layerNodes: SpecNode[],
  allNodes: SpecNode[],
  allEdges: SpecEdge[],
): DiagramLayout {
  const slug = shortPkg(ownerLabel).replace(/^arch:[a-z_]+:/, "");
  const layerIds = new Set(layerNodes.map((n) => n.id));
  const laneLabels = new Map<string, string>();

  const rawNodes: RawDiagramNode[] = layerNodes.map((n) => {
    const canonical = typeof n.meta.canonicalLayer === "string" ? n.meta.canonicalLayer : "unclassified";
    const layerAxis = (n.meta.layerAxis === "pipeline" || n.meta.layerAxis === "integration" || n.meta.layerAxis === "foundation"
      ? n.meta.layerAxis
      : "foundation") as LayerAxis;
    const layerRank = typeof n.meta.layerRank === "number" ? n.meta.layerRank : 5;
    const laneId = typeof n.meta.laneId === "string" ? n.meta.laneId : "lateral";
    const laneLabel = typeof n.meta.laneLabel === "string" ? n.meta.laneLabel : "Shared Foundation";
    if (!laneLabels.has(laneId)) laneLabels.set(laneId, laneLabel);
    const fileCount = Number(n.meta.fileCount ?? 0);
    return {
      id: n.id,
      label: `${n.label}/`,
      sublabel: `${fileCount} files · ${canonical}${fileCount >= 2 ? " · ⊞" : ""}`,
      group: canonical,
      lane: laneId,
      layerAxis,
      layerRank,
      kind: n.kind,
      role: "layer",
      domain: "arch",
      shape: "box",
      ...(fileCount >= 2 ? { expandable: true } : {}),
      findings: n.findings,
      provenance: n.provenance,
    };
  });

  const rawEdges: RawDiagramEdge[] = [];
  const datastores = new Map(allNodes.filter((n) => n.kind === "datastore").map((n) => [n.id, n]));
  const extServices = new Map(allNodes.filter((n) => n.kind === "external_service").map((n) => [n.id, n]));
  const addedDatastores = new Set<string>();
  const extSinkByLayer = new Map<string, { count: number; violation: boolean; ruleIds: string[]; evidence: EdgeEvidenceItem[] }>();
  const uniqueVendorsForOwner = new Set<string>();

  for (const e of allEdges) {
    if (layerIds.has(e.from) && layerIds.has(e.to)) {
      rawEdges.push({
        from: e.from,
        to: e.to,
        kind: e.kind,
        label: e.label,
        weight: e.weight,
        violation: e.violation,
        confidence: e.confidence,
        ruleIds: e.ruleIds,
        evidence: e.evidence,
      });
    } else if (layerIds.has(e.from) && datastores.has(e.to)) {
      const ds = datastores.get(e.to);
      if (ds && !addedDatastores.has(ds.id)) {
        addedDatastores.add(ds.id);
        const count = ds.meta.collectionCount ?? ds.meta.tableCount ?? ds.meta.entityCount ?? 0;
        rawNodes.push({
          id: ds.id,
          label: ds.label,
          sublabel: `${String(count)} entities`,
          group: "sink",
          lane: "sinks",
          layerAxis: "integration",
          layerRank: 4,
          kind: ds.kind,
          role: "datastore",
          domain: "arch",
          shape: "db",
          findings: ds.findings,
          provenance: ds.provenance,
        });
      }
      rawEdges.push({
        from: e.from,
        to: e.to,
        kind: e.kind,
        label: e.label,
        weight: e.weight,
        violation: e.violation,
        confidence: e.confidence,
        ruleIds: e.ruleIds,
        evidence: e.evidence,
      });
    } else if (layerIds.has(e.from) && extServices.has(e.to)) {
      uniqueVendorsForOwner.add(e.to);
      const cur = extSinkByLayer.get(e.from);
      if (cur) {
        cur.count += e.weight ?? 1;
        cur.violation = cur.violation || Boolean(e.violation);
        if (e.ruleIds) cur.ruleIds.push(...e.ruleIds);
        if (e.evidence) cur.evidence.push(...e.evidence);
      } else {
        extSinkByLayer.set(e.from, {
          count: e.weight ?? 1,
          violation: Boolean(e.violation),
          ruleIds: [...(e.ruleIds ?? [])],
          evidence: [...(e.evidence ?? [])],
        });
      }
    }
  }

  if (extSinkByLayer.size > 0) {
    const sinkId = `arch:ext:vendors:${slug}`;
    rawNodes.push({
      id: sinkId,
      label: "External APIs",
      sublabel: `${uniqueVendorsForOwner.size} service${uniqueVendorsForOwner.size === 1 ? "" : "s"}`,
      group: "sink",
      lane: "sinks",
      layerAxis: "integration",
      layerRank: 4,
      kind: "external_service",
      role: "external",
      domain: "arch",
      shape: "pill",
    });
    for (const [fromLayer, info] of extSinkByLayer) {
      rawEdges.push({
        from: fromLayer,
        to: sinkId,
        kind: "calls_external",
        label: String(info.count),
        weight: info.count,
        violation: info.violation,
        confidence: "observed",
        ruleIds: info.ruleIds.length > 0 ? Array.from(new Set(info.ruleIds)).sort() : undefined,
        evidence: info.evidence.slice(0, 10),
      });
    }
  }

  const laneOrder: LaneDef[] = [
    { id: "entry", label: laneLabels.get("entry") ?? "Entry & Routes" },
    { id: "controllers", label: laneLabels.get("controllers") ?? "Controllers" },
    { id: "logic", label: laneLabels.get("logic") ?? "Orchestration" },
    { id: "adapters", label: laneLabels.get("adapters") ?? "Persistence & Integration" },
    { id: "sinks", label: "Stores & External" },
    { id: "lateral", label: laneLabels.get("lateral") ?? "Shared Foundation", lateral: true },
  ];

  return layoutFixedLanes(
    `layers:${slug}`,
    `${slug} — Internal Layer Flow`,
    "Showing architectural spine + violations at rest. Hover any layer to reveal its full 1-hop imports, or switch to Matrix (DSM) for zero-crossing full density.",
    "layers",
    laneOrder,
    rawNodes,
    rawEdges,
    { ownerId },
  );
}

function buildDomainCouplingDiagram(nodes: SpecNode[], edges: SpecEdge[]): DiagramLayout {
  const domainNodes = nodes.filter((n) => n.kind === "domain_area");
  const domainIds = new Set(domainNodes.map((n) => n.id));
  const domainEdges = edges.filter((e) => e.kind === "imports_domain" && domainIds.has(e.from) && domainIds.has(e.to));

  const violatingDomIds = new Set<string>();
  for (const e of domainEdges) {
    if (e.violation) {
      violatingDomIds.add(e.from);
      violatingDomIds.add(e.to);
    }
  }

  const sortedDomains = [...domainNodes].sort((a, b) => {
    const av = violatingDomIds.has(a.id) ? 1 : 0;
    const bv = violatingDomIds.has(b.id) ? 1 : 0;
    if (av !== bv) return bv - av;
    return Number(b.meta.fileCount ?? 0) - Number(a.meta.fileCount ?? 0) || a.id.localeCompare(b.id);
  });
  const keptDomains = sortedDomains.slice(0, 20);
  const foldedCount = Math.max(0, sortedDomains.length - keptDomains.length);
  const keptIds = new Set(keptDomains.map((d) => d.id));

  const pairWeights = new Map<string, { weight: number; violation: boolean; ruleIds: string[]; evidence: EdgeEvidenceItem[] }>();
  for (const e of domainEdges) {
    if (!keptIds.has(e.from) || !keptIds.has(e.to)) continue;
    pairWeights.set(`${e.from}>${e.to}`, {
      weight: e.weight ?? 1,
      violation: Boolean(e.violation),
      ruleIds: e.ruleIds ?? [],
      evidence: e.evidence ?? [],
    });
  }

  const handledPairs = new Set<string>();
  const rawEdges: RawDiagramEdge[] = [];
  for (const e of domainEdges) {
    if (!keptIds.has(e.from) || !keptIds.has(e.to)) continue;
    const revKey = `${e.to}>${e.from}`;
    const canonKey = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    if (handledPairs.has(canonKey)) continue;
    const rev = pairWeights.get(revKey);
    if (rev) {
      handledPairs.add(canonKey);
      rawEdges.push({
        from: e.from,
        to: e.to,
        kind: "imports_domain",
        label: `${e.weight ?? 1} ⇄ ${rev.weight}`,
        weight: (e.weight ?? 1) + rev.weight,
        violation: Boolean(e.violation || rev.violation),
        bidirectional: true,
        confidence: "observed",
        ruleIds: Array.from(new Set([...(e.ruleIds ?? []), ...rev.ruleIds])).sort(),
        evidence: [...(e.evidence ?? []), ...rev.evidence].slice(0, 12),
      });
    } else {
      handledPairs.add(canonKey);
      rawEdges.push({
        from: e.from,
        to: e.to,
        kind: "imports_domain",
        label: String(e.weight ?? 1),
        weight: e.weight ?? 1,
        violation: e.violation,
        confidence: "observed",
        ruleIds: e.ruleIds,
        evidence: e.evidence,
      });
    }
  }

  const rawNodes: RawDiagramNode[] = keptDomains.map((n) => ({
    id: n.id,
    label: n.label,
    sublabel: `${String(n.meta.fileCount ?? 0)} files`,
    group: n.group ?? "domain",
    kind: n.kind,
    role: "domain",
    domain: "arch",
    shape: "pill",
    findings: n.findings,
    provenance: n.provenance,
  }));

  return layoutWithDagre(
    "domain_coupling",
    "Domain Coupling — Bounded Contexts",
    "Top dependencies + bidirectional cycles (red). Switch to Matrix (DSM) to inspect every cross-domain import with zero overlapping wires.",
    "domains",
    "TB",
    rawNodes,
    rawEdges,
    { nodesep: 28, ranksep: 58, foldedCount },
  );
}

function buildWorkspaceDagDiagram(
  nodes: SpecNode[],
  edges: SpecEdge[],
  expandableOwners: Set<string>,
): DiagramLayout {
  const units = nodes.filter(
    (n) => n.kind === "app" || n.kind === "package" || n.kind === "test_package" || n.kind === "analyzer",
  );
  const unitIds = new Set(units.map((u) => u.id));
  const rawEdges: RawDiagramEdge[] = edges
    .filter((e) => (e.kind === "depends_on" || e.kind === "analyzes") && unitIds.has(e.from) && unitIds.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
      violation: e.violation,
      confidence: e.confidence,
      ruleIds: e.ruleIds,
      evidence: e.evidence,
    }));

  const rawNodes: RawDiagramNode[] = units.map((u) => ({
    id: u.id,
    label: shortPkg(u.label),
    sublabel: expandableOwners.has(u.id) ? `${u.kind} · ⊞ layers` : String(u.meta.ecosystem ?? u.kind),
    group: u.group ?? u.kind,
    kind: u.kind,
    role: u.role,
    domain: "arch",
    shape: u.kind === "package" || u.kind === "analyzer" ? "hex" : "box",
    expandable: expandableOwners.has(u.id),
    findings: u.findings,
    provenance: u.provenance,
  }));

  return layoutWithDagre(
    "workspace_dag",
    "Packages & Workspace Dependency DAG",
    "Manifest-declared dependencies and analyzer links across all workspace units.",
    "packages",
    "LR",
    rawNodes,
    rawEdges,
    { nodesep: 20, ranksep: 64 },
  );
}

function buildStateMachineDiagram(sm: StateMachineRecord): DiagramLayout {
  const rawNodes: RawDiagramNode[] = sm.states.map((st) => ({
    id: `${sm.id}:state:${st}`,
    label: st,
    sublabel: sm.unit,
    group: "state",
    kind: "state_machine",
    role: "domain",
    domain: "arch",
    shape: "pill",
    provenance: sm.provenance,
  }));

  const rawEdges: RawDiagramEdge[] = sm.transitions.map((t) => ({
    from: `${sm.id}:state:${t.from}`,
    to: `${sm.id}:state:${t.to}`,
    kind: "triggers",
    label: t.guard ? `${t.event} [guard]` : t.event,
    confidence: sm.evidence === "declared" ? "observed" : "inferred",
    evidence: [
      {
        file: sm.provenance.file,
        line: sm.provenance.line,
        detail: `${t.from} --(${t.event}${t.guard ? ` when ${t.guard}` : ""})--> ${t.to}`,
      },
    ],
  }));

  return layoutWithDagre(
    `behavior:${sm.id}`,
    `${sm.name} — State Machine`,
    `${sm.language} · ${sm.unit} · ${sm.states.length} states · ${sm.transitions.length} transitions (${sm.evidence})`,
    "behavior",
    "LR",
    rawNodes,
    rawEdges,
    { nodesep: 30, ranksep: 74 },
  );
}

function buildDeliveryDiagram(nodes: SpecNode[], edges: SpecEdge[]): DiagramLayout {
  const wfs = nodes.filter((n) => n.kind === "workflow");
  const units = nodes.filter((n) => n.kind === "app" || n.kind === "package");
  const iac = nodes.filter(
    (n) =>
      (n.kind === "iac_resource" && (n.meta.plane === "compute" || n.meta.plane === "network")) ||
      n.kind === "iac_container",
  );

  const candidateIds = new Set([...wfs, ...units, ...iac].map((n) => n.id));
  const rawEdges: RawDiagramEdge[] = edges
    .filter(
      (e) =>
        ["deploys", "triggers", "routes_to", "verifies", "builds_image"].includes(e.kind) &&
        candidateIds.has(e.from) &&
        candidateIds.has(e.to),
    )
    .map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
      violation: e.violation,
      confidence: e.confidence,
      ruleIds: e.ruleIds,
      evidence: e.evidence,
    }));

  const connected = new Set<string>();
  for (const e of rawEdges) {
    connected.add(e.from);
    connected.add(e.to);
  }

  const keptWfs = wfs.filter((w) => connected.has(w.id)).slice(0, 14);
  const keptUnits = units.filter((u) => connected.has(u.id)).slice(0, 14);
  const keptIac = iac.filter((r) => connected.has(r.id)).slice(0, 12);

  const rawNodes: RawDiagramNode[] = [
    ...keptWfs.map((w) => ({
      id: w.id,
      label: w.label.length > 26 ? `${w.label.slice(0, 24)}…` : w.label,
      sublabel: `${String(w.meta.jobCount ?? 0)} jobs`,
      group: "ci",
      kind: w.kind,
      role: "ci" as const,
      domain: "ci" as const,
      shape: "pill" as const,
      findings: w.findings,
      provenance: w.provenance,
    })),
    ...keptUnits.map((u) => ({
      id: u.id,
      label: shortPkg(u.label),
      sublabel: String(u.meta.ecosystem ?? u.kind),
      group: "unit",
      kind: u.kind,
      role: u.role,
      domain: "arch" as const,
      shape: (u.kind === "package" ? "hex" : "box") as "hex" | "box",
      findings: u.findings,
      provenance: u.provenance,
    })),
    ...keptIac.map((r) => ({
      id: r.id,
      label: r.label.length > 26 ? `${r.label.slice(0, 24)}…` : r.label,
      sublabel: String(r.meta.plane ?? "iac"),
      group: "iac",
      kind: r.kind,
      role: "iac" as const,
      domain: "iac" as const,
      shape: "hex" as const,
      findings: r.findings,
      provenance: r.provenance,
    })),
  ];

  return layoutWithDagre(
    "ci_iac_flow",
    "Delivery — CI Workflows, Units & Infrastructure",
    "Workflows verifying, building container images, and deploying workspace units and cloud compute resources.",
    "delivery",
    "LR",
    rawNodes,
    rawEdges,
    { nodesep: 18, ranksep: 64 },
  );
}

export function buildAllDiagrams(
  nodes: SpecNode[],
  edges: SpecEdge[],
  stateMachines: StateMachineRecord[],
  extraDiagrams: DiagramLayout[] = [],
): DiagramLayout[] {
  const layerNodesByOwner = new Map<string, SpecNode[]>();
  for (const n of nodes) {
    if (n.kind === "code_layer" && n.ownerId) {
      const list = layerNodesByOwner.get(n.ownerId) ?? [];
      list.push(n);
      layerNodesByOwner.set(n.ownerId, list);
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const ownerDiagrams: DiagramLayout[] = [];
  const expandableOwners = new Set<string>();

  for (const extra of extraDiagrams) {
    if (extra.category === "modules" && extra.ownerId) {
      expandableOwners.add(extra.ownerId);
    }
  }

  for (const [ownerId, layerList] of Array.from(layerNodesByOwner.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (layerList.length < 2) continue;
    const ownerNode = nodeById.get(ownerId);
    const diag = buildOwnerLayersDiagram(ownerId, ownerNode?.label ?? ownerId, layerList, nodes, edges);
    if (diag.edges.length > 0) {
      ownerDiagrams.push(diag);
      expandableOwners.add(ownerId);
    }
  }
  ownerDiagrams.sort((a, b) => b.edges.length - a.edges.length || a.id.localeCompare(b.id));

  const diagrams: DiagramLayout[] = [];
  const runtimeDiag = buildSystemTopologyDiagram(nodes, edges, expandableOwners);
  if (runtimeDiag.nodes.length > 0) diagrams.push(runtimeDiag);

  diagrams.push(...extraDiagrams);
  diagrams.push(...ownerDiagrams);

  const domDiag = buildDomainCouplingDiagram(nodes, edges);
  if (domDiag.nodes.length >= 3 && domDiag.edges.length > 0) {
    diagrams.push(domDiag);
  }

  const wsDiag = buildWorkspaceDagDiagram(nodes, edges, expandableOwners);
  const runtimeSignature = runtimeDiag.nodes.map((n) => n.id).sort().join("|");
  const wsSignature = wsDiag.nodes.map((n) => n.id).sort().join("|");
  if (wsDiag.nodes.length >= 3 && wsDiag.edges.length > 0 && wsSignature !== runtimeSignature) {
    diagrams.push(wsDiag);
  }

  const delDiag = buildDeliveryDiagram(nodes, edges);
  if (delDiag.nodes.length >= 2 && delDiag.edges.length > 0) {
    diagrams.push(delDiag);
  }

  const drawableMachines = stateMachines
    .filter((m) => m.transitions.length > 0 && m.states.length >= 2)
    .sort((a, b) => b.transitions.length - a.transitions.length || a.name.localeCompare(b.name))
    .slice(0, 20);
  for (const sm of drawableMachines) {
    diagrams.push(buildStateMachineDiagram(sm));
  }

  return diagrams;
}

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
