import fs from "node:fs";
import path from "node:path";
import type {
  ExtractorPlugin,
  FactEdgeRecord,
  FactRecord,
  GraphFragment,
  MetricRecord,
  RepoContext,
  StateMachineRecord,
  UnitDescriptor,
} from "../../../../src/schema.ts";
import {
  applyTelemetryOverlay,
  extractAsyncHandoffs,
  loadDeclarativeFlowAnchors,
  loadTelemetryOverlay,
} from "./asyncStitcher.ts";
import { buildEntityLifecycles } from "./dataLifecycle.ts";
import { BUILTIN_FLOW_LANGUAGES, loadRepoFlowLanguages } from "./languageRegistry.ts";
import type { FlowLanguagePlugin, RawAsyncEndpoint, RawFieldEvent } from "./languageTypes.ts";
import type {
  AsyncHandoff,
  EntityFieldLifecycle,
  ExtractedStateMachine,
  FlowAnalysisBundle,
  FlowHazard,
  WorkFlowRecord,
} from "./types.ts";

const EXTRACTOR_ID = "flows.work-and-lifecycle.v1";

function unitSlugForFile(relFile: string, units: readonly UnitDescriptor[]): string {
  const norm = relFile.replace(/\\/g, "/");
  let best = "root";
  let bestLen = -1;
  for (const u of units) {
    const dir = u.dir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (dir === "." || dir === "") {
      if (bestLen < 0) {
        best = u.slug;
        bestLen = 0;
      }
    } else if (norm === dir || norm.startsWith(`${dir}/`)) {
      if (dir.length > bestLen) {
        best = u.slug;
        bestLen = dir.length;
      }
    }
  }
  return best;
}

function walkRepoFiles(repoDir: string): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo", ".repospec"]);
  const walk = (dir: string, relBase: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(repoDir, "");
  return out.sort();
}

function languageForStateMachineFile(relFile: string): string {
  if (relFile.endsWith(".rs")) return "rust";
  if (relFile.endsWith(".cs")) return "csharp";
  if (relFile.endsWith(".py")) return "python";
  if (relFile.endsWith(".go")) return "go";
  return "typescript";
}

export function extractFlowBundle(
  repoDir: string,
  relFiles: readonly string[],
  units: readonly UnitDescriptor[],
  telemetryPath?: string,
  extraLanguages: readonly FlowLanguagePlugin[] = [],
): FlowAnalysisBundle {
  const anchors = loadDeclarativeFlowAnchors(repoDir);
  const allPlugins: readonly FlowLanguagePlugin[] = [...BUILTIN_FLOW_LANGUAGES, ...extraLanguages];
  const pluginsByExt = new Map<string, FlowLanguagePlugin[]>();
  for (const pl of allPlugins) {
    for (const ext of pl.extensions) {
      const norm = ext.toLowerCase();
      const arr = pluginsByExt.get(norm) ?? [];
      arr.push(pl);
      pluginsByExt.set(norm, arr);
    }
  }

  const workFlows: WorkFlowRecord[] = [];
  const rawFieldEvents: RawFieldEvent[] = [];
  const stateMachines: ExtractedStateMachine[] = [];
  const extraAsyncEndpoints: RawAsyncEndpoint[] = [];

  for (const rel of relFiles) {
    const ext = path.extname(rel).toLowerCase();
    const matchedPlugins = pluginsByExt.get(ext);
    if (!matchedPlugins || matchedPlugins.length === 0) continue;
    const abs = path.join(repoDir, rel);
    if (!fs.existsSync(abs)) continue;
    let text = "";
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 300_000) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const unitSlug = unitSlugForFile(rel, units);
    const fileCtx = { repoDir, relFile: rel, unitSlug, text, anchors };
    for (const pl of matchedPlugins) {
      if (pl.extractFlows) workFlows.push(...pl.extractFlows(fileCtx));
      if (pl.extractFieldEvents) rawFieldEvents.push(...pl.extractFieldEvents(fileCtx));
      if (pl.extractStateMachines) stateMachines.push(...pl.extractStateMachines(fileCtx));
      if (pl.extractAsyncEndpoints) extraAsyncEndpoints.push(...pl.extractAsyncEndpoints(fileCtx));
    }
  }

  workFlows.sort(
    (a, b) =>
      Number(b.triggerKind === "journey") - Number(a.triggerKind === "journey") ||
      b.hazards.length - a.hazards.length ||
      b.serialAwaitCount - a.serialAwaitCount ||
      a.id.localeCompare(b.id),
  );
  const cappedFlows = workFlows.slice(0, 80);

  const finalFlows = telemetryPath
    ? applyTelemetryOverlay(cappedFlows, loadTelemetryOverlay(telemetryPath))
    : cappedFlows;

  const { lifecycles, hazards: dataHazards } = buildEntityLifecycles(rawFieldEvents);
  const asyncHandoffs = extractAsyncHandoffs(repoDir, relFiles, extraAsyncEndpoints);
  const allHazards: FlowHazard[] = [
    ...finalFlows.flatMap((f) => f.hazards),
    ...dataHazards,
  ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));

  return {
    workFlows: finalFlows,
    entityLifecycles: lifecycles,
    stateMachines: stateMachines.slice(0, 40),
    asyncHandoffs,
    hazards: allHazards,
  };
}

