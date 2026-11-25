import fs from "node:fs";
import path from "node:path";
import {
  RepoSpecV4Schema,
  type DiagramLayout,
  type EntityOwnership,
  type RepoSpecV4,
  type SpecEdge,
  type SqlInvariantResult,
} from "../schema.ts";
import type { ChangedFileEntry, CommitArchDiff, FindingDeltaItem } from "../studio/commitDiff.ts";
import { buildOverlayBundle } from "../studio/diffOverlay.ts";
import { computeTopologicalLevels } from "../topoLevels.ts";

export interface FederationInput {
  spec: RepoSpecV4;
  label?: string;
  diff?: CommitArchDiff;
  sourcePath?: string;
}

export interface ExplicitTopologyLink {
  from: string;
  to: string;
  kind?: "routes_to" | "depends_on" | "calls_external";
  detail?: string;
}

export function loadFederationInputs(inputPaths: string[]): FederationInput[] {
  const loaded: FederationInput[] = [];
  for (const rawPath of inputPaths) {
    const resolved = path.resolve(rawPath);
    const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    const specPath = isDir ? path.join(resolved, "repospec.json") : resolved;
    if (!fs.existsSync(specPath)) {
      throw new Error(`RepoSpec JSON not found at ${specPath}`);
    }
    const spec = RepoSpecV4Schema.parse(JSON.parse(fs.readFileSync(specPath, "utf8")));
    const dir = path.dirname(specPath);
    const diffPath = path.join(dir, "repospec.diff.json");
    let diff: CommitArchDiff | undefined;
    if (fs.existsSync(diffPath)) {
      diff = JSON.parse(fs.readFileSync(diffPath, "utf8")) as CommitArchDiff;
    }
    loaded.push({ spec, diff, sourcePath: specPath });
  }
  return loaded;
}

