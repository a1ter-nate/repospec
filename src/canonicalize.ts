import { createHash } from "node:crypto";
import {
  createEmptyAst,
  RepoSpecV4Schema,
  type AstIndexData,
  type CatalogArtifact,
  type DiagramLayout,
  type Domain,
  type EntityOwnership,
  type EnvBindingSummary,
  type ForeignKeySummary,
  type GovRuleSummary,
  type GraphFragment,
  type HttpEndpointSummary,
  type IacPlane,
  type LoopRecord,
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
} from "./schema.ts";
import { inferNodeRole } from "./taxonomy.ts";

function sortRecordKeys<T>(input: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(input).sort()) {
    const val = input[key];
    if (val !== undefined) out[key] = val;
  }
  return out;
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
} {
  const nodeMap = new Map<string, SpecNode>();
  const edgeMap = new Map<string, SpecEdge>();
  const ruleMap = new Map<string, SpecRule>();
  const smMap = new Map<string, StateMachineRecord>();
  const loopMap = new Map<string, LoopRecord>();
  const catalogMap = new Map<string, CatalogArtifact>();
  const diagnostics: SpecDiagnostic[] = [];
  const ast = createEmptyAst();

  for (const frag of fragments) {
    if (frag.diagnostics) diagnostics.push(...frag.diagnostics);

    for (const node of frag.nodes) {
      const role = node.role ?? inferNodeRole(node.kind, node.meta, node.group);
      const existing = nodeMap.get(node.id);
      if (!existing) {
        nodeMap.set(node.id, {
          ...node,
          role,
          tags: Array.from(new Set(node.tags)).sort(),
          meta: sortRecordKeys(node.meta),
        });
      } else {
        nodeMap.set(node.id, {
          ...existing,
          role: existing.role ?? role,
          ownerId: existing.ownerId ?? node.ownerId,
          tags: Array.from(new Set([...existing.tags, ...node.tags])).sort(),
          meta: sortRecordKeys({ ...existing.meta, ...node.meta }),
        });
      }
    }

    for (const edge of frag.edges) {
      const key = `${edge.from}|${edge.kind}|${edge.to}`;
      const existing = edgeMap.get(key);
      if (!existing) {
        edgeMap.set(key, edge);
      } else {
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
    }

    for (const rule of frag.rules) {
      if (!ruleMap.has(rule.id)) {
        ruleMap.set(rule.id, {
          ...rule,
          targets: Array.from(new Set(rule.targets)).sort(),
        });
      }
    }
    for (const sm of frag.stateMachines ?? []) {
      if (!smMap.has(sm.id)) smMap.set(sm.id, sm);
    }
    for (const lp of frag.loops ?? []) {
      if (!loopMap.has(lp.id)) loopMap.set(lp.id, lp);
    }
    for (const ca of frag.catalogArtifacts ?? []) {
      if (!catalogMap.has(ca.id)) catalogMap.set(ca.id, ca);
    }
    if (frag.ast) {
      ast.files.push(...frag.ast.files);
      ast.fileImports.push(...frag.ast.fileImports);
      ast.pkgImports.push(...frag.ast.pkgImports);
      ast.declaredEntities.push(...frag.ast.declaredEntities);
      ast.entityAccesses.push(...frag.ast.entityAccesses);
      ast.externalHosts.push(...frag.ast.externalHosts);
      ast.stateEnums.push(...frag.ast.stateEnums);
      ast.httpEndpoints.push(...frag.ast.httpEndpoints);
      ast.dbForeignKeys.push(...frag.ast.dbForeignKeys);
      ast.envBindings.push(...frag.ast.envBindings);
      ast.govRules.push(...frag.ast.govRules);
      ast.docPathRefs.push(...frag.ast.docPathRefs);
    }
  }

  const nodes = Array.from(nodeMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds = new Set(nodes.map((n) => n.id));

  let droppedEdges = 0;
  const keptEdges: SpecEdge[] = [];
  for (const e of edgeMap.values()) {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      keptEdges.push(e);
    } else {
      droppedEdges += 1;
    }
  }
  if (droppedEdges > 0) {
    diagnostics.push({
      code: "graph.dangling-edges-pruned",
      severity: "error",
      message: `Pruned ${droppedEdges} dangling edge(s) referencing unindexed node IDs.`,
    });
  }

  const edges = keptEdges.sort(
    (a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to),
  );
  const rules = Array.from(ruleMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const stateMachines = Array.from(smMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const loops = Array.from(loopMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const catalogArtifacts = Array.from(catalogMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges, rules, stateMachines, loops, catalogArtifacts, ast, diagnostics };
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
}): RepoSpecV4 {
  const {
    ctx,
    extractorIds,
    nodes,
    edges,
    rules,
    ast,
    invariants,
    entities,
    stateMachines,
    loops,
    catalogArtifacts,
    modules = [],
    traces,
    surfaces,
    diagrams,
    verification,
    diagnostics,
  } = params;

  const nodeDomain = new Map(nodes.map((n) => [n.id, n.domain]));
  const countsByDomain: Record<Domain, number> = {
    arch: 0,
    ci: 0,
    test: 0,
    iac: 0,
    rules: 0,
  };
  const countsByNodeKind: Record<string, number> = {};
  const countsByEdgeKind: Record<string, number> = {};
  const testFilesByRung: Record<string, number> = {};
  const iacByPlane: Record<IacPlane, number> = {
    network: 0,
    compute: 0,
    data: 0,
    security: 0,
    observability: 0,
    ci_infra: 0,
  };

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
    if (node.domain === "iac") {
      const plane = node.meta.plane;
      if (
        plane === "network" ||
        plane === "compute" ||
        plane === "data" ||
        plane === "security" ||
        plane === "observability" ||
        plane === "ci_infra"
      ) {
        iacByPlane[plane] += 1;
      }
    }
  }

  let crossDomainEdges = 0;
  for (const edge of edges) {
    countsByEdgeKind[edge.kind] = (countsByEdgeKind[edge.kind] ?? 0) + 1;
    if (nodeDomain.get(edge.from) !== nodeDomain.get(edge.to)) {
      crossDomainEdges += 1;
    }
  }

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
    surfaces: {
      endpoints: surfaces.endpoints,
      foreignKeys: surfaces.foreignKeys,
      envBindings: surfaces.envBindings,
      govRules: surfaces.govRules,
    },
    diagrams,
    verification,
    diagnostics,
    summary: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalRules: allRules.length,
      crossDomainEdges,
      countsByDomain,
      countsByNodeKind: sortRecordKeys(countsByNodeKind),
      countsByEdgeKind: sortRecordKeys(countsByEdgeKind),
      testFilesByRung: sortRecordKeys(testFilesByRung),
      iacByPlane,
      workflowCount,
      ciJobCount,
      indexedSourceFiles: ast.files.filter((f) => !f.isTest && f.canonicalLayer !== "ops_script").length,
      indexedImportEdges: ast.fileImports.length,
      datastoreEntities: entities.length,
      externalServices,
      stateMachines: stateMachines.length,
      loops: loops.length,
      httpEndpoints: surfaces.endpoints.length,
      foreignKeys: ast.dbForeignKeys.length,
      envBindings: surfaces.envBindings.length,
      govRules: ast.govRules.length,
      docDriftCount: surfaces.docDriftCount,
    },
  };

  return RepoSpecV4Schema.parse(spec);
}

