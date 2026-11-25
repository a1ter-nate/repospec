import type { DiagramLayout, EdgeEvidenceItem, SpecEdge, SpecNode } from "../../schema.ts";
import { layoutWithDagre, shortPkg, type RawDiagramEdge, type RawDiagramNode } from "./dagreEngine.ts";
import { layoutFixedLanes } from "./fixedLanes.ts";

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

export function buildSystemTopologyDiagram(
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

export function buildDomainCouplingDiagram(nodes: SpecNode[], edges: SpecEdge[]): DiagramLayout {
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
