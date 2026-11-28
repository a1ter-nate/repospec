import { detectFlowHazards } from "./effectTracer.ts";
import {
  defineFlowLanguage,
  type FlowLanguageFileContext,
  type RawAsyncEndpoint,
  type RawFieldEvent,
} from "./languageTypes.ts";
import type {
  ExtractedStateMachine,
  ExtractedStateTransition,
  FlowEffectKind,
  FlowLane,
  FlowStep,
  WorkFlowRecord,
} from "./types.ts";

const RUST_TEST_RE = /(?:^(?:tests?|examples)\/|\/(?:tests?|examples)\/|_tests?\.rs$)/i;

function stripRustCfgTest(text: string): string {
  const idx = text.search(/#\[cfg\(test\)\]/);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function sliceBraceBlock(text: string, openIdx: number): { body: string; endIdx: number } {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: text.slice(openIdx + 1, i), endIdx: i };
      }
    }
  }
  return { body: text.slice(openIdx + 1), endIdx: text.length };
}

function classifyRustCall(expr: string, fnExpr = ""): { op: FlowEffectKind; lane: FlowLane } {
  const noStrings = expr.replace(/"(?:\\.|[^"\\])*"/g, '""');
  const target = fnExpr || noStrings;
  if (/^\.bind\b/.test(target.trim())) {
    if (/(?:\.fetch_(?:one|all|optional)|\.execute\s*\()/i.test(noStrings)) {
      return /\.execute\s*\(/i.test(noStrings) ? { op: "db_write", lane: "datastore" } : { op: "db_read", lane: "datastore" };
    }
    return { op: "call", lane: "handler" };
  }
  if (/(?:cache|redis)\w*\.(?:del|delete|remove|invalidate|evict)/i.test(noStrings) || /invalidate_cache|delete_cache/i.test(target)) {
    return { op: "cache_del", lane: "cache" };
  }
  if (/(?:cache|redis)\w*\.(?:get|fetch|lookup)/i.test(noStrings)) {
    return { op: "cache_read", lane: "cache" };
  }
  if (/\btx\.\w*(?:enqueue|outbox|insert|write|notify)/i.test(noStrings) || (/enqueue|outbox/i.test(target) && /&mut\s+\*?tx\b/.test(noStrings))) {
    return { op: "db_write", lane: "datastore" };
  }
  const isSqlCall = /^sqlx::/i.test(target);
  if (!isSqlCall && /(?:send_.*notification|notify|fcm|send_push|send_email|emit_event)/i.test(target)) {
    return { op: "notify", lane: "async_push" };
  }
  if (!isSqlCall && /(?:publish|enqueue|send_record|create_task|produce)/i.test(target)) {
    return { op: "async_enqueue", lane: "async_push" };
  }
  if (/(?:\.commit\s*\(|commit_.*document|transaction\s*\()/i.test(noStrings)) {
    return { op: "tx_commit", lane: "datastore" };
  }
  if (!isSqlCall && /(?:reqwest|http_client|geocode|timezone|stripe|twilio|external)/i.test(target)) {
    return { op: "external_http", lane: "external" };
  }
  if (/(?:update_|save_|insert_|upsert_|delete_|write_|persist_|capture_|execute\s*\(|sqlx::query.*(?:UPDATE|INSERT|DELETE))/i.test(expr)) {
    return { op: "db_write", lane: "datastore" };
  }
  if (/(?:get_|find_|fetch_|load_|read_|list_|query|select|check_|resolve_)/i.test(target)) {
    return { op: "db_read", lane: "datastore" };
  }
  return { op: "call", lane: "handler" };
}

function extractRustFlows(ctx: FlowLanguageFileContext): WorkFlowRecord[] {
  if (RUST_TEST_RE.test(ctx.relFile)) return [];
  const prodText = stripRustCfgTest(ctx.text);
  const flows: WorkFlowRecord[] = [];
  const fileAnchors = ctx.anchors.filter((a) => ctx.relFile.endsWith(a.entryFile) || ctx.relFile === a.entryFile);

  for (const m of prodText.matchAll(/(?:pub(?:\([^)]*\))?\s+)?async\s+fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:<[^>]*>)?\s*\([^)]*\)[^{;]*\{/g)) {
    const fnName = m[1];
    if (!fnName || m.index === undefined) continue;
    const openIdx = m.index + m[0].length - 1;
    const { body } = sliceBraceBlock(prodText, openIdx);
    const fnStartLine = lineAt(prodText, m.index);
    const bodyStartLine = lineAt(prodText, openIdx);
    const steps: FlowStep[] = [];
    let parallelSeq = 0;

    const lines = body.split("\n");
    let inJoinGroup: number | undefined = undefined;
    for (let li = 0; li < lines.length; li += 1) {
      const lnText = lines[li] ?? "";
      const absLine = bodyStartLine + li;
      const trimmed = lnText.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;

      if (/(?:tokio::(?:try_)?join!|futures::(?:try_)?join!)\s*\(/.test(trimmed)) {
        parallelSeq += 1;
        inJoinGroup = parallelSeq;
      }

      if (trimmed.includes(".await") || inJoinGroup !== undefined) {
        const callMatch = trimmed.match(/([a-zA-Z0-9_:.]+)\s*\(/);
        const fnExpr = callMatch?.[1] ?? trimmed.replace(/\.await.*/, "").slice(0, 32);
        const cls = classifyRustCall(trimmed, fnExpr);
        if (cls.op !== "call") {
          const usesSharedTx = /&mut\s+\*?tx\b|tx\.as_mut\(\)|\btx\./.test(trimmed);
          const step: FlowStep = {
            index: steps.length,
            fn: fnExpr,
            op: cls.op,
            lane: cls.lane,
            file: ctx.relFile,
            line: absLine,
            afterResponse: false,
            bestEffort: /let\s+_\s*=|\.ok\(\)/.test(trimmed),
          };
          if (inJoinGroup !== undefined) step.parallelGroup = inJoinGroup;
          else if (usesSharedTx) {
            parallelSeq += 1;
            step.parallelGroup = parallelSeq;
          }
          steps.push(step);
        }
      }

      if (inJoinGroup !== undefined && trimmed.includes(");")) {
        inJoinGroup = undefined;
      }

      if (/(?:Ok\s*\(\s*Json\(|HttpResponse::Ok|StatusCode::OK|IntoResponse)/.test(trimmed)) {
        steps.push({
          index: steps.length,
          fn: "Ok(Json)",
          op: "response_send",
          lane: "client",
          file: ctx.relFile,
          line: absLine,
          afterResponse: false,
          bestEffort: false,
        });
      }
    }

    const anchor = fileAnchors.find((a) => !a.entryFn || a.entryFn === fnName);
    const ioCount = steps.filter((s) => s.op !== "response_send").length;
    if (!anchor && ioCount < 2) continue;

    const responseSteps = steps.filter((s) => s.op === "response_send");
    const responseIdx = responseSteps.length > 0 ? responseSteps[responseSteps.length - 1]?.index ?? null : null;
    const writeSteps = steps.filter((s) => s.op === "tx_commit" || s.op === "db_write");
    const commitIdx = writeSteps.length > 0 ? writeSteps[writeSteps.length - 1]?.index ?? null : null;
    const serialAwaitCount = steps.filter(
      (s) => s.op !== "response_send" && s.parallelGroup === undefined && (responseIdx === null || s.index < responseIdx),
    ).length;

    const flowName = anchor ? anchor.name : fnName;
    const hazards = detectFlowHazards(flowName, ctx.relFile, steps, responseIdx, commitIdx);
    const rec: WorkFlowRecord = {
      id: anchor ? anchor.id : `flow:${ctx.unitSlug}:${ctx.relFile}:${fnName}`,
      name: flowName,
      entryFn: fnName,
      triggerKind: anchor ? "journey" : responseIdx !== null ? "http" : "trigger",
      file: ctx.relFile,
      line: fnStartLine,
      unit: ctx.unitSlug,
      steps,
      responseStepIndex: responseIdx,
      commitStepIndex: commitIdx,
      serialAwaitCount,
      hazards,
    };
    if (anchor?.tags && anchor.tags.length > 0) rec.tags = [...anchor.tags];
    flows.push(rec);
  }

  return flows;
}

function extractRustFieldEvents(ctx: FlowLanguageFileContext): RawFieldEvent[] {
  if (RUST_TEST_RE.test(ctx.relFile)) return [];
  const prodText = stripRustCfgTest(ctx.text);
  const events: RawFieldEvent[] = [];

  for (const m of prodText.matchAll(/UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+([^"';\n]+)/gi)) {
    const entity = (m[1] ?? "entity").toLowerCase();
    const setClause = m[2] ?? "";
    const ln = lineAt(prodText, m.index ?? 0);
    for (const colMatch of setClause.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g)) {
      const col = colMatch[1];
      if (!col) continue;
      events.push({
        entity,
        field: col,
        kind: "writer",
        fn: `sql:UPDATE ${entity}`,
        file: ctx.relFile,
        line: ln,
        mode: "write",
        derived: false,
      });
    }
  }

  for (const m of ctx.text.matchAll(/(?:pub\s+)?fn\s+((?:derive|compute|project)_[a-zA-Z0-9_]+)\s*\([^)]*\)[^{]*\{/g)) {
    const fnName = m[1];
    if (!fnName || m.index === undefined) continue;
    const { body } = sliceBraceBlock(ctx.text, m.index + m[0].length - 1);
    const entity = fnName.replace(/^(?:derive|compute|project)_/, "").split("_")[0] ?? "entity";
    const seen = new Set<string>();
    for (const fm of body.matchAll(/\b(?:device|record|doc|row|order|entity)\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      const field = fm[1];
      if (!field || seen.has(field)) continue;
      seen.add(field);
      events.push({
        entity: entity.endsWith("s") ? entity : `${entity}s`,
        field,
        kind: "reader",
        fn: fnName,
        file: ctx.relFile,
        line: lineAt(ctx.text, m.index),
        mode: "write",
        derived: true,
      });
    }
  }

  return events;
}

function extractRustStateMachines(ctx: FlowLanguageFileContext): ExtractedStateMachine[] {
  if (RUST_TEST_RE.test(ctx.relFile)) return [];
  const machines: ExtractedStateMachine[] = [];

  for (const m of ctx.text.matchAll(/(?:pub\s+)?enum\s+([A-Z][A-Za-z0-9]*(?:State|Stage|Phase|Status))\s*\{/g)) {
    const enumName = m[1];
    if (!enumName || m.index === undefined) continue;
    const { body } = sliceBraceBlock(ctx.text, m.index + m[0].length - 1);
    const states = Array.from(
      new Set(
        body
          .split(",")
          .map((seg) => seg.replace(/\/\/[^\n]*/g, "").trim().match(/^([A-Z][A-Za-z0-9_]*)/)?.[1])
          .filter((s): s is string => Boolean(s)),
      ),
    );
    if (states.length < 3) continue;

    const transitions: ExtractedStateTransition[] = [];
    const seen = new Set<string>();
    const safeEnum = enumName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const armRe = new RegExp(
      `\\(?\\s*${safeEnum}::([A-Z][A-Za-z0-9_]*)(?:\\s*,\\s*([A-Za-z0-9_:]+))?\\s*\\)?(?:\\s+if\\s+([^=>\\n]+))?\\s*=>[^,\\n]*${safeEnum}::([A-Z][A-Za-z0-9_]*)`,
      "g",
    );
    for (const am of ctx.text.matchAll(armRe)) {
      const from = am[1];
      const event = am[2] ?? `to_${am[4] ?? ""}`;
      const guard = am[3]?.trim();
      const to = am[4];
      if (!from || !to) continue;
      const key = `${from}->${to}:${event}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tr: ExtractedStateTransition = { from, to, event };
      if (guard) tr.guard = guard;
      transitions.push(tr);
    }

    if (transitions.length >= 2) {
      machines.push({
        id: `sm:${ctx.unitSlug}:${enumName}`,
        name: enumName,
        file: ctx.relFile,
        line: lineAt(ctx.text, m.index),
        unit: ctx.unitSlug,
        states,
        transitions,
      });
    }
  }

  return machines;
}

function extractRustAsyncEndpoints(ctx: FlowLanguageFileContext): RawAsyncEndpoint[] {
  if (RUST_TEST_RE.test(ctx.relFile)) return [];
  const out: RawAsyncEndpoint[] = [];

  for (const m of ctx.text.matchAll(/\b(?:publish|send_record|enqueue)\s*\(\s*"([^"]+)"/g)) {
    const ch = m[1];
    if (!ch) continue;
    out.push({
      role: "producer",
      channel: `queue:${ch.toLowerCase()}`,
      transport: "queue",
      delivery: "at-least-once",
      ref: { fn: `publish(${ch})`, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "rust" },
    });
  }

  for (const m of ctx.text.matchAll(/\b(?:subscribe|consume|on_message)\s*\(\s*"([^"]+)"/g)) {
    const ch = m[1];
    if (!ch) continue;
    out.push({
      role: "consumer",
      channel: `queue:${ch.toLowerCase()}`,
      transport: "queue",
      delivery: "at-least-once",
      ref: { fn: `subscribe(${ch})`, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "rust" },
    });
  }

  return out;
}

export const rustFlowLanguage = defineFlowLanguage({
  id: "rust",
  label: "Rust",
  extensions: [".rs"],
  extractFlows: extractRustFlows,
  extractFieldEvents: extractRustFieldEvents,
  extractStateMachines: extractRustStateMachines,
  extractAsyncEndpoints: extractRustAsyncEndpoints,
});
