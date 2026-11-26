import type { DiagramLane, DiagramLayout, LayoutEdge, LayoutNode } from "../../schema.ts";
import {
  classifyEdgeTiers,
  estimateNodeSize,
  mergeRawEdges,
  round1,
  type LaneDef,
  type RawDiagramEdge,
  type RawDiagramNode,
} from "./dagreEngine.ts";

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
        layerAxis: entry.node.layerAxis,
        layerRank: entry.node.layerRank,
        kind: entry.node.kind,
        role: entry.node.role,
        domain: entry.node.domain,
        shape: entry.node.shape,
        expandable: entry.node.expandable ? true : undefined,
        ambientBadges: entry.node.ambientBadges && entry.node.ambientBadges.length > 0 ? entry.node.ambientBadges : undefined,
        findings: entry.node.findings && entry.node.findings.length > 0 ? entry.node.findings : undefined,
        x: cx,
        y: cy,
        w: round1(colW),
        h: round1(entry.height),
        provenance: entry.node.provenance,
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
        layerAxis: entry.node.layerAxis,
        layerRank: entry.node.layerRank,
        kind: entry.node.kind,
        role: entry.node.role,
        domain: entry.node.domain,
        shape: entry.node.shape,
        expandable: entry.node.expandable ? true : undefined,
        ambientBadges: entry.node.ambientBadges && entry.node.ambientBadges.length > 0 ? entry.node.ambientBadges : undefined,
        findings: entry.node.findings && entry.node.findings.length > 0 ? entry.node.findings : undefined,
        x: cx,
        y: cy,
        w: round1(entry.width),
        h: round1(entry.height),
        provenance: entry.node.provenance,
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

  const tierKind =
    category === "modules" || category === "subsystem"
      ? ("inferred_dag_tiers" as const)
      : category === "layers"
        ? ("enforced_layer_policy" as const)
        : undefined;

  return {
    id,
    title,
    subtitle,
    category,
    tierKind,
    ownerId: opts?.ownerId,
    parentDiagramId: opts?.parentDiagramId,
    rankdir: "LR",
    width: Math.max(460, round1(totalWidth)),
    height: Math.max(240, round1(totalBottom)),
    lanes,
    unconnectedNodes: opts?.unconnectedNodes && opts.unconnectedNodes.length > 0 ? opts.unconnectedNodes : undefined,
    foldedCount: opts?.foldedCount && opts.foldedCount > 0 ? opts.foldedCount : undefined,
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}
