import ts from "typescript";
import { collectFunctionSteps } from "./effectTracerHelpers.ts";
import type {
  DeclarativeFlowAnchor,
  FlowHazard,
  FlowStep,
  WorkFlowRecord,
} from "./types.ts";

const ENTRY_PATH_RE =
  /(?:controller|controllers|route|routes|handler|handlers|endpoint|endpoints|api|functions|service\/device|jobs|workers|triggers)\//i;
const TEST_FILE_RE = /(?:__tests__|\.test\.|\.spec\.|\/tests?\/|fixtures\/|_tests?\.rs$|Tests?\.cs$)/i;
const FRONTEND_OR_SCRIPT_RE = /\.(?:tsx|jsx)$|(?:^|\/)(?:wwwroot|public|static|assets|client|components|pages|ui|browser|scripts|tools|cli|e2e)\//i;
const NONCRITICAL_IO_RE = /(?:capture|timezone|geocode|analytics|telemetry|audit|diagnostic|metrics|logEvent)/i;
const POLL_NAME_RE = /\b(?:getUpdates|poll(?:er|ing|s)?|heartbeat|check_?in|syncStatus|fetchUpdates)\b/i;
const WRITE_HANDLER_PREFIX_RE =
  /^(?:set|put|post|patch|update|create|save|write|delete|remove|configure|record|upsert|register|enable|disable|clear|reset|ack|close|cancel|submit|approve|reject)(?:[_-]|[A-Z])/;

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

export function detectFlowHazards(
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

  const parallelIdiom = relFile.endsWith(".rs")
    ? "tokio::join!/try_join!"
    : relFile.endsWith(".cs")
      ? "Task.WhenAll"
      : relFile.endsWith(".py")
        ? "asyncio.gather"
        : "Promise.all/allSettled";

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
        summary: `${runIndexes.length} consecutive independent ${runStart.op} steps starting at ${runStart.fn} (line ${runStart.line}) can run concurrently with ${parallelIdiom}.`,
        stepIndexes: [...runIndexes],
      });
    }
    runStart = null;
    runIndexes = [];
  };

  for (const s of ioSteps) {
    if (s.parallelGroup === undefined && (s.op === "notify" || s.op === "db_read")) {
      const sameScope = runStart !== null && runStart.scopeId === s.scopeId;
      const dependsOnRun = s.dependsOnSteps?.some((dep) => runIndexes.includes(dep)) ?? false;
      if (runStart && runStart.op === s.op && sameScope && !dependsOnRun) {
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

  if (responseIdx !== null && !FRONTEND_OR_SCRIPT_RE.test(relFile)) {
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

  if (POLL_NAME_RE.test(flowName) && !WRITE_HANDLER_PREFIX_RE.test(flowName.trim())) {
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
