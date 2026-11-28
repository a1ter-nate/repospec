import type { EntityFieldLifecycle, FlowHazard, LdfiCutSetRecord, WorkFlowRecord } from "./types.ts";

const TEST_OR_EXAMPLE_RE = /(?:__tests__|\.test\.|\.spec\.|\/(?:tests?|examples|fixtures)\/|_tests?\.rs$|Tests?\.cs$)/i;
const DERIVED_FIELD_RE = /(?:count|total|sum|avg|cached|summary|badge|unread|pending_?count|is_?empty|has_?)/i;
const IDEMPOTENCY_GUARD_RE = /\b(?:idempotenc|idempotent|dedupe|on\s+conflict|upsert|if\s+not\s+exists|x-idempotency-key|request_id|correlation_id)\b/i;
const LIMIT_OR_PAGE_RE = /\b(?:limit|take|pageSize|page_size|maxResults|max_results|per_page|perPage|cursor|nextToken|next_token|offset|top|slice\(|LIMIT\s+\d+)\b/i;

function lineAt(text: string, idx: number): number {
  let ln = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) ln += 1;
  }
  return ln;
}

export function detectGunawiResilienceHazards(relFile: string, text: string): FlowHazard[] {
  if (TEST_OR_EXAMPLE_RE.test(relFile)) return [];
  const hazards: FlowHazard[] = [];

  for (const m of text.matchAll(/(?:runTransaction|transaction|\.tx\s*\(|BEGIN\s+TRANSACTION|\bbegin\s*\(\s*\))[\s\S]{0,900}?\b(fetch\s*\(|axios\.|reqwest::|stripe\.|twilio\.|sendEmail|sendSms|sendPush|httpClient\.)/gi)) {
    const idx = m.index ?? 0;
    const callTok = m[1] ?? "external IO";
    const block = m[0] ?? "";
    const commitPos = block.search(/\bcommit\s*\(/i);
    const callPos = block.indexOf(callTok);
    if (commitPos >= 0 && callPos > commitPos) continue;
    hazards.push({
      kind: "io_inside_transaction",
      severity: "error",
      file: relFile,
      line: lineAt(text, idx + Math.max(0, callPos)),
      subject: `${relFile}: ${callTok.replace(/\($/, "")}`,
      summary: `Calls external service "${callTok.replace(/\($/, "")}" while holding an open database transaction — move it outside the transaction or use a post-commit outbox so slow networks cannot lock DB connections.`,
      stepIndexes: [],
    });
  }

  for (const m of text.matchAll(/(?:retry|withRetry|backoff|attempts\s*[<>]=?\s*\d+)[\s\S]{0,450}?\b(createCharge|chargeCard|transferFunds|insertOrder|sendEmail|sendSms|POST\b|INSERT\s+INTO)/gi)) {
    const snippet = m[0] ?? "";
    if (IDEMPOTENCY_GUARD_RE.test(snippet)) continue;
    hazards.push({
      kind: "non_idempotent_retry",
      severity: "warn",
      file: relFile,
      line: lineAt(text, m.index ?? 0),
      subject: `${relFile}: ${m[1] ?? "retry"}`,
      summary: `Retries "${m[1] ?? "write"}" without an idempotency key or dedupe check — a network timeout could cause duplicate charges, emails, or records.`,
      stepIndexes: [],
    });
  }

  for (const m of text.matchAll(/\b(findMany|fetch_all|listAll|getAll|SELECT\s+\*\s+FROM\s+[a-zA-Z0-9_]+)\s*\([^)]{0,160}\)/gi)) {
    const snippet = text.slice(Math.max(0, (m.index ?? 0) - 60), Math.min(text.length, (m.index ?? 0) + 220));
    if (LIMIT_OR_PAGE_RE.test(snippet)) continue;
    hazards.push({
      kind: "unbounded_pagination",
      severity: "warn",
      file: relFile,
      line: lineAt(text, m.index ?? 0),
      subject: `${relFile}: ${m[1] ?? "query"}`,
      summary: `Fetches all records via "${m[1] ?? "query"}" without a LIMIT, cursor, or page size — this can slow down or run out of memory as data grows.`,
      stepIndexes: [],
    });
  }

  return hazards;
}

export function detectDerivedStateSyncHazards(lifecycles: readonly EntityFieldLifecycle[]): FlowHazard[] {
  const hazards: FlowHazard[] = [];
  for (const lc of lifecycles) {
    if (!DERIVED_FIELD_RE.test(lc.field)) continue;
    const distinctFiles = new Set(lc.writers.map((w) => w.file));
    if (distinctFiles.size < 2) continue;
    const first = lc.writers[0];
    if (!first) continue;
    hazards.push({
      kind: "derived_state_sync",
      severity: "warn",
      file: first.file,
      line: first.line,
      subject: `${lc.entity}.${lc.field} (${distinctFiles.size} sync sites)`,
      summary: `Summary/cached field "${lc.entity}.${lc.field}" is manually kept in sync across ${distinctFiles.size} separate files — compute it on read or update it from one single owner so it cannot drift.`,
      stepIndexes: [],
    });
  }
  return hazards;
}

export function computeLdfiMinimalCutSets(workFlows: readonly WorkFlowRecord[]): LdfiCutSetRecord[] {
  const out: LdfiCutSetRecord[] = [];
  for (const wf of workFlows) {
    const ioSteps = wf.steps.filter(
      (s) =>
        s.op !== "response_send" &&
        s.op !== "span" &&
        s.op !== "call" &&
        !s.afterResponse &&
        !s.bestEffort,
    );
    if (ioSteps.length === 0) continue;

    const cutSets: LdfiCutSetRecord["cutSets"] = [];
    const parallelBuckets = new Map<number, typeof ioSteps>();
    for (const s of ioSteps) {
      if (s.parallelGroup !== undefined) {
        const list = parallelBuckets.get(s.parallelGroup) ?? [];
        list.push(s);
        parallelBuckets.set(s.parallelGroup, list);
      } else {
        cutSets.push({
          size: 1,
          kind: "single_point_of_failure",
          steps: [{ index: s.index, fn: s.fn, op: s.op, lane: s.lane, line: s.line }],
        });
      }
    }
    for (const [, groupSteps] of Array.from(parallelBuckets.entries()).sort(([a], [b]) => a - b)) {
      cutSets.push({
        size: groupSteps.length,
        kind: groupSteps.length === 1 ? "single_point_of_failure" : "redundant_group",
        steps: groupSteps.map((s) => ({ index: s.index, fn: s.fn, op: s.op, lane: s.lane, line: s.line })),
      });
    }

    out.push({
      flowId: wf.id,
      flowName: wf.name,
      file: wf.file,
      unit: wf.unit,
      cutSets: cutSets.slice(0, 16),
    });
  }
  return out;
}
