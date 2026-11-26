import ts from "typescript";
import type {
  DeclarativeFlowAnchor,
  FlowEffectKind,
  FlowHazard,
  FlowLane,
  FlowStep,
  WorkFlowRecord,
} from "./types.ts";

const ENTRY_PATH_RE =
  /(?:controller|controllers|route|routes|handler|handlers|endpoint|endpoints|api|functions|service\/device|jobs|workers|triggers)\//i;
const TEST_FILE_RE = /(?:__tests__|\.test\.|\.spec\.|\/tests?\/|fixtures\/)/i;
const WRITE_NAME_RE =
  /(?:^|\.)(update|save|create|insert|upsert|delete|remove|commit|write|set|patch|put|persist|capture|record|install|runInstall|backfill)/i;
const READ_NAME_RE =
  /(?:^|\.)(get|find|fetch|read|load|list|query|lookup|check|resolve|select|count)/i;
const TX_NAME_RE = /(?:commit.*document|runTransaction|transaction|\.tx\b|batch\.commit)/i;
const CACHE_DEL_RE = /(?:deleteCache|delCache|invalidateCache|evictCache|cache\.(?:del|delete|invalidate|evict|clear))/i;
const CACHE_READ_RE = /(?:getCache|cache\.(?:get|read|lookup))/i;
const NOTIFY_RE = /(?:send.*Notification|send.*Update|notify|fcm|messaging\(\)\.send|sendPush|sendEmail|sendSms|emitEvent)/i;
const ASYNC_ENQ_RE = /(?:enqueue|createTask|publish\b|publishMessage|addJob|dispatchAsync|sendToQueue)/i;
const EXT_HTTP_RE =
  /(?:fetch\b|axios|got\b|geocode|timezone|setTimeZone|stripe|twilio|sendgrid|slack|github|openai|anthropic)/i;
const NONCRITICAL_IO_RE = /(?:capture|timezone|geocode|analytics|telemetry|audit|diagnostic|metrics|logEvent)/i;
const POLL_NAME_RE = /(?:getUpdates|poll|heartbeat|checkin|checkIn|syncStatus|fetchUpdates)/i;

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function callNameOf(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = callNameOf(expr.expression);
    return left ? `${left}.${expr.name.text}` : expr.name.text;
  }
  return "";
}

function classifyCall(fnName: string, callExpr: ts.CallExpression): { op: FlowEffectKind; lane: FlowLane } {
  const txt = fnName || callExpr.expression.getText();
  if (/^res\.(?:status|json|send|end)\b/.test(txt) || /\b(?:res|reply)\.(?:json|send|end)\b/.test(txt)) {
    return { op: "response_send", lane: "client" };
  }
  if (/runBusinessSpan|startSpan|withSpan/.test(txt)) {
    return { op: "span", lane: "handler" };
  }
  if (CACHE_DEL_RE.test(txt)) return { op: "cache_del", lane: "cache" };
  if (CACHE_READ_RE.test(txt)) return { op: "cache_read", lane: "cache" };
  if (NOTIFY_RE.test(txt)) return { op: "notify", lane: "async_push" };
  if (ASYNC_ENQ_RE.test(txt)) return { op: "async_enqueue", lane: "async_push" };
  if (TX_NAME_RE.test(txt)) return { op: "tx_commit", lane: "datastore" };
  if (EXT_HTTP_RE.test(txt)) return { op: "external_http", lane: "external" };
  if (WRITE_NAME_RE.test(txt)) return { op: "db_write", lane: "datastore" };
  if (READ_NAME_RE.test(txt)) return { op: "db_read", lane: "datastore" };
  return { op: "call", lane: "handler" };
}

