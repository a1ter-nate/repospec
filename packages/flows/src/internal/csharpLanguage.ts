import { detectFlowHazards } from "./effectTracer.ts";
import { defineFlowLanguage, type FlowLanguageFileContext, type RawAsyncEndpoint, type RawFieldEvent } from "./languageTypes.ts";
import type { ExtractedStateMachine, ExtractedStateTransition, FlowEffectKind, FlowLane, FlowStep, WorkFlowRecord } from "./types.ts";

const CS_TEST_RE = /(?:Tests?\/|\.Tests?\.|Spec\.cs$|Test\.cs$)/i;
const CS_KEYWORDS = new Set([
  "if", "else", "for", "foreach", "while", "do", "switch", "case", "default", "return", "throw",
  "try", "catch", "finally", "await", "async", "var", "new", "null", "true", "false", "this",
  "base", "typeof", "nameof", "sizeof", "is", "as", "in", "out", "ref", "not", "and", "or",
  "string", "int", "long", "bool", "double", "decimal", "float", "byte", "char", "object", "void",
  "Task", "ValueTask", "CancellationToken", "Exception", "List", "Dictionary", "HashSet", "Array",
]);
const NON_ENTITY_VARS = new Set([
  "this", "base", "builder", "options", "config", "configuration", "headers", "response", "request",
  "context", "httpContext", "logger", "metrics", "client", "services", "app", "env", "cancellationToken",
]);

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function sliceDelimited(text: string, openIdx: number, openCh: string, closeCh: string): { body: string; endIdx: number } {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inStr) {
      if (ch === "\\" && inStr !== '@"') { i += 1; continue; }
      if (inStr === '@"' && ch === '"' && text[i + 1] === '"') { i += 1; continue; }
      if (ch === '"' && (inStr === '"' || inStr === '@"')) inStr = null;
      else if (ch === "'" && inStr === "'") inStr = null;
      continue;
    }
    if (ch === "@" && text[i + 1] === '"') { inStr = '@"'; i += 1; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIdx + 1, i), endIdx: i };
    }
  }
  return { body: text.slice(openIdx + 1), endIdx: text.length };
}