export function analyzeRepoFlows(
  repoDir: string,
  options?: { telemetryPath?: string; extraLanguages?: readonly FlowLanguagePlugin[] },
): FlowAnalysisBundle {
  const absRoot = path.resolve(repoDir);
  const files = walkRepoFiles(absRoot);
  return extractFlowBundle(absRoot, files, [], options?.telemetryPath, options?.extraLanguages ?? []);
}

export async function analyzeRepoFlowsWithPlugins(
  repoDir: string,
  options?: { telemetryPath?: string; extraLanguages?: readonly FlowLanguagePlugin[] },
): Promise<FlowAnalysisBundle> {
  const absRoot = path.resolve(repoDir);
  const files = walkRepoFiles(absRoot);
  const repoLangs = await loadRepoFlowLanguages(absRoot);
  const merged = [...repoLangs, ...(options?.extraLanguages ?? [])];
  return extractFlowBundle(absRoot, files, [], options?.telemetryPath, merged);
}

export function buildFlowAnalysisFromFacts(
  facts: readonly FactRecord[],
): FlowAnalysisBundle {
  const workFlows: WorkFlowRecord[] = [];
  const entityLifecycles: EntityFieldLifecycle[] = [];
  const stateMachines: ExtractedStateMachine[] = [];
  const asyncHandoffs: AsyncHandoff[] = [];
  const hazards: FlowHazard[] = [];

  for (const f of facts) {
    if (f.kind === "work_flow") {
      const p = f.payload;
      if (Array.isArray(p.steps)) {
        workFlows.push({
          id: f.key,
          name: String(p.name ?? f.key),
          triggerKind: (p.triggerKind as WorkFlowRecord["triggerKind"]) ?? "http",
          file: f.file,
          line: f.line,
          unit: f.unit,
          steps: p.steps as WorkFlowRecord["steps"],
          responseStepIndex: typeof p.responseStepIndex === "number" ? p.responseStepIndex : null,
          commitStepIndex: typeof p.commitStepIndex === "number" ? p.commitStepIndex : null,
          serialAwaitCount: typeof p.serialAwaitCount === "number" ? p.serialAwaitCount : 0,
          hazards: Array.isArray(p.hazards) ? (p.hazards as FlowHazard[]) : [],
          tags: Array.isArray(p.tags) ? (p.tags as string[]) : undefined,
        });
      }
    } else if (f.kind === "data_lifecycle") {
      const p = f.payload;
      entityLifecycles.push({
        entity: String(p.entity ?? "entity"),
        field: String(p.field ?? f.key),
        writers: Array.isArray(p.writers) ? (p.writers as EntityFieldLifecycle["writers"]) : [],
        readers: Array.isArray(p.readers) ? (p.readers as EntityFieldLifecycle["readers"]) : [],
        derivedOnRead: Boolean(p.derivedOnRead),
        multiWriterRisk: Boolean(p.multiWriterRisk),
      });
    } else if (f.kind === "state_machine") {
      const p = f.payload;
      stateMachines.push({
        id: f.key,
        name: String(p.name ?? f.key),
        file: f.file,
        line: f.line,
        unit: f.unit,
        states: Array.isArray(p.states) ? (p.states as string[]) : [],
        transitions: Array.isArray(p.transitions) ? (p.transitions as ExtractedStateMachine["transitions"]) : [],
      });
    } else if (f.kind === "async_handoff") {
      const p = f.payload;
      if (p.producer && typeof p.producer === "object") {
        asyncHandoffs.push({
          channel: f.key,
          transport: (p.transport as AsyncHandoff["transport"]) ?? "queue",
          delivery: (p.delivery as AsyncHandoff["delivery"]) ?? "best-effort",
          producer: p.producer as AsyncHandoff["producer"],
          consumer: p.consumer && typeof p.consumer === "object" ? (p.consumer as AsyncHandoff["consumer"]) : undefined,
        });
      }
    } else if (f.kind === "ddia_hazard") {
      const p = f.payload;
      hazards.push({
        kind: (p.hazardKind as FlowHazard["kind"]) ?? "blocking_noncritical_io",
        severity: f.severity === "error" ? "error" : "warn",
        file: f.file,
        line: f.line,
        subject: String(p.subject ?? f.key),
        summary: String(p.summary ?? ""),
        stepIndexes: Array.isArray(p.stepIndexes) ? (p.stepIndexes as number[]) : [],
      });
    }
  }

  return { workFlows, entityLifecycles, stateMachines, asyncHandoffs, hazards };
}