export function buildFederatedPrDiff(params: {
  inputs: Array<{ slug: string; nodeId: string; diff: CommitArchDiff }>;
  meshDiag: DiagramLayout | null;
  crossRepoEdges: SpecEdge[];
}): CommitArchDiff {
  const { inputs, meshDiag, crossRepoEdges } = params;
  const changedFiles: ChangedFileEntry[] = [];
  const introduced: FindingDeltaItem[] = [];
  const resolved: FindingDeltaItem[] = [];
  const modifiedNodeIds = new Set<string>();
  const deltaByNodeId = new Map<string, string>();
  const epAdded = new Set<string>();
  const epRemoved = new Set<string>();
  const extAdded = new Set<string>();
  const extRemoved = new Set<string>();
  const envAdded = new Set<string>();
  const envRemoved = new Set<string>();
  const entAdded = new Set<string>();
  const entRemoved = new Set<string>();

  let failBefore = 0;
  let failAfter = 0;
  let warnBefore = 0;
  let warnAfter = 0;
  let covBeforeSum = 0;
  let covAfterSum = 0;
  let persistentCount = 0;
  let totalCommits = 0;

  for (const item of inputs) {
    const d = item.diff;
    modifiedNodeIds.add(item.nodeId);
    deltaByNodeId.set(item.nodeId, `+${d.kpis.files.insertions}/-${d.kpis.files.deletions}`);
    failBefore += d.kpis.failures.before;
    failAfter += d.kpis.failures.after;
    warnBefore += d.kpis.warnings.before;
    warnAfter += d.kpis.warnings.after;
    covBeforeSum += d.kpis.coveragePct.before;
    covAfterSum += d.kpis.coveragePct.after;
    persistentCount += d.findings.persistentCount;
    totalCommits += d.commitCount;

    const upstreamCount = crossRepoEdges.filter((e) => e.to === item.nodeId).length;
    for (const cf of d.changedFiles) {
      changedFiles.push({
        ...cf,
        path: `${item.slug}/${cf.path}`,
        unitSlug: item.slug,
        moduleId: item.nodeId,
        blastRadius: cf.blastRadius + upstreamCount,
      });
    }
    for (const f of d.findings.introduced) {
      introduced.push({ ...f, subject: `[${item.slug}] ${f.subject}`, file: `${item.slug}/${f.file}` });
    }
    for (const f of d.findings.resolved) {
      resolved.push({ ...f, subject: `[${item.slug}] ${f.subject}`, file: `${item.slug}/${f.file}` });
    }
    for (const x of d.surfaces.endpointsAdded) epAdded.add(`[${item.slug}] ${x}`);
    for (const x of d.surfaces.endpointsRemoved) epRemoved.add(`[${item.slug}] ${x}`);
    for (const x of d.surfaces.externalAdded) extAdded.add(x);
    for (const x of d.surfaces.externalRemoved) extRemoved.add(x);
    for (const x of d.surfaces.envAdded) envAdded.add(x);
    for (const x of d.surfaces.envRemoved) envRemoved.add(x);
    for (const x of d.surfaces.entitiesAdded) entAdded.add(x);
    for (const x of d.surfaces.entitiesRemoved) entRemoved.add(x);
  }

  const covBefore = Math.round((covBeforeSum / Math.max(1, inputs.length)) * 10) / 10;
  const covAfter = Math.round((covAfterSum / Math.max(1, inputs.length)) * 10) / 10;
  const covDelta = Math.round((covAfter - covBefore) * 10) / 10;
  const newErrors = introduced.filter((f) => f.severity === "error").length;
  const newWarns = introduced.filter((f) => f.severity === "warn").length;
  const verdict: CommitArchDiff["verdict"] = newErrors > 0 ? "risk" : newWarns > 0 || covDelta <= -1 ? "caution" : "safe";

  const overlayBundle = meshDiag
    ? buildOverlayBundle("diff:mesh", "Distributed System Mesh", meshDiag, meshDiag, modifiedNodeIds, deltaByNodeId)
    : null;

  return {
    range: inputs.map((i) => `${i.slug}:${i.diff.baseSha}..${i.diff.headSha}`).join(" + "),
    baseRef: "base",
    headRef: "head",
    baseSha: `${inputs.length} PRs`,
    headSha: "federated",
    commitSubject: `Federated PR impact across ${inputs.map((i) => i.slug).join(", ")}`,
    author: Array.from(new Set(inputs.map((i) => i.diff.author))).join(", "),
    date: inputs[0]?.diff.date ?? "federated",
    commitCount: totalCommits,
    verdict,
    verdictSummary: `Aggregates ${inputs.length} PR diff${inputs.length === 1 ? "" : "s"} (${changedFiles.length} files, +${changedFiles.reduce((s, f) => s + f.insertions, 0)}/-${changedFiles.reduce((s, f) => s + f.deletions, 0)}), ${newErrors} new failure${newErrors === 1 ? "" : "s"}, ${newWarns} new warning${newWarns === 1 ? "" : "s"}.`,
    kpis: {
      failures: { before: failBefore, after: failAfter, delta: failAfter - failBefore },
      warnings: { before: warnBefore, after: warnAfter, delta: warnAfter - warnBefore },
      coveragePct: { before: covBefore, after: covAfter, delta: covDelta },
      files: {
        added: changedFiles.filter((f) => f.status === "added").length,
        modified: changedFiles.filter((f) => f.status === "modified" || f.status === "renamed").length,
        deleted: changedFiles.filter((f) => f.status === "deleted").length,
        insertions: changedFiles.reduce((s, f) => s + f.insertions, 0),
        deletions: changedFiles.reduce((s, f) => s + f.deletions, 0),
      },
      nodes: { added: 0, modified: modifiedNodeIds.size, removed: 0 },
      edges: { added: 0, removed: 0 },
    },
    surfaces: {
      endpointsAdded: Array.from(epAdded).sort().slice(0, 30),
      endpointsRemoved: Array.from(epRemoved).sort().slice(0, 30),
      externalAdded: Array.from(extAdded).sort(),
      externalRemoved: Array.from(extRemoved).sort(),
      envAdded: Array.from(envAdded).sort().slice(0, 30),
      envRemoved: Array.from(envRemoved).sort().slice(0, 30),
      entitiesAdded: Array.from(entAdded).sort().slice(0, 30),
      entitiesRemoved: Array.from(entRemoved).sort().slice(0, 30),
    },
    findings: { introduced, resolved, persistentCount },
    edgeChanges: { added: [], removed: [] },
    changedFiles: changedFiles.slice(0, 200),
    diagrams: overlayBundle ? [overlayBundle] : [],
  };
}

