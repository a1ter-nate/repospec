import { hashSpec } from "../canonicalize.ts";
import { buildAllDiagrams, buildStaticTraces, resolveEvidenceAnchors } from "../layout.ts";
import {
  RepoSpecV4Schema,
  type DiagramLayout,
  type EnvBindingSummary,
  type HttpEndpointSummary,
  type ModuleCard,
  type RepoSpecV4,
  type SpecEdge,
  type SpecNode,
  type SqlInvariantResult,
} from "../schema.ts";
import type { CommitArchDiff } from "../studio/commitDiff.ts";
import {
  buildFederatedPrDiff,
  evaluateFederatedInvariants,
  type AggEntityBucket,
  type ExplicitTopologyLink,
  type FederationInput,
} from "./federateDiff.ts";

export interface AggregatedRepoSpecResult {
  spec: RepoSpecV4;
  digest: string;
  commitDiff?: CommitArchDiff;
  stats: {
    repos: number;
    crossRepoServiceEdges: number;
    sharedDatastoreEntities: number;
    crossRepoCycles: number;
    activePrDiffs: number;
  };
}

function toSlug(raw: string): string {
  return raw
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "repo";
}

function normalizeStem(raw: string): string {
  return toSlug(raw)
    .replace(/(?:^|-)(?:api|svc|service|sdk|client|app|web|worker|backend|frontend|url|host|endpoint|base)(?=-|$)/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findPrimaryModulesDiagram(diagrams: DiagramLayout[]): DiagramLayout | undefined {
  for (const d of diagrams) {
    if (d.category === "modules") return d;
  }
  return undefined;
}

function inferRepoRole(spec: RepoSpecV4): { kind: SpecNode["kind"]; role: SpecNode["role"] } {
  const hasFrontend = spec.nodes.some((n) => n.role === "client" || n.kind === "native_app" || n.meta?.archetype === "frontend_app");
  const hasService = spec.surfaces.endpoints.length > 0 || spec.nodes.some((n) => n.role === "service" || n.meta?.archetype === "http_service");
  const hasApp = spec.nodes.some((n) => n.kind === "app");
  if (hasFrontend && !hasService) return { kind: "app", role: "client" };
  if (hasService || hasApp) return { kind: "app", role: "service" };
  return { kind: "package", role: "library" };
}

export function aggregateRepoSpecs(params: {
  inputs: FederationInput[];
  name?: string;
  explicitLinks?: ExplicitTopologyLink[];
}): AggregatedRepoSpecResult {
  if (params.inputs.length === 0) {
    throw new Error("At least one RepoSpec input is required for aggregation.");
  }

  const usedSlugs = new Set<string>();
  const repos = params.inputs
    .map((inp) => {
      const baseSlug = toSlug(inp.label || inp.spec.repo.name);
      let slug = baseSlug;
      let seq = 2;
      while (usedSlugs.has(slug)) {
        slug = `${baseSlug}-${seq}`;
        seq += 1;
      }
      usedSlugs.add(slug);
      return {
        slug,
        nodeId: `fed:repo:${slug}`,
        spec: inp.spec,
        diff: inp.diff,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const targetByAlias = new Map<string, string>();
  for (const r of repos) {
    const aliases = new Set<string>([
      r.slug,
      toSlug(r.spec.repo.name),
      normalizeStem(r.slug),
      normalizeStem(r.spec.repo.name),
    ]);
    for (const n of r.spec.nodes) {
      if (n.kind === "app" || n.kind === "package") {
        aliases.add(toSlug(n.label));
        const st = normalizeStem(n.label);
        if (st.length >= 3) aliases.add(st);
      }
    }
    for (const alias of aliases) {
      if (alias.length >= 3 && !targetByAlias.has(alias)) {
        targetByAlias.set(alias, r.nodeId);
      }
    }
  }

  const nodes: SpecNode[] = [];
  const edges: SpecEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (e: SpecEdge): void => {
    if (e.from === e.to) return;
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(e);
  };

  const sharedDbNodes = new Map<string, SpecNode>();
  const sharedExtNodes = new Map<string, SpecNode>();
  const entityAgg = new Map<string, AggEntityBucket>();

  const allEndpoints: HttpEndpointSummary[] = [];
  const allFks: RepoSpecV4["surfaces"]["foreignKeys"] = [];
  const envAgg = new Map<string, { sources: Set<string>; units: Set<string>; isSecret: boolean; sampleFile: string }>();
  const allGovRules: RepoSpecV4["surfaces"]["govRules"] = [];
  const allModules: ModuleCard[] = [];
  const extraDiagrams: DiagramLayout[] = [];
  const rolledInvariants: SqlInvariantResult[] = [];
  const allLanguages = new Set<string>();
  const allRules: RepoSpecV4["rules"] = [];

  for (const r of repos) {
    for (const lang of r.spec.repo.languages) allLanguages.add(lang);
    const { kind, role } = inferRepoRole(r.spec);
    const repoFindings: SpecNode["findings"] = [];
    if (r.spec.verification.invariantsFailed > 0) {
      repoFindings.push({ ruleId: `repo:${r.slug}:fail`, severity: "error", count: r.spec.verification.invariantsFailed });
    }
    if (r.spec.verification.invariantsWarned > 0) {
      repoFindings.push({ ruleId: `repo:${r.slug}:warn`, severity: "warn", count: r.spec.verification.invariantsWarned });
    }

    const meta: Record<string, string | number | boolean | string[] | null> = {
      ecosystem: r.spec.repo.ecosystem,
      commitSha: r.spec.repo.commitSha,
      files: r.spec.verification.totalSourceFiles,
      coveragePct: r.spec.verification.directTestCoveragePct,
      endpoints: r.spec.summary.httpEndpoints,
    };
    if (r.diff) {
      meta.prRange = r.diff.range;
      meta.prVerdict = r.diff.verdict;
    }

    nodes.push({
      id: r.nodeId,
      domain: "arch",
      kind,
      role,
      label: r.spec.repo.name,
      provenance: { file: r.spec.repo.scopeRootRel || "." },
      tags: [r.spec.repo.ecosystem, ...r.spec.repo.languages.slice(0, 3), ...(r.diff ? [`pr:${r.diff.verdict}`] : [])],
      findings: repoFindings.length > 0 ? repoFindings : undefined,
      meta,
    });

    for (const extNode of r.spec.nodes.filter((n) => n.kind === "external_service")) {
      const targetRepoId =
        targetByAlias.get(toSlug(extNode.label)) ??
        targetByAlias.get(normalizeStem(extNode.label));
      if (targetRepoId && targetRepoId !== r.nodeId) {
        addEdge({
          from: r.nodeId,
          to: targetRepoId,
          kind: "routes_to",
          label: extNode.label,
          weight: 1,
          confidence: "observed",
          evidence: [{ file: `${r.slug}/${extNode.provenance.file}`, detail: `${r.spec.repo.name} calls ${extNode.label}` }],
        });
      } else {
        const extSlug = toSlug(extNode.label);
        const extId = `fed:ext:${extSlug}`;
        if (!sharedExtNodes.has(extId)) {
          sharedExtNodes.set(extId, {
            id: extId,
            domain: "arch",
            kind: "external_service",
            role: "external",
            label: extNode.label,
            provenance: extNode.provenance,
            tags: extNode.tags,
            meta: extNode.meta,
          });
        }
        addEdge({
          from: r.nodeId,
          to: extId,
          kind: "calls_external",
          weight: 1,
          confidence: "observed",
        });
      }
    }

    for (const ev of r.spec.surfaces.envBindings) {
      const urlMatch = ev.name.match(/^([A-Z0-9_]+?)_(?:API_URL|SERVICE_URL|BASE_URL|ENDPOINT|URL|HOST)$/);
      if (urlMatch?.[1]) {
        const targetRepoId = targetByAlias.get(normalizeStem(urlMatch[1])) ?? targetByAlias.get(toSlug(urlMatch[1]));
        if (targetRepoId && targetRepoId !== r.nodeId) {
          addEdge({
            from: r.nodeId,
            to: targetRepoId,
            kind: "routes_to",
            label: ev.name,
            weight: 1,
            confidence: "inferred",
            evidence: [{ file: `${r.slug}/${ev.sampleFile}`, detail: `${r.spec.repo.name} configures ${ev.name}` }],
          });
        }
      }
      const curEnv = envAgg.get(ev.name) ?? { sources: new Set<string>(), units: new Set<string>(), isSecret: ev.isSecret, sampleFile: `${r.slug}/${ev.sampleFile}` };
      for (const s of ev.sources) curEnv.sources.add(s);
      curEnv.units.add(r.slug);
      curEnv.isSecret = curEnv.isSecret || ev.isSecret;
      envAgg.set(ev.name, curEnv);
    }

    const touchedStores = new Set<string>();
    for (const ent of r.spec.entities) {
      const dbSlug = toSlug(ent.datastore);
      const dbId = `fed:db:${dbSlug}`;
      touchedStores.add(dbId);
      if (!sharedDbNodes.has(dbId)) {
        sharedDbNodes.set(dbId, {
          id: dbId,
          domain: "arch",
          kind: "datastore",
          role: "datastore",
          label: ent.datastore,
          provenance: { file: `${r.slug}/${ent.sampleFiles[0] ?? "."}` },
          tags: ["shared-store"],
          meta: {},
        });
      }
      const ek = `${dbSlug}:${ent.entity.toLowerCase()}`;
      const cur = entityAgg.get(ek) ?? {
        datastore: ent.datastore,
        entity: ent.entity,
        repos: new Set<string>(),
        declared: ent.declared,
        authorizedShared: ent.authorizedShared,
        totalRefs: 0,
        layers: new Set<string>(),
        domains: new Set<string>(),
        hasBypass: false,
        fkCount: 0,
        hasTenancyKey: false,
        sampleFiles: [],
      };
      cur.repos.add(r.slug);
      cur.declared = cur.declared || ent.declared;
      cur.authorizedShared = cur.authorizedShared || ent.authorizedShared;
      cur.totalRefs += ent.totalRefs;
      for (const l of ent.layers) cur.layers.add(l);
      for (const d of ent.domains) cur.domains.add(`${r.slug}:${d}`);
      cur.hasBypass = cur.hasBypass || ent.hasBypass;
      cur.fkCount += ent.fkCount;
      cur.hasTenancyKey = cur.hasTenancyKey || ent.hasTenancyKey;
      for (const sf of ent.sampleFiles.slice(0, 2)) {
        if (cur.sampleFiles.length < 6) cur.sampleFiles.push(`${r.slug}/${sf}`);
      }
      entityAgg.set(ek, cur);
    }
    for (const dbId of touchedStores) {
      addEdge({ from: r.nodeId, to: dbId, kind: "reads_writes", weight: 1, confidence: "observed" });
    }

    for (const ep of r.spec.surfaces.endpoints) {
      allEndpoints.push({ ...ep, unit: r.slug, file: `${r.slug}/${ep.file}` });
    }
    for (const fk of r.spec.surfaces.foreignKeys) {
      allFks.push({ ...fk, file: `${r.slug}/${fk.file}` });
    }
    for (const gr of r.spec.surfaces.govRules) {
      allGovRules.push({ ...gr, id: `${r.slug}:${gr.id}`, file: `${r.slug}/${gr.file}` });
    }
    for (const rule of r.spec.rules) {
      allRules.push({ ...rule, id: `${r.slug}:${rule.id}`, provenance: { ...rule.provenance, file: `${r.slug}/${rule.provenance.file}` } });
    }

    const modDiag = findPrimaryModulesDiagram(r.spec.diagrams);
    if (modDiag) {
      const remappedNodes = modDiag.nodes.map((mn) => ({ ...mn, id: `fed:${r.slug}:${mn.id}` }));
      const remappedEdges = modDiag.edges.map((me) => ({
        ...me,
        id: `fed:${r.slug}:${me.id}`,
        from: `fed:${r.slug}:${me.from}`,
        to: `fed:${r.slug}:${me.to}`,
      }));
      extraDiagrams.push({
        ...modDiag,
        id: `modules:${r.slug}`,
        ownerId: r.nodeId,
        nodes: remappedNodes,
        edges: remappedEdges,
      });
    }
    for (const m of r.spec.modules) {
      allModules.push({
        ...m,
        id: `fed:${r.slug}:${m.id}`,
        unitId: r.nodeId,
        unitName: r.spec.repo.name,
        unitSlug: r.slug,
        relPath: `${r.slug}/${m.relPath}`,
        topExports: m.topExports.map((ex) => ({ ...ex, file: `${r.slug}/${ex.file}` })),
        files: m.files.map((mf) => ({ ...mf, file: `${r.slug}/${mf.file}` })),
      });
    }

    for (const inv of r.spec.invariants) {
      if (inv.status !== "fail" && inv.status !== "warn") continue;
      rolledInvariants.push({
        ...inv,
        id: `${r.slug}:${inv.id}`,
        name: `[${r.slug}] ${inv.name}`,
        evidence: inv.evidence.slice(0, 6).map((ev) => ({
          ...ev,
          file: `${r.slug}/${ev.file}`,
          targetNodeId: r.nodeId,
        })),
      });
    }
  }

  for (const link of params.explicitLinks ?? []) {
    const fromId = targetByAlias.get(toSlug(link.from)) ?? targetByAlias.get(normalizeStem(link.from));
    const toId = targetByAlias.get(toSlug(link.to)) ?? targetByAlias.get(normalizeStem(link.to));
    if (fromId && toId && fromId !== toId) {
      addEdge({
        from: fromId,
        to: toId,
        kind: link.kind ?? "routes_to",
        label: link.detail ?? "declared",
        weight: 1,
        confidence: "observed",
        evidence: [{ file: "topology.json", detail: link.detail ?? `${link.from} -> ${link.to}` }],
      });
    }
  }

  for (const [, agg] of entityAgg) {
    const dbNode = sharedDbNodes.get(`fed:db:${toSlug(agg.datastore)}`);
    if (dbNode) {
      dbNode.meta.entityCount = (typeof dbNode.meta.entityCount === "number" ? dbNode.meta.entityCount : 0) + 1;
    }
  }
  nodes.push(...Array.from(sharedDbNodes.values()).sort((a, b) => a.id.localeCompare(b.id)));
  nodes.push(...Array.from(sharedExtNodes.values()).sort((a, b) => a.id.localeCompare(b.id)));

  const repoNodeIds = repos.map((r) => r.nodeId);
  const serviceEdges = edges.filter((e) => e.from.startsWith("fed:repo:") && e.to.startsWith("fed:repo:"));
  const {
    invariants: fedInvariants,
    mergedEntities,
    cycleCount,
    sharedEntityCount,
  } = evaluateFederatedInvariants({
    repoNodeIds,
    serviceEdges,
    entityAgg,
    rolledInvariants,
    toSlugFn: toSlug,
  });

  const diagrams = buildAllDiagrams(nodes, edges, [], extraDiagrams);
  const anchoredInvariants = resolveEvidenceAnchors(fedInvariants, diagrams);
  const traces = buildStaticTraces(diagrams);

  const totalFiles = repos.reduce((s, r) => s + r.spec.verification.totalSourceFiles, 0);
  const totalTested = repos.reduce((s, r) => s + r.spec.verification.directlyTestedSourceFiles, 0);
  const directTestCoveragePct = totalFiles > 0 ? Math.round((totalTested / totalFiles) * 1000) / 10 : 0;

  const countsByNodeKind: Record<string, number> = {};
  for (const n of nodes) countsByNodeKind[n.kind] = (countsByNodeKind[n.kind] ?? 0) + 1;
  const countsByEdgeKind: Record<string, number> = {};
  for (const e of edges) countsByEdgeKind[e.kind] = (countsByEdgeKind[e.kind] ?? 0) + 1;

  const spec: RepoSpecV4 = RepoSpecV4Schema.parse({
    schemaVersion: "5.0.0",
    specKind: "repospec.canonical",
    repo: {
      name: params.name ?? "distributed-system",
      ecosystem: "polyglot",
      languages: Array.from(allLanguages).sort(),
      commitSha: null,
      branch: null,
      remote: null,
      scopeRootRel: ".",
      storageMode: "artifact",
      extractors: ["federate.aggregator.v5"],
    },
    nodes,
    edges,
    rules: allRules,
    invariants: anchoredInvariants,
    entities: mergedEntities.sort((a, b) => b.totalRefs - a.totalRefs || a.entity.localeCompare(b.entity)),
    stateMachines: [],
    loops: [],
    catalogArtifacts: [],
    modules: allModules,
    traces,
    surfaces: {
      endpoints: allEndpoints,
      foreignKeys: allFks,
      envBindings: Array.from(envAgg.entries())
        .map(([name, info]): EnvBindingSummary => ({
          name,
          sources: Array.from(info.sources).sort(),
          units: Array.from(info.units).sort(),
          isSecret: info.isSecret,
          sampleFile: info.sampleFile,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      govRules: allGovRules,
    },
    diagrams,
    verification: {
      totalSourceFiles: totalFiles,
      directlyTestedSourceFiles: totalTested,
      directTestCoveragePct,
      registeredGates: repos.reduce((s, r) => s + r.spec.verification.registeredGates, 0),
      ciWiredGates: repos.reduce((s, r) => s + r.spec.verification.ciWiredGates, 0),
      unwiredGateNames: [],
      invariantsPassed: anchoredInvariants.filter((i) => i.status === "pass").length,
      invariantsWarned: anchoredInvariants.filter((i) => i.status === "warn").length,
      invariantsFailed: anchoredInvariants.filter((i) => i.status === "fail").length,
      invariantsNa: anchoredInvariants.filter((i) => i.status === "na").length,
    },
    diagnostics: [],
    summary: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalRules: allRules.length,
      crossDomainEdges: 0,
      countsByDomain: { arch: nodes.length, ci: 0, test: 0, iac: 0, rules: 0 },
      countsByNodeKind,
      countsByEdgeKind,
      testFilesByRung: {},
      iacByPlane: { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 },
      workflowCount: repos.reduce((s, r) => s + r.spec.summary.workflowCount, 0),
      ciJobCount: repos.reduce((s, r) => s + r.spec.summary.ciJobCount, 0),
      indexedSourceFiles: totalFiles,
      indexedImportEdges: repos.reduce((s, r) => s + r.spec.summary.indexedImportEdges, 0),
      datastoreEntities: mergedEntities.length,
      externalServices: sharedExtNodes.size,
      stateMachines: 0,
      loops: 0,
      httpEndpoints: allEndpoints.length,
      foreignKeys: allFks.length,
      envBindings: envAgg.size,
      govRules: allGovRules.length,
      docDriftCount: repos.reduce((s, r) => s + r.spec.summary.docDriftCount, 0),
    },
  });

  const digest = hashSpec(spec);
  const diffInputs = repos
    .filter((r): r is typeof r & { diff: CommitArchDiff } => Boolean(r.diff))
    .map((r) => ({ slug: r.slug, nodeId: r.nodeId, diff: r.diff }));
  const meshDiag = diagrams.find((d) => d.id === "system_runtime") ?? diagrams[0] ?? null;
  const commitDiff = diffInputs.length > 0 ? buildFederatedPrDiff({ inputs: diffInputs, meshDiag, crossRepoEdges: serviceEdges }) : undefined;

  return {
    spec,
    digest,
    commitDiff,
    stats: {
      repos: repos.length,
      crossRepoServiceEdges: serviceEdges.length,
      sharedDatastoreEntities: sharedEntityCount,
      crossRepoCycles: cycleCount,
      activePrDiffs: diffInputs.length,
    },
  };
}