function skipBalancedAngle(text: string, idx: number): number {
  if (text[idx] !== "<") return idx;
  let depth = 0;
  for (let i = idx; i < text.length; i += 1) {
    if (text[i] === "<") depth += 1;
    else if (text[i] === ">") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return idx;
}

function classifyCSharpCall(expr: string): { op: FlowEffectKind; lane: FlowLane } {
  if (/(?:Cache|Redis)\w*\.(?:RemoveAsync|DeleteAsync|Invalidate|Evict)/i.test(expr)) return { op: "cache_del", lane: "cache" };
  if (/(?:Cache|Redis)\w*\.(?:GetAsync|GetStringAsync|GetOrCreateAsync|TryGetValue)/i.test(expr)) return { op: "cache_read", lane: "cache" };
  if (/(?:Send.*Notification|NotifyAsync|SendPush|SendEmail|HubContext.*SendAsync|Clients\.\w+\.SendAsync)/i.test(expr)) return { op: "notify", lane: "async_push" };
  if (/(?:Publish(?:Async)?|SendMessageAsync|SendEndpoint.*Send|Enqueue(?:Async)?|ScheduleAsync)/i.test(expr)) return { op: "async_enqueue", lane: "async_push" };
  if (/(?:SaveChangesAsync|CommitAsync|CommitTransactionAsync)/i.test(expr)) return { op: "tx_commit", lane: "datastore" };
  if (
    /(?:HttpClient|_?http\w*|Geocode|Timezone|Stripe|Twilio|Refit|RestClient|Flurl)\w*\./i.test(expr) ||
    /\.(?:GetFromJsonAsync|PostAsJsonAsync|PutAsJsonAsync|DeleteFromJsonAsync|GetStringAsync|SendAsync)\s*(?:<[^>]*>)?\s*\(/.test(expr)
  ) return { op: "external_http", lane: "external" };
  if (/(?:Update\w*Async|Save\w*Async|Insert\w*Async|Delete\w*Async|Remove\w*Async|Add\w*Async|Upsert\w*Async|Capture\w*Async|Create\w*Async|ExecuteUpdateAsync|ExecuteDeleteAsync|ExecuteAsync|BeginTransactionAsync)/i.test(expr)) {
    return { op: "db_write", lane: "datastore" };
  }
  if (/(?:Get\w*Async|Find\w*Async|First(?:OrDefault)?Async|Single(?:OrDefault)?Async|ToListAsync|ToArrayAsync|ToDictionaryAsync|AnyAsync|CountAsync|LongCountAsync|Query\w*Async|Load\w*Async|Fetch\w*Async|Check\w*Async|Resolve\w*Async|List\w*Async|Read\w*Async)/i.test(expr)) {
    return { op: "db_read", lane: "datastore" };
  }
  return { op: "call", lane: "handler" };
}

function findAsyncBlocks(text: string): Array<{ fnName: string; startLine: number; body: string; isHttpRoute: boolean }> {
  const blocks: Array<{ fnName: string; startLine: number; body: string; isHttpRoute: boolean }> = [];
  const seenOpen = new Set<number>();
  for (const m of text.matchAll(/\basync\s+(?:Task|ValueTask|IAsyncEnumerable)\b/g)) {
    if (m.index === undefined) continue;
    let pos = m.index + m[0].length;
    while (pos < text.length && /\s/.test(text[pos] ?? "")) pos += 1;
    if (text[pos] === "<") pos = skipBalancedAngle(text, pos);
    while (pos < text.length && /\s/.test(text[pos] ?? "")) pos += 1;
    const fnName = text.slice(pos).match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    if (!fnName) continue;
    pos += fnName.length;
    while (pos < text.length && /\s/.test(text[pos] ?? "")) pos += 1;
    if (text[pos] === "<") pos = skipBalancedAngle(text, pos);
    while (pos < text.length && /\s/.test(text[pos] ?? "")) pos += 1;
    if (text[pos] !== "(") continue;
    pos = sliceDelimited(text, pos, "(", ")").endIdx + 1;
    const tail = text.slice(pos, pos + 260);
    const braceRel = tail.search(/\{/);
    const semiRel = tail.search(/;/);
    if (braceRel < 0 || (semiRel >= 0 && semiRel < braceRel)) continue;
    const openIdx = pos + braceRel;
    if (seenOpen.has(openIdx)) continue;
    seenOpen.add(openIdx);
    blocks.push({ fnName, startLine: lineAt(text, m.index), body: sliceDelimited(text, openIdx, "{", "}").body, isHttpRoute: false });
  }
  for (const m of text.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"\s*,\s*async\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>\s*\{/g)) {
    if (m.index === undefined) continue;
    const openIdx = m.index + m[0].length - 1;
    if (seenOpen.has(openIdx)) continue;
    seenOpen.add(openIdx);
    blocks.push({
      fnName: `${(m[1] ?? "GET").toUpperCase()} ${m[2] ?? "/"}`,
      startLine: lineAt(text, m.index),
      body: sliceDelimited(text, openIdx, "{", "}").body,
      isHttpRoute: true,
    });
  }
  return blocks;
}

function extractAssignedTargets(lhs: string): string[] {
  const out: string[] = [];
  const tupleMatch = lhs.match(/\(([^)]+)\)\s*$/);
  if (tupleMatch?.[1]) {
    for (const part of tupleMatch[1].split(",")) {
      const ident = part.trim().split(/\s+/).pop()?.trim();
      if (ident && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ident) && ident !== "_" && !CS_KEYWORDS.has(ident)) out.push(ident);
    }
    return out;
  }
  const simple = lhs.trim().split(/\s+/).pop()?.replace(/^this\./, "");
  if (simple && /^[A-Za-z_][A-Za-z0-9_]*$/.test(simple) && simple !== "_" && !CS_KEYWORDS.has(simple)) out.push(simple);
  return out;
}

function analyzeCSharpBodySteps(body: string, fnStartLine: number, relFile: string): FlowStep[] {
  const steps: FlowStep[] = [];
  const lines = body.split("\n");
  let parallelSeq = 0;
  let inWhenAll: number | undefined = undefined;
  let scopeSeq = 0;
  let curScope = 0;
  const scopeStack: number[] = [];
  let pendingBranchBrace = false;
  const taintedBySteps = new Map<string, Set<number>>();

  const unionDeps = (expr: string): Set<number> => {
    const deps = new Set<number>();
    for (const m of expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      const tok = m[1];
      const src = tok && !CS_KEYWORDS.has(tok) ? taintedBySteps.get(tok) : undefined;
      if (src) for (const id of src) deps.add(id);
    }
    return deps;
  };

  for (let li = 0; li < lines.length; li += 1) {
    const trimmed = (lines[li] ?? "").replace(/\/\/.*$/, "").trim();
    const absLine = fnStartLine + li;
    if (!trimmed) continue;

    const startsBranch = /^(?:if|else\b|switch|for|foreach|while|do\b|catch|finally)\b/.test(trimmed);
    const openCount = (trimmed.match(/\{/g) ?? []).length;
    const closeCount = (trimmed.match(/\}/g) ?? []).length;
    if (closeCount > 0 && openCount === 0) {
      for (let c = 0; c < closeCount; c += 1) if (scopeStack.length > 0) scopeStack.pop();
      scopeSeq += 1;
      curScope = scopeSeq;
    }
    if (startsBranch || pendingBranchBrace) {
      if (openCount > 0) {
        scopeStack.push(curScope);
        scopeSeq += 1;
        curScope = scopeSeq;
        pendingBranchBrace = false;
      } else if (startsBranch && !trimmed.includes(";")) pendingBranchBrace = true;
      else if (startsBranch) { scopeSeq += 1; curScope = scopeSeq; }
    }

    if (/Task\.WhenAll\s*\(/.test(trimmed)) { parallelSeq += 1; inWhenAll = parallelSeq; }

    const eqIdx = trimmed.indexOf("=");
    const isAssign =
      eqIdx > 0 &&
      trimmed[eqIdx + 1] !== "=" &&
      trimmed[eqIdx + 1] !== ">" &&
      trimmed[eqIdx - 1] !== "!" &&
      trimmed[eqIdx - 1] !== "<" &&
      trimmed[eqIdx - 1] !== ">";

    if (trimmed.includes("await ") || inWhenAll !== undefined || /(?:Cache|Redis)\w*\.(?:Remove|Invalidate)/i.test(trimmed)) {
      const rhs = isAssign ? trimmed.slice(eqIdx + 1) : trimmed;
      const lhs = isAssign ? trimmed.slice(0, eqIdx) : "";
      if (/\?\?|\?\s*[^:?]+\s*:|\|\||&&/.test(rhs)) { scopeSeq += 1; curScope = scopeSeq; }
      const deps = unionDeps(rhs);
      const awaitPart = rhs.includes("await ") ? rhs.slice(rhs.indexOf("await ") + 6) : rhs;
      const fnExpr = awaitPart.match(/([A-Za-z0-9_.]+)\s*(?:<[^>]+>)?\s*\(/)?.[1] ?? "await";
      const cls = classifyCSharpCall(rhs);
      if (cls.op !== "call") {
        const stepIdx = steps.length;
        const step: FlowStep = {
          index: stepIdx,
          fn: fnExpr,
          op: cls.op,
          lane: cls.lane,
          file: relFile,
          line: absLine,
          afterResponse: false,
          bestEffort: false,
          scopeId: curScope,
        };
        if (deps.size > 0) step.dependsOnSteps = Array.from(deps).sort((a, b) => a - b);
        if (inWhenAll !== undefined) step.parallelGroup = inWhenAll;
        steps.push(step);
        if (isAssign) {
          const nextDeps = new Set<number>(deps);
          nextDeps.add(stepIdx);
          for (const target of extractAssignedTargets(lhs)) taintedBySteps.set(target, nextDeps);
        }
      } else if (isAssign && deps.size > 0) {
        for (const target of extractAssignedTargets(lhs)) taintedBySteps.set(target, new Set(deps));
      }
    } else if (isAssign) {
      const deps = unionDeps(trimmed.slice(eqIdx + 1));
      if (deps.size > 0) for (const target of extractAssignedTargets(trimmed.slice(0, eqIdx))) taintedBySteps.set(target, new Set(deps));
    }

    if (inWhenAll !== undefined && trimmed.includes(");")) inWhenAll = undefined;

    if (/\breturn\s+(?:Ok|Results\.(?:Ok|Created|Accepted|NoContent|Json|BadRequest|NotFound)|TypedResults\.(?:Ok|Created|Accepted|NoContent|BadRequest|NotFound)|Created|CreatedAtAction|Accepted|NoContent|BadRequest|NotFound|Conflict)\s*\(/.test(trimmed)) {
      steps.push({
        index: steps.length,
        fn: trimmed.match(/\breturn\s+([A-Za-z0-9_.]+)\s*\(/)?.[1] ?? "Ok()",
        op: "response_send",
        lane: "client",
        file: relFile,
        line: absLine,
        afterResponse: false,
        bestEffort: false,
        scopeId: curScope,
      });
      scopeSeq += 1;
      curScope = scopeSeq;
    } else if (/^(?:return\b|throw\b)/.test(trimmed)) {
      scopeSeq += 1;
      curScope = scopeSeq;
    }
  }
  return steps;
}

function extractCSharpFlows(ctx: FlowLanguageFileContext): WorkFlowRecord[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const flows: WorkFlowRecord[] = [];
  const fileAnchors = ctx.anchors.filter((a) => ctx.relFile.endsWith(a.entryFile) || ctx.relFile === a.entryFile);

  for (const blk of findAsyncBlocks(ctx.text)) {
    const steps = analyzeCSharpBodySteps(blk.body, blk.startLine, ctx.relFile);
    const anchor = fileAnchors.find((a) => !a.entryFn || a.entryFn === blk.fnName);
    if (!anchor && steps.filter((s) => s.op !== "response_send").length < 2) continue;

    const responseSteps = steps.filter((s) => s.op === "response_send");
    const responseIdx = responseSteps.length > 0 ? responseSteps[responseSteps.length - 1]?.index ?? null : null;
    const writeSteps = steps.filter((s) => s.op === "tx_commit" || s.op === "db_write");
    const commitIdx = writeSteps.length > 0 ? writeSteps[writeSteps.length - 1]?.index ?? null : null;
    const serialAwaitCount = steps.filter((s) => s.op !== "response_send" && s.parallelGroup === undefined && (responseIdx === null || s.index < responseIdx)).length;

    const flowName = anchor ? anchor.name : blk.fnName;
    const rec: WorkFlowRecord = {
      id: anchor ? anchor.id : `flow:${ctx.unitSlug}:${ctx.relFile}:${blk.fnName}`,
      name: flowName,
      entryFn: blk.fnName,
      triggerKind: anchor ? "journey" : blk.isHttpRoute || responseIdx !== null ? "http" : "trigger",
      file: ctx.relFile,
      line: blk.startLine,
      unit: ctx.unitSlug,
      steps,
      responseStepIndex: responseIdx,
      commitStepIndex: commitIdx,
      serialAwaitCount,
      hazards: detectFlowHazards(flowName, ctx.relFile, steps, responseIdx, commitIdx),
    };
    if (anchor?.tags && anchor.tags.length > 0) rec.tags = [...anchor.tags];
    flows.push(rec);
  }
  return flows;
}

function extractCSharpFieldEvents(ctx: FlowLanguageFileContext): RawFieldEvent[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const events: RawFieldEvent[] = [];
  const fallbackEntity = ctx.relFile.split("/").pop()?.replace(/(?:Service|Repository|Repo|Controller|Endpoints?|Handler|Dao)?\.cs$/i, "").toLowerCase() || "entity";

  for (const m of ctx.text.matchAll(/\.SetProperty\(\s*[a-zA-Z_]\w*\s*=>\s*[a-zA-Z_]\w*\.([A-Z][A-Za-z0-9_]*)\s*,/g)) {
    if (!m[1]) continue;
    events.push({
      entity: fallbackEntity.endsWith("s") ? fallbackEntity : `${fallbackEntity}s`,
      field: m[1],
      kind: "writer",
      fn: "ExecuteUpdateAsync",
      file: ctx.relFile,
      line: lineAt(ctx.text, m.index ?? 0),
      mode: "write",
      derived: false,
    });
  }

  for (const m of ctx.text.matchAll(/\b([a-z][A-Za-z0-9_]{2,28})\.([A-Z][A-Za-z0-9_]*)\s*=(?!=)/g)) {
    const varName = m[1];
    const field = m[2];
    if (!varName || !field || NON_ENTITY_VARS.has(varName) || varName.startsWith("_")) continue;
    const entityNorm = varName.toLowerCase();
    events.push({
      entity: entityNorm.endsWith("s") ? entityNorm : `${entityNorm}s`,
      field,
      kind: "writer",
      fn: `${varName}.${field}=`,
      file: ctx.relFile,
      line: lineAt(ctx.text, m.index ?? 0),
      mode: ctx.text.includes("SaveChangesAsync") ? "tx" : "write",
      derived: false,
    });
  }

  for (const m of ctx.text.matchAll(/(?:public|private|internal)\s+(?:static\s+)?[A-Za-z0-9_<>?,\s]+\s+((?:Derive|Compute|Project|Calculate|Map)[A-Z][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g)) {
    const fnName = m[1];
    if (!fnName || m.index === undefined) continue;
    const { body } = sliceDelimited(ctx.text, m.index + m[0].length - 1, "{", "}");
    const seen = new Set<string>();
    for (const fm of body.matchAll(/\b([a-z][A-Za-z0-9_]{2,28})\.([A-Z][A-Za-z0-9_]*)/g)) {
      const ent = fm[1];
      const field = fm[2];
      if (!ent || !field || NON_ENTITY_VARS.has(ent) || ent.startsWith("_") || seen.has(`${ent}.${field}`)) continue;
      seen.add(`${ent}.${field}`);
      const entNorm = ent.toLowerCase();
      events.push({
        entity: entNorm.endsWith("s") ? entNorm : `${entNorm}s`,
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

  for (const m of ctx.text.matchAll(/(?:(?:public|internal|private|file)\s+)?enum\s+([A-Z][A-Za-z0-9_]*(?:State|Stage|Phase|Status))\s*(?::\s*\w+\s*)?\{/g)) {
    const enumName = m[1];
    if (!enumName || m.index === undefined) continue;
    const { body } = sliceDelimited(ctx.text, m.index + m[0].length - 1, "{", "}");
    const states = Array.from(
      new Set(body.split(",").map((seg) => seg.replace(/\/\/[^\n]*/g, "").replace(/\[[^\]]+\]/g, "").trim().match(/^([A-Z][A-Za-z0-9_]*)/)?.[1]).filter((s): s is string => Boolean(s))),
    );
    if (states.length < 2) continue;

    const transitions: ExtractedStateTransition[] = [];
    const seen = new Set<string>();
    const safeEnum = enumName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pushTr = (from: string, to: string, event: string, guard?: string): void => {
      const key = `${from}->${to}:${event}`;
      if (seen.has(key)) return;
      seen.add(key);
      transitions.push(guard ? { from, to, event, guard } : { from, to, event });
    };
    const armRe = new RegExp(`\\(?\\s*${safeEnum}\\.([A-Z][A-Za-z0-9_]*)(?:\\s*,\\s*(?:\\w+\\.)?"?([A-Za-z0-9_.-]+)"?)?\\s*\\)?(?:\\s+when\\s+([^=>\\n]+))?\\s*=>\\s*${safeEnum}\\.([A-Z][A-Za-z0-9_]*)`, "g");
    for (const am of ctx.text.matchAll(armRe)) {
      if (am[1] && am[4]) pushTr(am[1], am[4], am[2] ?? `to_${am[4]}`, am[3]?.trim() || undefined);
    }
    const caseRe = new RegExp(`case\\s+${safeEnum}\\.([A-Z][A-Za-z0-9_]*)\\s*:[\\s\\S]{0,220}?(?:return|=)\\s*${safeEnum}\\.([A-Z][A-Za-z0-9_]*)`, "g");
    for (const cm of ctx.text.matchAll(caseRe)) {
      if (cm[1] && cm[2] && cm[1] !== cm[2]) pushTr(cm[1], cm[2], `to_${cm[2]}`);
    }

    if (transitions.length >= 2) {
      machines.push({ id: `sm:${ctx.unitSlug}:${enumName}`, name: enumName, file: ctx.relFile, line: lineAt(ctx.text, m.index), unit: ctx.unitSlug, states, transitions });
    }
  }
  return machines;
}

function extractCSharpAsyncEndpoints(ctx: FlowLanguageFileContext): RawAsyncEndpoint[] {
  if (CS_TEST_RE.test(ctx.relFile)) return [];
  const out: RawAsyncEndpoint[] = [];
  for (const m of ctx.text.matchAll(/\.(?:Publish|Send)\s*<\s*([A-Za-z0-9_]+)\s*>\s*\(/g)) {
    if (!m[1]) continue;
    out.push({ role: "producer", channel: `queue:${m[1].toLowerCase()}`, transport: "queue", delivery: "at-least-once", ref: { fn: `Publish<${m[1]}>`, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "csharp" } });
  }
  for (const m of ctx.text.matchAll(/class\s+([A-Za-z0-9_]+)(?:\s*\([^)]*\))?\s*:[^{]*\b(?:IConsumer|IRequestHandler|INotificationHandler)\s*<\s*([A-Za-z0-9_]+)/g)) {
    if (!m[1] || !m[2]) continue;
    out.push({ role: "consumer", channel: `queue:${m[2].toLowerCase()}`, transport: "queue", delivery: "at-least-once", ref: { fn: m[1], file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "csharp" } });
  }
  for (const m of ctx.text.matchAll(/\[(ServiceBusTrigger|QueueTrigger|EventHubTrigger|RabbitMQTrigger)\s*\(\s*"([^"]+)"/g)) {
    if (!m[1] || !m[2]) continue;
    out.push({ role: "consumer", channel: `queue:${m[2].toLowerCase()}`, transport: "queue", delivery: "at-least-once", ref: { fn: `${m[1]}(${m[2]})`, file: ctx.relFile, line: lineAt(ctx.text, m.index ?? 0), language: "csharp" } });
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