export interface AggEntityBucket {
  datastore: string;
  entity: string;
  repos: Set<string>;
  declared: boolean;
  authorizedShared: boolean;
  totalRefs: number;
  layers: Set<string>;
  domains: Set<string>;
  hasBypass: boolean;
  fkCount: number;
  hasTenancyKey: boolean;
  sampleFiles: string[];
}

export function evaluateFederatedInvariants(params: {
  repoNodeIds: string[];
  serviceEdges: SpecEdge[];
  entityAgg: Map<string, AggEntityBucket>;
  rolledInvariants: SqlInvariantResult[];
  toSlugFn: (s: string) => string;
}): {
  invariants: SqlInvariantResult[];
  mergedEntities: EntityOwnership[];
  cycleCount: number;
  sharedEntityCount: number;
} {
  const { repoNodeIds, serviceEdges, entityAgg, rolledInvariants, toSlugFn } = params;
  const topo = computeTopologicalLevels(repoNodeIds, serviceEdges);
  const cycleEvidence: SqlInvariantResult["evidence"] = [];
  for (const scc of topo.sccs) {
    if (scc.length <= 1) continue;
    const sccSet = new Set(scc);
    const names = scc.map((id) => id.replace(/^fed:repo:/, ""));
    for (const e of serviceEdges) {
      if (sccSet.has(e.from) && sccSet.has(e.to)) {
        e.violation = true;
        e.ruleIds = [...(e.ruleIds ?? []), "fed:cross-repo-cycle"];
      }
    }
    cycleEvidence.push({
      subject: names.join(" ⇄ "),
      detail: `Distributed circular dependency between repositories: ${names.join(" → ")} → ${names[0]}`,
      file: ".",
      targetNodeId: scc[0],
    });
  }

  const sharedDbEvidence: SqlInvariantResult["evidence"] = [];
  const mergedEntities: EntityOwnership[] = [];
  for (const ent of entityAgg.values()) {
    const repoList = Array.from(ent.repos).sort();
    const isCoupled = repoList.length >= 2 && !ent.authorizedShared;
    if (isCoupled) {
      sharedDbEvidence.push({
        subject: `${ent.datastore}:${ent.entity}`,
        detail: `Accessed by ${repoList.length} separate repositories (${repoList.join(", ")}) — shared-database coupling anti-pattern.`,
        file: ent.sampleFiles[0] ?? ".",
        targetNodeId: `fed:db:${toSlugFn(ent.datastore)}`,
      });
    }
    mergedEntities.push({
      datastore: ent.datastore,
      entity: ent.entity,
      declared: ent.declared,
      authorizedShared: ent.authorizedShared,
      totalRefs: ent.totalRefs,
      layers: Array.from(ent.layers).sort(),
      domains: repoList,
      hasBypass: ent.hasBypass || isCoupled,
      fkCount: ent.fkCount,
      hasTenancyKey: ent.hasTenancyKey,
      sampleFiles: ent.sampleFiles,
    });
  }

  const invariants: SqlInvariantResult[] = [
    {
      id: "fed:cross-repo-cycle",
      name: "Acyclic Cross-Repo Service Graph",
      rung: "R1",
      severity: "error",
      status: cycleEvidence.length > 0 ? "fail" : "pass",
      sqlFile: "federate.ts",
      statement: "Microservice repositories must form an acyclic dependency graph without mutual call loops.",
      why: "Cross-repo call cycles create retry storms, deployment lockstep, and cascading outages.",
      fix: "Invert one service call using an asynchronous event/outbox or extract shared read models.",
      violationCount: cycleEvidence.length,
      evidence: cycleEvidence,
    },
    {
      id: "fed:shared-datastore-coupling",
      name: "Single-Owner Datastore Boundaries",
      rung: "R2",
      severity: "warn",
      status: sharedDbEvidence.length > 0 ? "warn" : "pass",
      sqlFile: "federate.ts",
      statement: "Each database table or collection should be owned by a single microservice repository.",
      why: "Shared databases tightly couple deployments and break schema evolution across independent teams (DDIA Ch. 4 & 11).",
      fix: "Expose data across repository boundaries via versioned APIs or event streams instead of direct table access.",
      violationCount: sharedDbEvidence.length,
      evidence: sharedDbEvidence,
    },
    ...rolledInvariants,
  ];

  return {
    invariants,
    mergedEntities,
    cycleCount: cycleEvidence.length,
    sharedEntityCount: sharedDbEvidence.length,
  };
}