function responseStatusKind(callExpr: ts.CallExpression): "success" | "error" | null {
  const full = callExpr.expression.getText();
  if (!/\b(?:res|response|reply)(?:\.status\([^)]*\))?\.(?:json|send|end)\b/.test(full)) {
    return null;
  }
  const statusMatch = full.match(/\.status\(\s*(\d{3})\s*\)/);
  if (statusMatch?.[1]) {
    const code = Number(statusMatch[1]);
    if (code >= 400) return "error";
  }
  return "success";
}

function isPromiseAllCall(callExpr: ts.CallExpression): boolean {
  const name = callNameOf(callExpr.expression);
  return name === "Promise.all" || name === "Promise.allSettled";
}

interface WalkState {
  steps: FlowStep[];
  responseSent: boolean;
  parallelSeq: number;
}

function collectFunctionSteps(
  sf: ts.SourceFile,
  relFile: string,
  body: ts.ConciseBody,
): FlowStep[] {
  const ws: WalkState = { steps: [], responseSent: false, parallelSeq: 0 };

  const pushStep = (
    fn: string,
    op: FlowEffectKind,
    lane: FlowLane,
    line: number,
    bestEffort: boolean,
    parallelGroup?: number,
    target?: string,
  ): void => {
    const step: FlowStep = {
      index: ws.steps.length,
      fn,
      op,
      lane,
      file: relFile,
      line,
      afterResponse: ws.responseSent,
      bestEffort,
    };
    if (parallelGroup !== undefined) step.parallelGroup = parallelGroup;
    if (target) step.target = target;
    ws.steps.push(step);
  };

  const visit = (node: ts.Node, inCatchTry: boolean, parallelGroup?: number): void => {
    if (ts.isFunctionLike(node) && node !== body) {
      return;
    }

    if (ts.isTryStatement(node)) {
      const hasSwallowCatch = Boolean(node.catchClause);
      visit(node.tryBlock, hasSwallowCatch || inCatchTry, parallelGroup);
      if (node.finallyBlock) visit(node.finallyBlock, inCatchTry, parallelGroup);
      return;
    }

    if (ts.isAwaitExpression(node)) {
      const inner = node.expression;
      if (ts.isCallExpression(inner) && isPromiseAllCall(inner)) {
        ws.parallelSeq += 1;
        const grp = ws.parallelSeq;
        for (const arg of inner.arguments) {
          visit(arg, inCatchTry, grp);
        }
        return;
      }
      if (ts.isCallExpression(inner)) {
        const fn = callNameOf(inner.expression);
        if (fn === "notify" && inner.arguments.length >= 2) {
          const labelArg = inner.arguments[0];
          const label = labelArg && ts.isStringLiteral(labelArg) ? labelArg.text : "notify";
          pushStep(`notify(${label})`, "notify", "async_push", lineOf(sf, inner), true, parallelGroup, label);
          return;
        }
        const cls = classifyCall(fn, inner);
        if (cls.op !== "call") {
          const firstArg = inner.arguments[0];
          const target = firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : undefined;
          pushStep(fn || "await", cls.op, cls.lane, lineOf(sf, inner), inCatchTry, parallelGroup, target);
          if (cls.op === "span") {
            for (const arg of inner.arguments) {
              if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
                visit(arg.body, inCatchTry, parallelGroup);
              }
            }
          }
          return;
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const resKind = responseStatusKind(node);
      if (resKind === "error") {
        return;
      }
      if (resKind === "success") {
        pushStep("res.send", "response_send", "client", lineOf(sf, node), inCatchTry, parallelGroup);
        ws.responseSent = true;
        return;
      }
      const fn = callNameOf(node.expression);
      const cls = classifyCall(fn, node);
      if (cls.op === "cache_del" || cls.op === "cache_read" || cls.op === "async_enqueue") {
        pushStep(fn, cls.op, cls.lane, lineOf(sf, node), inCatchTry, parallelGroup);
        return;
      }
      if (cls.op === "span") {
        const firstArg = node.arguments[0];
        const spanName = firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : fn;
        pushStep(spanName, "span", "handler", lineOf(sf, node), inCatchTry, parallelGroup, spanName);
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            visit(arg.body, inCatchTry, parallelGroup);
          }
        }
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, inCatchTry, parallelGroup));
  };

  visit(body, false);
  return ws.steps;
}

