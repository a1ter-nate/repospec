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

const CS_TEST_RE = /(?:Tests?\/|\.Tests?\.|Spec\.cs$|Test\.cs$)/i;

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

function classifyCSharpCall(expr: string): { op: FlowEffectKind; lane: FlowLane } {
  if (/(?:Cache|Redis)\w*\.(?:RemoveAsync|DeleteAsync|Invalidate|Evict)/i.test(expr)) {
    return { op: "cache_del", lane: "cache" };
  }
  if (/(?:Cache|Redis)\w*\.(?:GetAsync|GetStringAsync|TryGetValue)/i.test(expr)) {
    return { op: "cache_read", lane: "cache" };
  }
  if (/(?:Send.*Notification|NotifyAsync|SendPush|SendEmail|HubContext.*SendAsync)/i.test(expr)) {
    return { op: "notify", lane: "async_push" };
  }
  if (/(?:Publish(?:Async)?|SendMessageAsync|Enqueue|ScheduleAsync)/i.test(expr)) {
    return { op: "async_enqueue", lane: "async_push" };
  }
  if (/(?:SaveChangesAsync|CommitAsync|CommitTransactionAsync)/i.test(expr)) {
    return { op: "tx_commit", lane: "datastore" };
  }
  if (/(?:HttpClient|_http|Geocode|Timezone|Stripe|Twilio|SendAsync\s*\()/i.test(expr)) {
    return { op: "external_http", lane: "external" };
  }
  if (/(?:Update\w*Async|Save\w*Async|Insert\w*Async|Delete\w*Async|Upsert\w*Async|Capture\w*Async|ExecuteAsync)/i.test(expr)) {
    return { op: "db_write", lane: "datastore" };
  }
  if (/(?:Get\w*Async|Find\w*Async|FirstOrDefaultAsync|SingleOrDefaultAsync|ToListAsync|QueryAsync|Load\w*Async|Check\w*Async|Resolve\w*Async)/i.test(expr)) {
    return { op: "db_read", lane: "datastore" };
  }
  return { op: "call", lane: "handler" };
}

function extractCSharpFlows(ctx: FlowLanguageFileContext): WorkFlowRecord[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const flows: WorkFlowRecord[] = [];
  const fileAnchors = ctx.anchors.filter((a) => ctx.relFile.endsWith(a.entryFile) || ctx.relFile === a.entryFile);

  for (const m of ctx.text.matchAll(/(?:public|private|internal|protected)\s+(?:virtual\s+|override\s+|static\s+)?async\s+Task(?:<[^>]+>)?\s+([A-Z][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g)) {
    const fnName = m[1];
    if (!fnName || m.index === undefined) continue;
    const openIdx = m.index + m[0].length - 1;
    const { body } = sliceBraceBlock(ctx.text, openIdx);
    const fnStartLine = lineAt(ctx.text, m.index);
    const steps: FlowStep[] = [];
    let parallelSeq = 0;

    const lines = body.split("\n");
    let inWhenAll: number | undefined = undefined;
    for (let li = 0; li < lines.length; li += 1) {
      const lnText = lines[li] ?? "";
      const absLine = fnStartLine + li;
      const trimmed = lnText.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;

      if (/Task\.WhenAll\s*\(/.test(trimmed)) {
        parallelSeq += 1;
        inWhenAll = parallelSeq;
      }

      if (trimmed.includes("await ") || inWhenAll !== undefined || /(?:Cache|Redis)\w*\.(?:Remove|Invalidate)/i.test(trimmed)) {
        const callMatch = trimmed.match(/([A-Za-z0-9_.]+)\s*(?:<[^>]+>)?\s*\(/);
        const fnExpr = callMatch?.[1] ?? "await";
        const cls = classifyCSharpCall(trimmed);
        if (cls.op !== "call") {
          const step: FlowStep = {
            index: steps.length,
            fn: fnExpr,
            op: cls.op,
            lane: cls.lane,
            file: ctx.relFile,
            line: absLine,
            afterResponse: false,
            bestEffort: false,
          };
          if (inWhenAll !== undefined) step.parallelGroup = inWhenAll;
          steps.push(step);
        }
      }

      if (inWhenAll !== undefined && trimmed.includes(");")) {
        inWhenAll = undefined;
      }

      if (/\breturn\s+(?:Ok|Results\.Ok|TypedResults\.Ok|Created|Accepted|NoContent)\s*\(/.test(trimmed)) {
        steps.push({
          index: steps.length,
          fn: "Ok()",
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

function extractCSharpFieldEvents(ctx: FlowLanguageFileContext): RawFieldEvent[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const events: RawFieldEvent[] = [];

  for (const m of ctx.text.matchAll(/\.SetProperty\(\s*[a-zA-Z_]\w*\s*=>\s*[a-zA-Z_]\w*\.([A-Z][A-Za-z0-9_]*)\s*,/g)) {
    const field = m[1];
    if (!field) continue;
    const entity = ctx.relFile.split("/").pop()?.replace(/(?:Service|Repository|Controller|Dao)?\.cs$/i, "").toLowerCase() || "entity";
    events.push({
      entity: entity.endsWith("s") ? entity : `${entity}s`,
      field,
      kind: "writer",
      fn: "ExecuteUpdateAsync",
      file: ctx.relFile,
      line: lineAt(ctx.text, m.index ?? 0),
      mode: "write",
      derived: false,
    });
  }

  for (const m of ctx.text.matchAll(/\b(device|order|user|cartridge|property|shipment)\.([A-Z][A-Za-z0-9_]*)\s*=/g)) {
    const entityRaw = m[1];
    const field = m[2];
    if (!entityRaw || !field) continue;
    events.push({
      entity: entityRaw.endsWith("s") ? entityRaw : `${entityRaw}s`,
      field,
      kind: "writer",
      fn: `${entityRaw}.${field}=`,
      file: ctx.relFile,
      line: lineAt(ctx.text, m.index ?? 0),
      mode: ctx.text.includes("SaveChangesAsync") ? "tx" : "write",
      derived: false,
    });
  }

  for (const m of ctx.text.matchAll(/(?:public|private|internal)\s+(?:static\s+)?[A-Za-z0-9_<>?]+\s+((?:Derive|Compute|Project)[A-Z][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g)) {
    const fnName = m[1];
    if (!fnName || m.index === undefined) continue;
    const { body } = sliceBraceBlock(ctx.text, m.index + m[0].length - 1);
    const seen = new Set<string>();
    for (const fm of body.matchAll(/\b(device|order|user|cartridge|property|shipment)\.([A-Z][A-Za-z0-9_]*)/g)) {
      const ent = fm[1];
      const field = fm[2];
      if (!ent || !field || seen.has(`${ent}.${field}`)) continue;
      seen.add(`${ent}.${field}`);
      events.push({
        entity: ent.endsWith("s") ? ent : `${ent}s`,
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

function extractCSharpStateMachines(ctx: FlowLanguageFileContext): ExtractedStateMachine[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const machines: ExtractedStateMachine[] = [];

  for (const m of ctx.text.matchAll(/(?:public|internal)\s+enum\s+([A-Z][A-Za-z0-9]*(?:State|Stage|Phase|Status))\s*\{/g)) {
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
      `\\(?\\s*${safeEnum}\\.([A-Z][A-Za-z0-9_]*)(?:\\s*,\\s*"?([A-Za-z0-9_.-]+)"?)?\\s*\\)?(?:\\s+when\\s+([^=>\\n]+))?\\s*=>\\s*${safeEnum}\\.([A-Z][A-Za-z0-9_]*)`,
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

function extractCSharpAsyncEndpoints(ctx: FlowLanguageFileContext): RawAsyncEndpoint[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const out: RawAsyncEndpoint[] = [];

  for (const m of ctx.text.matchAll(/\.Publish\s*<\s*([A-Za-z0-9_]+)\s*>\s*\(/g)) {
    const evType = m[1];
    if (!evType) continue;
    out.push({
      role: "producer",
      channel: `queue:${evType.toLowerCase()}`,
      transport: "queue",
      delivery: "at-least-once",
      ref: { fn: `Publish<${evType}>`, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "csharp" },
    });
  }

  for (const m of ctx.text.matchAll(/class\s+([A-Za-z0-9_]+)\s*:[^{]*\bIConsumer\s*<\s*([A-Za-z0-9_]+)\s*>/g)) {
    const cls = m[1];
    const evType = m[2];
    if (!cls || !evType) continue;
    out.push({
      role: "consumer",
      channel: `queue:${evType.toLowerCase()}`,
      transport: "queue",
      delivery: "at-least-once",
      ref: { fn: cls, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "csharp" },
    });
  }

  for (const m of ctx.text.matchAll(/\[(ServiceBusTrigger|QueueTrigger)\s*\(\s*"([^"]+)"/g)) {
    const trig = m[1];
    const q = m[2];
    if (!trig || !q) continue;
    out.push({
      role: "consumer",
      channel: `queue:${q.toLowerCase()}`,
      transport: "queue",
      delivery: "at-least-once",
      ref: { fn: `${trig}(${q})`, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "csharp" },
    });
  }

  return out;
}

export const csharpFlowLanguage = defineFlowLanguage({
  id: "csharp",
  label: "C# / .NET",
  extensions: [".cs"],
  extractFlows: extractCSharpFlows,
  extractFieldEvents: extractCSharpFieldEvents,
  extractStateMachines: extractCSharpStateMachines,
  extractAsyncEndpoints: extractCSharpAsyncEndpoints,
});
