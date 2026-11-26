import type { RepoSpecV4 } from "../../schema.ts";
import type { CommitArchDiff } from "../../studio/commitDiff.ts";
import type { DrilldownIndex } from "../../studio/drilldown.ts";
import type { ArchTimelineData } from "../../extractors/gitMetrics.ts";
import { buildFlowAnalysisFromFacts, type EntityFieldLifecycle } from "../../../packages/flows/src/index.ts";
import {
  renderAsyncHandoffsSvg,
  renderDataHubSvg,
  renderStateMachineSvg,
  renderWorkFlowSwimlaneSvg,
} from "../../../packages/flows/src/svg.ts";

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
  const flowBundle = buildFlowAnalysisFromFacts(spec.extensions?.facts ?? []);
  const byEntity = new Map<string, EntityFieldLifecycle[]>();
  for (const lf of flowBundle.entityLifecycles) {
    const arr = byEntity.get(lf.entity) ?? [];
    arr.push(lf);
    byEntity.set(lf.entity, arr);
  }
  const flowPayload = {
    workFlows: flowBundle.workFlows.slice(0, inline ? 8 : 80).map((wf) => ({
      id: wf.id,
      name: wf.name,
      entryFn: wf.entryFn ?? wf.name,
      triggerKind: wf.triggerKind,
      file: wf.file,
      line: wf.line,
      serialAwaitCount: wf.serialAwaitCount,
      hazardCount: wf.hazards.length,
      steps: wf.steps.slice(0, 20),
      hazards: wf.hazards.slice(0, 8),
      svg: renderWorkFlowSwimlaneSvg(wf, { mode: "current" }),
      optimizedSvg: renderWorkFlowSwimlaneSvg(wf, { mode: "optimized" }),
    })),
    dataHubs: Array.from(byEntity.entries())
      .slice(0, inline ? 4 : 24)
      .map(([entity, fields]) => ({
        entity,
        fieldCount: fields.length,
        fields: fields.slice(0, 8),
        svg: renderDataHubSvg(entity, fields),
      })),
    stateMachines: flowBundle.stateMachines.slice(0, inline ? 4 : 16).map((sm) => ({
      id: sm.id,
      name: sm.name,
      file: sm.file,
      line: sm.line,
      stateCount: sm.states.length,
      transitionCount: sm.transitions.length,
      states: sm.states,
      transitions: sm.transitions,
      svg: renderStateMachineSvg(sm),
    })),
    asyncCount: flowBundle.asyncHandoffs.length,
    asyncHandoffs: flowBundle.asyncHandoffs.slice(0, 40),
    asyncHandoffsSvg:
      flowBundle.asyncHandoffs.length > 0 ? renderAsyncHandoffsSvg(flowBundle.asyncHandoffs) : "",
    hazards: flowBundle.hazards.slice(0, inline ? 20 : 120),
  };
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
    flows: flowPayload,
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
