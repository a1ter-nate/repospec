import type {
  DiagramLayout,
  SpecEdge,
  SpecNode,
  StateMachineRecord,
} from "@repospec/plugin";
import { buildDomainCouplingDiagram, buildSystemTopologyDiagram } from "./layout/runtimeDiagrams.ts";
import {
  buildDeliveryDiagram,
  buildOwnerLayersDiagram,
  buildStateMachineDiagram,
  buildWorkspaceDagDiagram,
} from "./layout/layerDiagrams.ts";

export type { LaneDef, RawDiagramEdge, RawDiagramNode } from "./layout/dagreEngine.ts";
export { layoutFixedLanes } from "./layout/fixedLanes.ts";
export { buildStaticTraces, resolveEvidenceAnchors } from "./layout/traces.ts";

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