function detectFlowHazards(
  flowName: string,
  relFile: string,
  steps: FlowStep[],
  responseIdx: number | null,
  commitIdx: number | null,
): FlowHazard[] {
  const hazards: FlowHazard[] = [];
  const ioSteps = steps.filter((s) => s.op !== "span" && s.op !== "response_send");

  if (commitIdx !== null) {
    const commitStep = steps[commitIdx];
    const notifyBefore = steps.filter(
      (s) => s.index < commitIdx && (s.op === "notify" || s.op === "async_enqueue"),
    );
    for (const nb of notifyBefore) {
      hazards.push({
        kind: "notify_before_commit",
        severity: "error",
        file: relFile,
        line: nb.line,
        subject: `${flowName}: ${nb.fn}`,
        summary: `${nb.fn} (line ${nb.line}) fires before durable write ${commitStep?.fn ?? "commit"} (line ${commitStep?.line ?? 0}).`,
        stepIndexes: [nb.index, commitIdx],
      });
    }

    const delBefore = steps.filter((s) => s.index < commitIdx && s.op === "cache_del");
    for (const db of delBefore) {
      hazards.push({
        kind: "invalidate_before_write",
        severity: "error",
        file: relFile,
        line: db.line,
        subject: `${flowName}: ${db.fn}`,
        summary: `${db.fn} (line ${db.line}) invalidates cache before DB write ${commitStep?.fn ?? "commit"} (line ${commitStep?.line ?? 0}).`,
        stepIndexes: [db.index, commitIdx],
      });
    }
  }

  let runStart: FlowStep | null = null;
  let runIndexes: number[] = [];
  const flushRun = (): void => {
    if (runStart && runIndexes.length >= 2) {
      hazards.push({
        kind: "serial_independent_awaits",
        severity: "warn",
        file: relFile,
        line: runStart.line,
        subject: `${flowName} (${runIndexes.length} serial ${runStart.op})`,
        summary: `${runIndexes.length} consecutive serial ${runStart.op} steps starting at ${runStart.fn} (line ${runStart.line}) can be parallelized with Promise.all/allSettled.`,
        stepIndexes: [...runIndexes],
      });
    }
    runStart = null;
    runIndexes = [];
  };

  for (const s of ioSteps) {
    if (s.parallelGroup === undefined && (s.op === "notify" || s.op === "db_read")) {
      if (runStart && runStart.op === s.op) {
        runIndexes.push(s.index);
      } else {
        flushRun();
        runStart = s;
        runIndexes = [s.index];
      }
    } else {
      flushRun();
    }
  }
  flushRun();

  if (responseIdx !== null) {
    const blockingNonCritical = steps.filter(
      (s) =>
        s.index < responseIdx &&
        (s.op === "external_http" || NONCRITICAL_IO_RE.test(s.fn)),
    );
    for (const bc of blockingNonCritical) {
      hazards.push({
        kind: "blocking_noncritical_io",
        severity: "warn",
        file: relFile,
        line: bc.line,
        subject: `${flowName}: ${bc.fn}`,
        summary: `${bc.fn} (line ${bc.line}) blocks HTTP response at line ${steps[responseIdx]?.line ?? 0}; candidate for async offload.`,
        stepIndexes: [bc.index, responseIdx],
      });
    }
  }

  if (POLL_NAME_RE.test(flowName)) {
    const pollWrites = steps.filter(
      (s) => (s.op === "db_write" || s.op === "tx_commit") && !s.afterResponse && !/install/i.test(s.fn),
    );
    for (const pw of pollWrites) {
      hazards.push({
        kind: "write_on_poll",
        severity: "warn",
        file: relFile,
        line: pw.line,
        subject: `${flowName}: ${pw.fn}`,
        summary: `Polling endpoint ${flowName} performs synchronous write ${pw.fn} (line ${pw.line}) on every poll.`,
        stepIndexes: [pw.index],
      });
    }
  }

  return hazards;
}

