import type { DiagramLayout, LayoutEdge, LayoutNode } from "../schema.ts";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface DiffDiagramNode extends LayoutNode {
  diffStatus: DiffStatus;
  deltaLabel?: string;
}

export interface DiffDiagramEdge extends LayoutEdge {
  diffStatus: DiffStatus;
}

export interface DiffDiagramBundle {
  id: string;
  label: string;
  overlay: Omit<DiagramLayout, "nodes" | "edges"> & {
    nodes: DiffDiagramNode[];
    edges: DiffDiagramEdge[];
  };
  before: DiagramLayout | null;
  after: DiagramLayout | null;
  changedCount: number;
}

export function buildOverlayBundle(
  id: string,
  label: string,
  baseDiag: DiagramLayout | null,
  headDiag: DiagramLayout | null,
  modifiedNodeIds: Set<string>,
  deltaByNodeId: Map<string, string>,
): DiffDiagramBundle | null {
  if (!headDiag && !baseDiag) return null;
  const primary = headDiag ?? baseDiag;
  if (!primary) return null;

  const baseNodesById = new Map((baseDiag?.nodes ?? []).map((n) => [n.id, n]));
  const headNodesById = new Map((headDiag?.nodes ?? []).map((n) => [n.id, n]));
  const baseEdgeKeys = new Set((baseDiag?.edges ?? []).map((e) => `${e.from}|${e.to}|${e.kind}`));
  const headEdgeKeys = new Set((headDiag?.edges ?? []).map((e) => `${e.from}|${e.to}|${e.kind}`));

  const overlayNodes: DiffDiagramNode[] = [];
  let changedCount = 0;

  for (const n of headDiag?.nodes ?? []) {
    const existed = baseNodesById.has(n.id);
    const diffStatus: DiffStatus = !existed ? "added" : modifiedNodeIds.has(n.id) ? "modified" : "unchanged";
    if (diffStatus !== "unchanged") changedCount += 1;
    overlayNodes.push({
      ...n,
      diffStatus,
      deltaLabel: deltaByNodeId.get(n.id),
    });
  }

  const maxYByLane = new Map<string, number>();
  for (const n of overlayNodes) {
    const key = n.lane ?? "_";
    maxYByLane.set(key, Math.max(maxYByLane.get(key) ?? 40, n.y + n.h / 2));
  }
  const laneXById = new Map((primary.lanes ?? []).map((l) => [l.id, l.x + l.w / 2]));
  let overlayHeight = primary.height;

  for (const bn of baseDiag?.nodes ?? []) {
    if (headNodesById.has(bn.id)) continue;
    changedCount += 1;
    const laneKey = bn.lane ?? "_";
    const placeX = laneXById.get(laneKey) ?? bn.x;
    const prevBottom = maxYByLane.get(laneKey) ?? bn.y;
    const placeY = prevBottom + 18 + bn.h / 2;
    maxYByLane.set(laneKey, placeY + bn.h / 2);
    overlayHeight = Math.max(overlayHeight, placeY + bn.h / 2 + 44);
    overlayNodes.push({
      ...bn,
      x: placeX,
      y: placeY,
      diffStatus: "removed",
      deltaLabel: "removed",
    });
  }

  const posById = new Map(overlayNodes.map((n) => [n.id, n]));
  const overlayEdges: DiffDiagramEdge[] = [];

  for (const e of headDiag?.edges ?? []) {
    const k = `${e.from}|${e.to}|${e.kind}`;
    const diffStatus: DiffStatus = baseEdgeKeys.has(k) ? "unchanged" : "added";
    if (diffStatus !== "unchanged") changedCount += 1;
    overlayEdges.push({ ...e, diffStatus, tier: diffStatus === "added" ? "spine" : e.tier });
  }

  let remSeq = 0;
  for (const be of baseDiag?.edges ?? []) {
    const k = `${be.from}|${be.to}|${be.kind}`;
    if (headEdgeKeys.has(k)) continue;
    const a = posById.get(be.from);
    const b = posById.get(be.to);
    if (!a || !b) continue;
    changedCount += 1;
    const sx = a.x + a.w / 2;
    const tx = b.x - b.w / 2;
    const dx = Math.max(24, Math.abs(tx - sx) * 0.45);
    const pts =
      tx >= sx
        ? [
            { x: sx, y: a.y },
            { x: sx + dx, y: a.y },
            { x: tx - dx, y: b.y },
            { x: tx, y: b.y },
          ]
        : [
            { x: a.x, y: a.y + a.h / 2 },
            { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 46 },
            { x: b.x, y: b.y + b.h / 2 },
          ];
    overlayEdges.push({
      ...be,
      id: `rem:${remSeq++}:${be.id}`,
      points: pts,
      tier: "spine",
      diffStatus: "removed",
    });
  }

  const adjustedLanes = (primary.lanes ?? []).map((l) => ({
    ...l,
    h: Math.max(l.h, (maxYByLane.get(l.id) ?? l.y + l.h) - l.y + 18),
  }));

  return {
    id,
    label,
    overlay: {
      ...primary,
      height: overlayHeight,
      lanes: adjustedLanes,
      nodes: overlayNodes,
      edges: overlayEdges,
    },
    before: baseDiag,
    after: headDiag,
    changedCount,
  };
}