export function serializeSpec(spec: RepoSpecV4): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export function hashSpec(spec: RepoSpecV4): string {
  const semanticProjection = {
    schemaVersion: spec.schemaVersion,
    repo: spec.repo,
    nodes: spec.nodes,
    edges: spec.edges,
    rules: spec.rules,
    invariants: spec.invariants.map((inv) => ({
      ...inv,
      evidence: inv.evidence.map(({ anchors: _anchors, ...rest }) => rest),
    })),
    entities: spec.entities,
    stateMachines: spec.stateMachines,
    loops: spec.loops,
    catalogArtifacts: spec.catalogArtifacts,
    modules: spec.modules,
    verification: spec.verification,
    diagnostics: spec.diagnostics,
  };
  return createHash("sha256").update(JSON.stringify(semanticProjection)).digest("hex");
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
    .map((id) => {
      const b = baseInv.get(id);
      const h = headInv.get(id);
      return {
        id,
        baseCount: b?.violationCount ?? 0,
        headCount: h?.violationCount ?? 0,
        baseStatus: b?.status ?? "missing",
        headStatus: h?.status ?? "missing",
      };
    })
    .filter((d) => d.baseCount !== d.headCount || d.baseStatus !== d.headStatus);

  const baseDigest = hashSpec(base);
  const headDigest = hashSpec(head);

  return {
    baseDigest,
    headDigest,
    changed: baseDigest !== headDigest,
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    invariantDeltas,
  };
}