function isCandidateFlowFunction(
  relFile: string,
  fnName: string,
  steps: FlowStep[],
  anchorMatch: DeclarativeFlowAnchor | undefined,
): boolean {
  if (anchorMatch) return steps.length >= 1;
  const ioCount = steps.filter((s) => s.op !== "span" && s.op !== "call").length;
  if (ioCount < 2) return false;
  if (ENTRY_PATH_RE.test(relFile)) return true;
  if (steps.some((s) => s.op === "response_send" || s.op === "span")) return true;
  if (/(?:Handler|Controller|Updater|Workflow|Job|Worker|Sync|Ingest|Process|Update)$/.test(fnName)) {
    return ioCount >= 3;
  }
  return false;
}

export function extractWorkFlowsFromSource(
  sf: ts.SourceFile,
  relFile: string,
  unitSlug: string,
  anchors: readonly DeclarativeFlowAnchor[] = [],
): WorkFlowRecord[] {
  if (TEST_FILE_RE.test(relFile)) return [];
  const fileAnchors = anchors.filter((a) => relFile.endsWith(a.entryFile) || relFile === a.entryFile);
  const flows: WorkFlowRecord[] = [];

  const inspectFn = (name: string, body: ts.ConciseBody, startNode: ts.Node): void => {
    const steps = collectFunctionSteps(sf, relFile, body);
    if (steps.length === 0) return;
    const anchor = fileAnchors.find((a) => !a.entryFn || a.entryFn === name);
    if (!isCandidateFlowFunction(relFile, name, steps, anchor)) return;

    const responseSteps = steps.filter((s) => s.op === "response_send");
    const responseStep = responseSteps.length > 0 ? responseSteps[responseSteps.length - 1] ?? null : null;
    const writeSteps = steps.filter((s) => s.op === "tx_commit" || s.op === "db_write");
    const commitStep = writeSteps.length > 0 ? writeSteps[writeSteps.length - 1] ?? null : null;
    const responseIdx = responseStep ? responseStep.index : null;
    const commitIdx = commitStep ? commitStep.index : null;
    const serialAwaitCount = steps.filter(
      (s) =>
        s.op !== "span" &&
        s.op !== "response_send" &&
        s.parallelGroup === undefined &&
        (responseIdx === null || s.index < responseIdx),
    ).length;

    const triggerKind: WorkFlowRecord["triggerKind"] = anchor
      ? "journey"
      : responseStep
        ? "http"
        : steps.some((s) => s.op === "span")
          ? "span"
          : /cron|schedul/i.test(relFile + name)
            ? "cron"
            : "trigger";

    const flowName = anchor ? anchor.name : name;
    const hazards = detectFlowHazards(flowName, relFile, steps, responseIdx, commitIdx);

    const record: WorkFlowRecord = {
      id: anchor ? anchor.id : `flow:${unitSlug}:${relFile}:${name}`,
      name: flowName,
      entryFn: name,
      triggerKind,
      file: relFile,
      line: lineOf(sf, startNode),
      unit: unitSlug,
      steps,
      responseStepIndex: responseIdx,
      commitStepIndex: commitIdx,
      serialAwaitCount,
      hazards,
    };
    if (anchor?.tags && anchor.tags.length > 0) record.tags = [...anchor.tags];
    flows.push(record);
  };

  const visitTop = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      inspectFn(node.name.text, node.body, node);
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          inspectFn(decl.name.text, decl.initializer.body, decl);
        }
      }
      return;
    }
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.body) {
          inspectFn(`${node.name?.text ?? "Class"}.${member.name.text}`, member.body, member);
        }
      }
      return;
    }
    ts.forEachChild(node, visitTop);
  };

  visitTop(sf);
  return flows;
}
