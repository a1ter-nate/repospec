import type { DiffDiagramBundle, DiffDiagramEdge, DiffDiagramNode } from "../../../../src/studio/diffOverlay.ts";
import type { FocusMode } from "./ranking.ts";

export interface CompactGraphResult {
  overlay: DiffDiagramBundle["overlay"];
  focused: boolean;
  hiddenNodes: number;
  foldedByLane: Record<string, number>;
}

const TARGET_MAX_WIDTH = 840;
const MAX_VISIBLE_NODES = 7;

function bezierBetween(
  a: DiffDiagramNode,
  b: DiffDiagramNode,
  allNodes: DiffDiagramNode[],
): Array<{ x: number; y: number }> {
  const ax = a.x + a.w / 2;
  const bx = b.x - b.w / 2;
  if (bx >= ax + 12) {
    const midY = (a.y + b.y) / 2;
    const blockers = allNodes.filter(
      (n) =>
        n.id !== a.id &&
        n.id !== b.id &&
        n.x > a.x + a.w / 2 &&
        n.x < b.x - b.w / 2 &&
        Math.abs(n.y - midY) < n.h / 2 + 12,
    );
    if (blockers.length > 0) {
      const clearY = Math.max(...blockers.map((n) => n.y + n.h / 2)) + 16;
      return [
        { x: ax, y: a.y + 6 },
        { x: ax + 24, y: clearY },
        { x: bx - 24, y: clearY },
        { x: bx, y: b.y + 6 },
      ];
    }
    const mid = Math.round(((ax + bx) / 2) * 10) / 10;
    return [
      { x: ax, y: a.y },
      { x: mid, y: a.y },
      { x: mid, y: b.y },
      { x: bx, y: b.y },
    ];
  }
  const sameCol = Math.abs(a.x - b.x) < 20;
  if (sameCol) {
    const rightX = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 28;
    return [
      { x: a.x + a.w / 2, y: a.y },
      { x: rightX, y: a.y },
      { x: rightX, y: b.y },
      { x: b.x + b.w / 2, y: b.y },
    ];
  }
  const midX = Math.round(((a.x + b.x) / 2) * 10) / 10;
  const arcY = Math.max(a.y, b.y) + 34;
  return [
    { x: a.x, y: a.y + a.h / 2 },
    { x: midX, y: arcY },
    { x: b.x, y: b.y + b.h / 2 },
  ];
}

function selectVisibleNodes(
  overlay: DiffDiagramBundle["overlay"],
  focusMode: FocusMode,
): { keptNodes: DiffDiagramNode[]; keptEdges: DiffDiagramEdge[]; focused: boolean; hiddenNodes: number; foldedByLane: Record<string, number> } {
  const changedNodes = overlay.nodes.filter((n) => n.diffStatus !== "unchanged");
  const changedIds = new Set(changedNodes.map((n) => n.id));
  const incidentEdges = overlay.edges.filter((e) => changedIds.has(e.from) || changedIds.has(e.to));

  if (changedIds.size === 0 || focusMode === "off") {
    return {
      keptNodes: overlay.nodes,
      keptEdges: incidentEdges.length > 0 ? incidentEdges : overlay.edges,
      focused: false,
      hiddenNodes: 0,
      foldedByLane: {},
    };
  }

  const neighborWeight = new Map<string, number>();
  for (const e of incidentEdges) {
    if (!changedIds.has(e.from)) neighborWeight.set(e.from, (neighborWeight.get(e.from) ?? 0) + (e.weight ?? 1));
    if (!changedIds.has(e.to)) neighborWeight.set(e.to, (neighborWeight.get(e.to) ?? 0) + (e.weight ?? 1));
  }

  const maxNeighbors = Math.max(0, MAX_VISIBLE_NODES - changedNodes.length);
  const rankedNeighbors = overlay.nodes
    .filter((n) => !changedIds.has(n.id) && neighborWeight.has(n.id))
    .sort((a, b) => {
      const wa = neighborWeight.get(a.id) ?? 0;
      const wb = neighborWeight.get(b.id) ?? 0;
      if (wb !== wa) return wb - wa;
      return a.label.localeCompare(b.label);
    });

  const keptNeighbors = rankedNeighbors.slice(0, maxNeighbors);
  const keptIds = new Set<string>([...changedIds, ...keptNeighbors.map((n) => n.id)]);
  const keptNodes = overlay.nodes.filter((n) => keptIds.has(n.id));
  const keptEdges = incidentEdges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));

  const foldedByLane: Record<string, number> = {};
  for (const n of overlay.nodes) {
    if (keptIds.has(n.id)) continue;
    const laneKey = n.lane ?? "_";
    foldedByLane[laneKey] = (foldedByLane[laneKey] ?? 0) + 1;
  }

  const hiddenNodes = overlay.nodes.length - keptNodes.length;
  return {
    keptNodes,
    keptEdges,
    focused: hiddenNodes > 0,
    hiddenNodes,
    foldedByLane,
  };
}

