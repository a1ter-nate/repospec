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
import { buildChecksModel } from "./checksModel.ts";
import { buildSurfacesModel } from "./surfacesModel.ts";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function inferFlowUnit(filePath: string): string {
  const m = /^(?:apps|packages|services)\/([^/]+)\//.exec(filePath);
  return m?.[1] ?? "root";
}

function inferFlowGroup(filePath: string): string {
  const stripped = filePath
    .replace(/^(?:apps|packages|services)\/[^/]+\//, "")
    .replace(/^(?:functions|src|lib)\//, "");
  const segs = stripped.split("/").filter(Boolean);
  return segs.length > 1 ? (segs[0] ?? "root") : "root";
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
    ? { files: drilldown.files, edges: drilldown.edges, extraSources: inline ? undefined : drilldown.extraSources }
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
      unit: inferFlowUnit(wf.file),
      group: inferFlowGroup(wf.file),
      serialAwaitCount: wf.serialAwaitCount,
      hazardCount: wf.hazards.length,
      hasError: wf.hazards.some((h) => h.severity === "error"),
      steps: wf.steps.slice(0, 20),
      hazards: wf.hazards.slice(0, 8),
      svg: renderWorkFlowSwimlaneSvg(wf, { mode: "current" }),
      optimizedSvg: renderWorkFlowSwimlaneSvg(wf, { mode: "optimized" }),
    })),
    dataHubs: Array.from(byEntity.entries())
      .slice(0, inline ? 4 : 24)
      .map(([entity, fields]) => {
        const writers = new Set<string>();
        let multiWriterCount = 0;
        for (const f of fields) {
          if (f.multiWriterRisk) multiWriterCount += 1;
          for (const w of f.writers) writers.add(w.file);
        }
        return {
          entity,
          fieldCount: fields.length,
          writerCount: writers.size,
          multiWriterCount,
          fields: inline ? fields.slice(0, 8) : fields,
          svg: renderDataHubSvg(entity, fields),
        };
      }),
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
  const checksModel = buildChecksModel(spec, flowBundle.workFlows, drilldown);
  const surfacesModel = buildSurfacesModel(spec, flowBundle.entityLifecycles, drilldown);
  const inlineEndpoints = inline
    ? [...surfacesModel.endpoints]
        .sort((a, b) => (a.guardClass === "unknown" ? 0 : 1) - (b.guardClass === "unknown" ? 0 : 1))
        .slice(0, 80)
    : surfacesModel.endpoints;
  const inlineEnvVars = inline
    ? [...surfacesModel.envVars]
        .sort((a, b) => (a.isSecret && a.isDrift ? 0 : a.isDrift ? 1 : a.isSecret ? 2 : 3) - (b.isSecret && b.isDrift ? 0 : b.isDrift ? 1 : b.isSecret ? 2 : 3))
        .slice(0, 80)
    : surfacesModel.envVars;
  const compactSurfacesModel = inline
    ? {
        ...surfacesModel,
        endpoints: inlineEndpoints,
        entities: surfacesModel.entities.slice(0, 60),
        envVars: inlineEnvVars,
        foreignKeys: surfacesModel.foreignKeys.slice(0, 40),
      }
    : surfacesModel;

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
    checksModel,
    surfacesModel: compactSurfacesModel,
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
      evidence: inline ? inv.evidence.slice(0, 8) : inv.evidence,
    })),
    entities: inline ? spec.entities.slice(0, 60) : spec.entities,
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
      endpoints: inline ? spec.surfaces.endpoints.slice(0, 50) : spec.surfaces.endpoints,
      foreignKeys: inline ? spec.surfaces.foreignKeys.slice(0, 40) : spec.surfaces.foreignKeys,
      envBindings: inline ? spec.surfaces.envBindings.slice(0, 40) : spec.surfaces.envBindings,
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
