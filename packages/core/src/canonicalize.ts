import { hashSpec } from "@repospec/plugin";
export { hashSpec };
import {
  createEmptyAst,
  inferNodeRole,
  parseRepoSpec,
  type AstIndexData,
  type CatalogArtifact,
  type DiagramLayout,
  type Domain,
  type EntityOwnership,
  type EnvBindingSummary,
  type FactEdgeRecord,
  type FactRecord,
  type ForeignKeySummary,
  type GovRuleSummary,
  type GraphFragment,
  type HttpEndpointSummary,
  type IacPlane,
  type LoopRecord,
  type MetricRecord,
  type ModuleCard,
  type RepoContext,
  type RepoSpecV4,
  type SpecDiagnostic,
  type SpecEdge,
  type SpecNode,
  type SpecRule,
  type SqlInvariantResult,
  type StateMachineRecord,
  type StaticTrace,
  type VerificationCoverage,
} from "@repospec/plugin";

function sortRecordKeys<T>(input: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(input).sort()) {
    const val = input[key];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

function mergeNodeEntry(nodeMap: Map<string, SpecNode>, node: SpecNode): void {
  const role = node.role ?? inferNodeRole(node.kind, node.meta, node.group);
  const existing = nodeMap.get(node.id);
  if (!existing) {
    nodeMap.set(node.id, { ...node, role, tags: Array.from(new Set(node.tags)).sort(), meta: sortRecordKeys(node.meta) });
    return;
  }
  nodeMap.set(node.id, {
    ...existing,
    role: existing.role ?? role,
    ownerId: existing.ownerId ?? node.ownerId,
    tags: Array.from(new Set([...existing.tags, ...node.tags])).sort(),
    meta: sortRecordKeys({ ...existing.meta, ...node.meta }),
  });
}

function mergeEdgeEntry(edgeMap: Map<string, SpecEdge>, edge: SpecEdge): void {
  const key = `${edge.from}|${edge.kind}|${edge.to}`;
  const existing = edgeMap.get(key);
  if (!existing) {
    edgeMap.set(key, edge);
    return;
  }
  const mergedEvidence = [...(existing.evidence ?? []), ...(edge.evidence ?? [])].slice(0, 20);
  const mergedRules = Array.from(new Set([...(existing.ruleIds ?? []), ...(edge.ruleIds ?? [])])).sort();
  edgeMap.set(key, {
    ...existing,
    weight: Math.max(existing.weight ?? 1, edge.weight ?? 1),
    violation: Boolean(existing.violation || edge.violation),
    ruleIds: mergedRules.length > 0 ? mergedRules : undefined,
    confidence: existing.confidence === "observed" || edge.confidence === "observed" ? "observed" : "inferred",
    evidence: mergedEvidence.length > 0 ? mergedEvidence : undefined,
  });
}

function appendAstFragment(ast: AstIndexData, src: AstIndexData): void {
  ast.files.push(...src.files);
  ast.fileImports.push(...src.fileImports);
  ast.pkgImports.push(...src.pkgImports);
  ast.declaredEntities.push(...src.declaredEntities);
  ast.entityAccesses.push(...src.entityAccesses);
  ast.externalHosts.push(...src.externalHosts);
  ast.stateEnums.push(...src.stateEnums);
  ast.httpEndpoints.push(...src.httpEndpoints);
  ast.dbForeignKeys.push(...src.dbForeignKeys);
  ast.envBindings.push(...src.envBindings);
  ast.govRules.push(...src.govRules);
  ast.docPathRefs.push(...src.docPathRefs);
}

export function mergeFragments(fragments: GraphFragment[]): {
  nodes: SpecNode[];
  edges: SpecEdge[];
  rules: SpecRule[];
  stateMachines: StateMachineRecord[];
  loops: LoopRecord[];
  catalogArtifacts: CatalogArtifact[];
  ast: AstIndexData;
  diagnostics: SpecDiagnostic[];
  facts: FactRecord[];
  factEdges: FactEdgeRecord[];
  metrics: MetricRecord[];
} {
  const nodeMap = new Map<string, SpecNode>();
  const edgeMap = new Map<string, SpecEdge>();
  const ruleMap = new Map<string, SpecRule>();
  const smMap = new Map<string, StateMachineRecord>();
  const loopMap = new Map<string, LoopRecord>();
  const catalogMap = new Map<string, CatalogArtifact>();
  const factMap = new Map<string, FactRecord>();
  const factEdgeMap = new Map<string, FactEdgeRecord>();
  const metricMap = new Map<string, MetricRecord>();
  const diagnostics: SpecDiagnostic[] = [];
  const ast = createEmptyAst();

  for (const frag of fragments) {
    if (frag.diagnostics) diagnostics.push(...frag.diagnostics);
    for (const node of frag.nodes) mergeNodeEntry(nodeMap, node);
    for (const edge of frag.edges) mergeEdgeEntry(edgeMap, edge);
    for (const rule of frag.rules) {
      if (!ruleMap.has(rule.id)) ruleMap.set(rule.id, { ...rule, targets: Array.from(new Set(rule.targets)).sort() });
    }
    for (const sm of frag.stateMachines ?? []) if (!smMap.has(sm.id)) smMap.set(sm.id, sm);
    for (const lp of frag.loops ?? []) if (!loopMap.has(lp.id)) loopMap.set(lp.id, lp);
    for (const ca of frag.catalogArtifacts ?? []) if (!catalogMap.has(ca.id)) catalogMap.set(ca.id, ca);
    if (frag.ast) appendAstFragment(ast, frag.ast);
    for (const fact of frag.facts ?? []) {
      const k = `${fact.extractorId}|${fact.kind}|${fact.key}|${fact.file}|${fact.line}`;
      if (!factMap.has(k)) factMap.set(k, { ...fact, payload: sortRecordKeys(fact.payload) });
    }
    for (const fe of frag.factEdges ?? []) {
      const k = `${fe.extractorId}|${fe.kind}|${fe.fromRef}|${fe.toRef}|${fe.file}|${fe.line}`;
      if (!factEdgeMap.has(k)) factEdgeMap.set(k, fe.payload ? { ...fe, payload: sortRecordKeys(fe.payload) } : fe);
    }
    for (const m of frag.metrics ?? []) metricMap.set(`${m.extractorId}|${m.scopeKind}|${m.scopeId}|${m.name}`, m);
  }

  const nodes = Array.from(nodeMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const keptEdges: SpecEdge[] = [];
  let droppedEdges = 0;
  for (const e of edgeMap.values()) {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) keptEdges.push(e);
    else droppedEdges += 1;
  }
  if (droppedEdges > 0) {
    diagnostics.push({
      code: "graph.dangling-edges-pruned",
      severity: "error",
      message: `Pruned ${droppedEdges} dangling edge(s) referencing unindexed node IDs.`,
    });
  }

  return {
    nodes,
    edges: keptEdges.sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to)),
    rules: Array.from(ruleMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
    stateMachines: Array.from(smMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
    loops: Array.from(loopMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
    catalogArtifacts: Array.from(catalogMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
    ast,
    diagnostics,
    facts: Array.from(factMap.values()).sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key) || a.file.localeCompare(b.file) || a.line - b.line),
    factEdges: Array.from(factEdgeMap.values()).sort((a, b) => a.kind.localeCompare(b.kind) || a.fromRef.localeCompare(b.fromRef) || a.toRef.localeCompare(b.toRef) || a.file.localeCompare(b.file)),
    metrics: Array.from(metricMap.values()).sort((a, b) => a.scopeKind.localeCompare(b.scopeKind) || a.scopeId.localeCompare(b.scopeId) || a.name.localeCompare(b.name)),
  };
}

const IAC_PLANES = new Set<IacPlane>(["network", "compute", "data", "security", "observability", "messaging", "governance", "ci_infra"]);

function summarizeGraphCounts(nodes: SpecNode[], edges: SpecEdge[]): {
  countsByDomain: Record<Domain, number>;
  countsByNodeKind: Record<string, number>;
  countsByEdgeKind: Record<string, number>;
  testFilesByRung: Record<string, number>;
  iacByPlane: Record<IacPlane, number>;
  workflowCount: number;
  ciJobCount: number;
  externalServices: number;
  crossDomainEdges: number;
} {
  const nodeDomain = new Map(nodes.map((n) => [n.id, n.domain]));
  const countsByDomain: Record<Domain, number> = { arch: 0, ci: 0, test: 0, iac: 0, rules: 0 };
  const countsByNodeKind: Record<string, number> = {};
  const countsByEdgeKind: Record<string, number> = {};
  const testFilesByRung: Record<string, number> = {};
  const iacByPlane: Record<IacPlane, number> = { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 };
  let workflowCount = 0;
  let ciJobCount = 0;
  let externalServices = 0;

  for (const node of nodes) {
    countsByDomain[node.domain] += 1;
    countsByNodeKind[node.kind] = (countsByNodeKind[node.kind] ?? 0) + 1;
    if (node.kind === "workflow") workflowCount += 1;
    if (node.kind === "ci_job") ciJobCount += 1;
    if (node.kind === "external_service") externalServices += 1;
    if (node.kind === "test_suite") {
      const rung = typeof node.meta.rung === "string" ? node.meta.rung : "R2";
      const fileCount = typeof node.meta.fileCount === "number" ? node.meta.fileCount : 1;
      testFilesByRung[rung] = (testFilesByRung[rung] ?? 0) + fileCount;
    }
    if (node.domain === "iac" && typeof node.meta.plane === "string" && IAC_PLANES.has(node.meta.plane as IacPlane)) {
      iacByPlane[node.meta.plane as IacPlane] += 1;
    }
  }
  let crossDomainEdges = 0;
  for (const edge of edges) {
    countsByEdgeKind[edge.kind] = (countsByEdgeKind[edge.kind] ?? 0) + 1;
    if (nodeDomain.get(edge.from) !== nodeDomain.get(edge.to)) crossDomainEdges += 1;
  }
  return { countsByDomain, countsByNodeKind, countsByEdgeKind, testFilesByRung, iacByPlane, workflowCount, ciJobCount, externalServices, crossDomainEdges };
}

export function buildCanonicalSpec(params: {
  ctx: RepoContext;
  extractorIds: string[];
  nodes: SpecNode[];
  edges: SpecEdge[];
  rules: SpecRule[];
  ast: AstIndexData;
  invariants: SqlInvariantResult[];
  entities: EntityOwnership[];
  stateMachines: StateMachineRecord[];
  loops: LoopRecord[];
  catalogArtifacts: CatalogArtifact[];
  modules?: ModuleCard[];
  traces: StaticTrace[];
  surfaces: {
    endpoints: HttpEndpointSummary[];
    foreignKeys: ForeignKeySummary[];
    envBindings: EnvBindingSummary[];
    govRules: GovRuleSummary[];
    docDriftCount: number;
  };
  diagrams: DiagramLayout[];
  verification: VerificationCoverage;
  diagnostics: SpecDiagnostic[];
  facts?: FactRecord[];
  factEdges?: FactEdgeRecord[];
  metrics?: MetricRecord[];
}): RepoSpecV4 {
  const { ctx, extractorIds, nodes, edges, rules, ast, invariants, entities, stateMachines, loops, catalogArtifacts, modules = [], traces, surfaces, diagrams, verification, diagnostics, facts = [], factEdges = [], metrics = [] } = params;
  const counts = summarizeGraphCounts(nodes, edges);
  const allRules: SpecRule[] = [
    ...rules,
    ...invariants.map((inv) => ({
      id: inv.id,
      name: inv.name,
      category: "sql_invariant" as const,
      enforcement: "sql_invariant" as const,
      rung: inv.rung,
      statement: inv.statement,
      targets: inv.evidence.slice(0, 5).map((e) => e.subject),
      provenance: { file: inv.sqlFile, line: 1 },
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const spec: RepoSpecV4 = {
    schemaVersion: "5.0.0",
    specKind: "repospec.canonical",
    repo: {
      name: ctx.repoName,
      ecosystem: ctx.ecosystem,
      languages: [...ctx.languages].sort(),
      commitSha: ctx.commitSha,
      branch: ctx.branch,
      remote: ctx.remote,
      scopeRootRel: ctx.scopeRootRel,
      storageMode: ctx.storageMode,
      extractors: [...extractorIds].sort(),
    },
    nodes,
    edges,
    rules: allRules,
    invariants,
    entities,
    stateMachines,
    loops,
    catalogArtifacts,
    modules,
    traces,
    surfaces: { endpoints: surfaces.endpoints, foreignKeys: surfaces.foreignKeys, envBindings: surfaces.envBindings, govRules: surfaces.govRules },
    diagrams,
    verification,
    diagnostics,
    extensions: { facts, factEdges, metrics },
    summary: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalRules: allRules.length,
      crossDomainEdges: counts.crossDomainEdges,
      countsByDomain: counts.countsByDomain,
      countsByNodeKind: sortRecordKeys(counts.countsByNodeKind),
      countsByEdgeKind: sortRecordKeys(counts.countsByEdgeKind),
      testFilesByRung: sortRecordKeys(counts.testFilesByRung),
      iacByPlane: counts.iacByPlane,
      workflowCount: counts.workflowCount,
      ciJobCount: counts.ciJobCount,
      indexedSourceFiles: ast.files.filter((f) => !f.isTest && f.canonicalLayer !== "ops_script").length,
      indexedImportEdges: ast.fileImports.length,
      datastoreEntities: entities.length,
      externalServices: counts.externalServices,
      stateMachines: stateMachines.length,
      loops: loops.length,
      httpEndpoints: surfaces.endpoints.length,
      foreignKeys: ast.dbForeignKeys.length,
      envBindings: surfaces.envBindings.length,
      govRules: ast.govRules.length,
      docDriftCount: surfaces.docDriftCount,
    },
  };
  return parseRepoSpec(spec);
}

export function serializeSpec(spec: RepoSpecV4): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

function canonicalEdgeKey(e: SpecEdge): string {
  return `${e.from}|${e.kind}|${e.to}`;
}

export function diffSpecs(base: RepoSpecV4, head: RepoSpecV4): {
  baseDigest: string;
  headDigest: string;
  changed: boolean;
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  invariantDeltas: Array<{ id: string; baseCount: number; headCount: number; baseStatus: string; headStatus: string }>;
} {
  const baseNodeIds = new Set(base.nodes.map((n) => n.id));
  const headNodeIds = new Set(head.nodes.map((n) => n.id));
  const baseEdgeIds = new Set(base.edges.map(canonicalEdgeKey));
  const headEdgeIds = new Set(head.edges.map(canonicalEdgeKey));
  const addedNodes = Array.from(headNodeIds).filter((id) => !baseNodeIds.has(id)).sort();
  const removedNodes = Array.from(baseNodeIds).filter((id) => !headNodeIds.has(id)).sort();
  const addedEdges = Array.from(headEdgeIds).filter((id) => !baseEdgeIds.has(id)).sort();
  const removedEdges = Array.from(baseEdgeIds).filter((id) => !headEdgeIds.has(id)).sort();

  const baseInv = new Map(base.invariants.map((i) => [i.id, i]));
  const headInv = new Map(head.invariants.map((i) => [i.id, i]));
  const allInvIds = Array.from(new Set([...baseInv.keys(), ...headInv.keys()])).sort();
  const invariantDeltas = allInvIds
    .map((id) => ({
      id,
      baseCount: baseInv.get(id)?.violationCount ?? 0,
      headCount: headInv.get(id)?.violationCount ?? 0,
      baseStatus: baseInv.get(id)?.status ?? "missing",
      headStatus: headInv.get(id)?.status ?? "missing",
    }))
    .filter((d) => d.baseCount !== d.headCount || d.baseStatus !== d.headStatus);

  const baseDigest = hashSpec(base);
  const headDigest = hashSpec(head);
  return { baseDigest, headDigest, changed: baseDigest !== headDigest, addedNodes, removedNodes, addedEdges, removedEdges, invariantDeltas };
}