export function buildCompactDeltaGraph(
  overlay: DiffDiagramBundle["overlay"],
  focusMode: FocusMode,
  focusFileHint?: { moduleId: string | null; fileName: string },
): CompactGraphResult {
  const { keptNodes, keptEdges, focused, hiddenNodes, foldedByLane } = selectVisibleNodes(overlay, focusMode);
  if (keptNodes.length === 0) {
    return { overlay, focused: false, hiddenNodes: 0, foldedByLane: {} };
  }

  const laneOrder = new Map<string, number>();
  const laneLabelById = new Map<string, string>();
  (overlay.lanes ?? []).forEach((l, idx) => {
    laneOrder.set(l.id, idx);
    laneLabelById.set(l.id, l.label);
  });

  const colsMap = new Map<string, DiffDiagramNode[]>();
  for (const n of keptNodes) {
    const colKey = n.lane ?? `col:${Math.round(n.x / 180)}`;
    const list = colsMap.get(colKey) ?? [];
    list.push(n);
    colsMap.set(colKey, list);
  }

  const orderedCols = Array.from(colsMap.entries()).sort(([ka, na], [kb, nb]) => {
    const oa = laneOrder.get(ka);
    const ob = laneOrder.get(kb);
    if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
    const ax = na[0]?.x ?? 0;
    const bx = nb[0]?.x ?? 0;
    return ax - bx;
  });

  const colCount = Math.max(1, orderedCols.length);
  const padX = 20;
  const padTop = 36;
  const padBottom = 18;
  const gutterX = colCount >= 5 ? 34 : colCount === 4 ? 46 : 64;
  const availForCols = TARGET_MAX_WIDTH - padX * 2 - gutterX * (colCount - 1);
  const nodeW = Math.max(128, Math.min(188, Math.floor(availForCols / colCount)));
  const totalWidth = Math.min(TARGET_MAX_WIDTH, Math.max(420, padX * 2 + colCount * nodeW + (colCount - 1) * gutterX));

  const positionedNodes: DiffDiagramNode[] = [];
  const positionedById = new Map<string, DiffDiagramNode>();
  const compactLanes: NonNullable<DiffDiagramBundle["overlay"]["lanes"]> = [];
  let maxBottom = padTop + 56;

  orderedCols.forEach(([colKey, colNodes], colIdx) => {
    colNodes.sort((a, b) => {
      const aChanged = a.diffStatus === "unchanged" ? 1 : 0;
      const bChanged = b.diffStatus === "unchanged" ? 1 : 0;
      if (aChanged !== bChanged) return aChanged - bChanged;
      return a.y - b.y;
    });

    const colX = padX + colIdx * (nodeW + gutterX);
    let curY = padTop;

    for (const n of colNodes) {
      const isChanged = n.diffStatus !== "unchanged";
      const hasFocusHint = Boolean(focusFileHint?.moduleId && n.id === focusFileHint.moduleId && n.label.endsWith("/"));
      const h = isChanged ? (hasFocusHint ? 58 : 48) : 34;
      const sublabel = hasFocusHint
        ? `contains ${focusFileHint?.fileName ?? ""}`
        : isChanged
          ? n.sublabel
          : undefined;
      const next: DiffDiagramNode = {
        ...n,
        x: Math.round((colX + nodeW / 2) * 10) / 10,
        y: Math.round((curY + h / 2) * 10) / 10,
        w: nodeW,
        h,
        sublabel,
      };
      positionedNodes.push(next);
      positionedById.set(next.id, next);
      curY += h + 14;
    }

    const folded = foldedByLane[colKey] ?? 0;
    if (folded > 0) curY += 26;
    maxBottom = Math.max(maxBottom, curY);

    compactLanes.push({
      id: colKey,
      label: laneLabelById.get(colKey) ?? colKey,
      x: colX,
      y: 12,
      w: nodeW,
      h: Math.max(54, curY - 12),
    });
  });

  const routedEdges: DiffDiagramEdge[] = [];
  for (const e of keptEdges) {
    const fromNode = positionedById.get(e.from);
    const toNode = positionedById.get(e.to);
    if (!fromNode || !toNode) continue;
    routedEdges.push({
      ...e,
      points: bezierBetween(fromNode, toNode, positionedNodes),
    });
  }

  return {
    overlay: {
      ...overlay,
      width: totalWidth,
      height: Math.round(maxBottom + padBottom),
      lanes: compactLanes,
      nodes: positionedNodes,
      edges: routedEdges,
    },
    focused,
    hiddenNodes,
    foldedByLane,
  };
}
