import type { RepoSpecV4 } from "../../schema.ts";
import type { CommitArchDiff } from "../../studio/commitDiff.ts";
import type { DrilldownIndex } from "../../studio/drilldown.ts";
import type { ArchTimelineData } from "../../extractors/gitMetrics.ts";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


export function buildCompactRenderPayload(
  spec: RepoSpecV4,
  digest: string,
  inline: boolean,
  drilldown?: DrilldownIndex,
  commitDiff?: CommitArchDiff,
  timeline?: ArchTimelineData,
): Record<string, unknown> {
  const includeDrilldown = drilldown && (!inline || drilldown.files.length <= 160);
  const compactDrilldown = includeDrilldown
    ? { files: drilldown.files, edges: drilldown.edges }
    : undefined;
  return {
    schemaVersion: spec.schemaVersion,
    digest,
    repo: spec.repo,
    summary: spec.summary,
    verification: spec.verification,
    diagnostics: spec.diagnostics,
    drilldown: compactDrilldown,
    commitDiff,
    timeline,
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      domain: n.domain,
      kind: n.kind,
      role: n.role,
      label: n.label,
      group: n.group,
      ownerId: n.ownerId,
      provenance: n.provenance,
      findings: n.findings,
      meta: inline
        ? {
            dir: n.meta.dir ?? null,
            archetype: n.meta.archetype ?? null,
            layerAxis: n.meta.layerAxis ?? null,
            layerRank: n.meta.layerRank ?? null,
          }
        : n.meta,
    })),
    edges: spec.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
      weight: e.weight,
      violation: e.violation,
      ruleIds: e.ruleIds,
      confidence: e.confidence,
      evidence: e.evidence?.slice(0, inline ? 2 : 5),
    })),
    invariants: spec.invariants.map((inv) => ({
      ...inv,
      evidence: inv.evidence.slice(0, inline ? 8 : 15),
    })),
    entities: spec.entities.slice(0, inline ? 60 : 250),
    stateMachines: spec.stateMachines.slice(0, inline ? 20 : 40),
    loops: spec.loops.slice(0, inline ? 20 : 40),
    extensions: {
      facts: (spec.extensions?.facts ?? []).slice(0, inline ? 200 : 2000),
      factEdges: (spec.extensions?.factEdges ?? []).slice(0, inline ? 200 : 2000),
      metrics: (spec.extensions?.metrics ?? []).slice(0, inline ? 200 : 2000),
    },
    modules: spec.modules.slice(0, inline ? 80 : 300).map((m) => ({
      ...m,
      topExports: m.topExports.slice(0, inline ? 8 : 12),
      files: m.files.slice(0, inline ? 10 : 40),
    })),
    traces: spec.traces,
    surfaces: {
      endpoints: spec.surfaces.endpoints.slice(0, inline ? 50 : 420),
      foreignKeys: spec.surfaces.foreignKeys.slice(0, inline ? 40 : 180),
      envBindings: spec.surfaces.envBindings.slice(0, inline ? 40 : 160),
      govRules: spec.surfaces.govRules.slice(0, inline ? 40 : 160),
    },
    diagrams: inline
      ? spec.diagrams
          .filter((d) => d.category !== "subsystem" || spec.diagrams.length <= 10)
          .slice(0, 16)
          .map((d) => ({
            ...d,
            edges: d.edges.map((e) => ({
              ...e,
              evidence: e.violation ? e.evidence?.slice(0, 2) : undefined,
            })),
          }))
      : spec.diagrams,
  };
}
