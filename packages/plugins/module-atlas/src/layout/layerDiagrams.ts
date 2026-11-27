import type { DiagramLayout, EdgeEvidenceItem, LayerAxis, SpecEdge, SpecNode, StateMachineRecord } from "@repospec/plugin";
import { layoutWithDagre, shortPkg, type LaneDef, type RawDiagramEdge, type RawDiagramNode } from "./dagreEngine.ts";
import { layoutFixedLanes } from "./fixedLanes.ts";

export function buildOwnerLayersDiagram(
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
      expandable: fileCount >= 2 ? true : undefined,
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

export function buildWorkspaceDagDiagram(
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

export function buildStateMachineDiagram(sm: StateMachineRecord): DiagramLayout {
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

export function buildDeliveryDiagram(nodes: SpecNode[], edges: SpecEdge[]): DiagramLayout {
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
      label: [...w.label].length > 26 ? `${[...w.label].slice(0, 24).join("")}…` : w.label,
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
      label: [...r.label].length > 26 ? `${[...r.label].slice(0, 24).join("")}…` : r.label,
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