export const flowExtractorPlugin: ExtractorPlugin = {
  id: EXTRACTOR_ID,
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const repoLangs = await loadRepoFlowLanguages(ctx.rootDir);
    const bundle = extractFlowBundle(ctx.rootDir, ctx.allFiles, ctx.units, undefined, repoLangs);
    const facts: FactRecord[] = [];
    const factEdges: FactEdgeRecord[] = [];
    const metrics: MetricRecord[] = [];
    const stateMachines: StateMachineRecord[] = [];

    for (const wf of bundle.workFlows) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "work_flow",
        key: wf.id,
        file: wf.file,
        line: wf.line,
        unit: wf.unit,
        symbol: wf.name,
        severity: wf.hazards.some((h) => h.severity === "error") ? "error" : wf.hazards.length > 0 ? "warn" : "info",
        payload: {
          name: wf.name,
          triggerKind: wf.triggerKind,
          serialAwaitCount: wf.serialAwaitCount,
          responseStepIndex: wf.responseStepIndex,
          commitStepIndex: wf.commitStepIndex,
          steps: wf.steps.slice(0, 24),
          hazards: wf.hazards,
          tags: wf.tags ?? [],
        },
      });
      for (let i = 0; i < wf.steps.length - 1; i += 1) {
        const cur = wf.steps[i];
        const nxt = wf.steps[i + 1];
        if (!cur || !nxt) continue;
        factEdges.push({
          extractorId: EXTRACTOR_ID,
          kind: cur.parallelGroup !== undefined && cur.parallelGroup === nxt.parallelGroup ? "parallel_branch" : "next_step",
          fromRef: `${wf.id}#${cur.index}:${cur.fn}`,
          toRef: `${wf.id}#${nxt.index}:${nxt.fn}`,
          file: wf.file,
          line: cur.line,
          payload: { opFrom: cur.op, opTo: nxt.op },
        });
      }
    }

    for (const lc of bundle.entityLifecycles) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "data_lifecycle",
        key: `${lc.entity}.${lc.field}`,
        file: lc.writers[0]?.file ?? lc.readers[0]?.file ?? ".",
        line: lc.writers[0]?.line ?? lc.readers[0]?.line ?? 1,
        unit: unitSlugForFile(lc.writers[0]?.file ?? ".", ctx.units),
        severity: lc.multiWriterRisk ? "warn" : "info",
        payload: {
          entity: lc.entity,
          field: lc.field,
          writers: lc.writers,
          readers: lc.readers,
          derivedOnRead: lc.derivedOnRead,
          multiWriterRisk: lc.multiWriterRisk,
        },
      });
    }

    for (const sm of bundle.stateMachines) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "state_machine",
        key: sm.id,
        file: sm.file,
        line: sm.line,
        unit: sm.unit,
        symbol: sm.name,
        severity: "info",
        payload: {
          name: sm.name,
          states: sm.states,
          transitions: sm.transitions,
        },
      });
      stateMachines.push({
        id: sm.id,
        name: sm.name,
        language: languageForStateMachineFile(sm.file),
        unit: sm.unit,
        evidence: "declared",
        states: sm.states,
        transitions: sm.transitions.map((t) => {
          const tr: StateMachineRecord["transitions"][number] = {
            from: t.from,
            event: t.event,
            to: t.to,
          };
          if (t.guard) tr.guard = t.guard;
          return tr;
        }),
        provenance: {
          file: sm.file,
          line: sm.line,
        },
      });
    }

    for (const ah of bundle.asyncHandoffs) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "async_handoff",
        key: ah.channel,
        file: ah.producer.file,
        line: ah.producer.line,
        unit: unitSlugForFile(ah.producer.file, ctx.units),
        symbol: ah.producer.fn,
        severity: ah.delivery === "best-effort" ? "warn" : "info",
        payload: {
          transport: ah.transport,
          delivery: ah.delivery,
          producer: ah.producer,
          consumer: ah.consumer ?? null,
        },
      });
      if (ah.consumer) {
        factEdges.push({
          extractorId: EXTRACTOR_ID,
          kind: "async_handoff",
          fromRef: `${ah.producer.file}:${ah.producer.fn}`,
          toRef: `${ah.consumer.file}:${ah.consumer.fn}`,
          file: ah.producer.file,
          line: ah.producer.line,
          payload: { channel: ah.channel, transport: ah.transport, delivery: ah.delivery },
        });
      }
    }

    for (const hz of bundle.hazards) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "ddia_hazard",
        key: `${hz.kind}:${hz.file}:${hz.line}`,
        file: hz.file,
        line: hz.line,
        unit: unitSlugForFile(hz.file, ctx.units),
        severity: hz.severity,
        payload: {
          hazardKind: hz.kind,
          subject: hz.subject,
          summary: hz.summary,
          stepIndexes: hz.stepIndexes,
        },
      });
    }

    metrics.push(
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "work_flows_count", valueNum: bundle.workFlows.length },
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "ddia_hazards_count", valueNum: bundle.hazards.length },
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "async_handoffs_count", valueNum: bundle.asyncHandoffs.length },
    );

    return {
      nodes: [],
      edges: [],
      rules: [],
      diagnostics: [],
      stateMachines,
      facts,
      factEdges,
      metrics,
    };
  },
};
