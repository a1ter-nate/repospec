import { createHash } from "node:crypto";
import type { FactRecord, RepoSpecV4 } from "./schema.ts";

export interface FactDiffResult {
  readonly kind?: string;
  readonly added: FactRecord[];
  readonly removed: FactRecord[];
  readonly unchangedCount: number;
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

function factIdentity(f: FactRecord): string {
  return `${f.kind}|${f.key}|${f.file}`;
}

export function diffFactSets(
  baseFacts: readonly FactRecord[],
  headFacts: readonly FactRecord[],
  kind?: string,
): FactDiffResult {
  const baseFiltered = kind ? baseFacts.filter((f) => f.kind === kind) : baseFacts;
  const headFiltered = kind ? headFacts.filter((f) => f.kind === kind) : headFacts;
  const baseMap = new Map(baseFiltered.map((f) => [factIdentity(f), f]));
  const headMap = new Map(headFiltered.map((f) => [factIdentity(f), f]));
  const added: FactRecord[] = [];
  const removed: FactRecord[] = [];
  let unchangedCount = 0;
  for (const [k, f] of headMap) {
    if (baseMap.has(k)) unchangedCount += 1;
    else added.push(f);
  }
  for (const [k, f] of baseMap) {
    if (!headMap.has(k)) removed.push(f);
  }
  return { kind, added, removed, unchangedCount };
}
