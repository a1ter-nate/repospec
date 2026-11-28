import ts from "typescript";
import type { FlowEffectKind, FlowLane, FlowStep } from "./types.ts";

const REQ_BODY_PARSE_RE = /(?:^|\.)(?:readJson|parseJson|parseBody|json|text|formData|arrayBuffer)$/i;
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
const EARLY_EXIT_RE = /\b(?:return|throw|continue|break)\b|\b(?:fail|abort|refuse\w*|deny\w*|reject\w*)\s*\(/;

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

function classifyCall(
  fnName: string,
  callExpr: ts.CallExpression,
  awaited = false,
): { op: FlowEffectKind; lane: FlowLane } {
  const txt = fnName || callExpr.expression.getText();
  const isClientJsonRead =
    (awaited || callExpr.arguments.length === 0) && /\.json\b/.test(txt);
  if (!isClientJsonRead && (/^res\.(?:status|json|send|end)\b/.test(txt) || /\b(?:res|reply)\.(?:json|send|end)\b/.test(txt))) {
    return { op: "response_send", lane: "client" };
  }
  if (/runBusinessSpan|startSpan|withSpan/.test(txt)) return { op: "span", lane: "handler" };
  if (CACHE_DEL_RE.test(txt)) return { op: "cache_del", lane: "cache" };
  if (CACHE_READ_RE.test(txt)) return { op: "cache_read", lane: "cache" };
  if (NOTIFY_RE.test(txt)) return { op: "notify", lane: "async_push" };
  if (ASYNC_ENQ_RE.test(txt)) return { op: "async_enqueue", lane: "async_push" };
  if (TX_NAME_RE.test(txt)) return { op: "tx_commit", lane: "datastore" };
  if (EXT_HTTP_RE.test(txt)) return { op: "external_http", lane: "external" };
  if (REQ_BODY_PARSE_RE.test(txt)) return { op: "call", lane: "handler" };
  if (WRITE_NAME_RE.test(txt)) return { op: "db_write", lane: "datastore" };
  if (READ_NAME_RE.test(txt)) return { op: "db_read", lane: "datastore" };
  return { op: "call", lane: "handler" };
}

function responseStatusKind(callExpr: ts.CallExpression, awaited = false): "success" | "error" | null {
  if (awaited) return null;
  const full = callExpr.expression.getText();
  if (!/\b(?:res|response|reply)(?:\.status\([^)]*\))?\.(?:json|send|end)\b/.test(full)) return null;
  if (callExpr.arguments.length === 0 && /\.json\b/.test(full)) return null;
  const statusMatch = full.match(/\.status\(\s*(\d{3})\s*\)/);
  if (statusMatch?.[1] && Number(statusMatch[1]) >= 400) return "error";
  return "success";
}

function collectBindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) { out.push(name.text); return out; }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) collectBindingNames(el.name, out);
  }
  return out;
}

function collectAssignmentTargets(lhs: ts.Expression, out: string[] = []): string[] {
  if (ts.isIdentifier(lhs)) { out.push(lhs.text); return out; }
  if (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) {
    return collectAssignmentTargets(lhs.expression, out);
  }
  if (ts.isParenthesizedExpression(lhs)) return collectAssignmentTargets(lhs.expression, out);
  if (ts.isObjectLiteralExpression(lhs)) {
    for (const prop of lhs.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) out.push(prop.name.text);
      else if (ts.isPropertyAssignment(prop)) collectAssignmentTargets(prop.initializer, out);
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(lhs)) {
    for (const el of lhs.elements) collectAssignmentTargets(el, out);
  }
  return out;
}

function collectUsedIdents(node: ts.Node, out: Set<string> = new Set()): Set<string> {
  if (ts.isIdentifier(node)) { out.add(node.text); return out; }
  if (ts.isPropertyAccessExpression(node)) { collectUsedIdents(node.expression, out); return out; }
  ts.forEachChild(node, (c) => { collectUsedIdents(c, out); });
  return out;
}

function isPromiseAllCall(callExpr: ts.CallExpression): boolean {
  const name = callNameOf(callExpr.expression);
  return name === "Promise.all" || name === "Promise.allSettled";
}

function isShortCircuitOp(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

function isAssignmentOp(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
  );
}

function isLoopStatement(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

interface WalkState {
  steps: FlowStep[];
  responseSent: boolean;
  parallelSeq: number;
  scopeSeq: number;
}

export function collectFunctionSteps(
  sf: ts.SourceFile,
  relFile: string,
  body: ts.ConciseBody,
): FlowStep[] {
  const ws: WalkState = { steps: [], responseSent: false, parallelSeq: 0, scopeSeq: 1 };
  const taintedBySteps = new Map<string, Set<number>>();

  const addTaint = (names: readonly string[], stepIds: Iterable<number>): void => {
    const ids = Array.from(stepIds);
    if (ids.length === 0 || names.length === 0) return;
    for (const name of names) {
      let cur = taintedBySteps.get(name);
      if (!cur) {
        cur = new Set<number>();
        taintedBySteps.set(name, cur);
      }
      for (const id of ids) cur.add(id);
    }
  };

  const findDepSteps = (expr: ts.Node): number[] => {
    const deps = new Set<number>();
    for (const ident of collectUsedIdents(expr)) {
      const prior = taintedBySteps.get(ident);
      if (prior) {
        for (const id of prior) deps.add(id);
      }
    }
    return Array.from(deps).sort((a, b) => a - b);
  };

  const pushStep = (
    fn: string,
    op: FlowEffectKind,
    lane: FlowLane,
    line: number,
    bestEffort: boolean,
    scopeId: number,
    parallelGroup?: number,
    target?: string,
    dependsOnSteps?: number[],
  ): number => {
    const step: FlowStep = {
      index: ws.steps.length,
      fn,
      op,
      lane,
      file: relFile,
      line,
      afterResponse: ws.responseSent,
      bestEffort,
      scopeId,
    };
    if (parallelGroup !== undefined) step.parallelGroup = parallelGroup;
    if (target) step.target = target;
    if (dependsOnSteps && dependsOnSteps.length > 0) step.dependsOnSteps = dependsOnSteps;
    ws.steps.push(step);
    return step.index;
  };

  const visit = (
    node: ts.Node,
    inCatchTry: boolean,
    scopeId: number,
    targetNames: readonly string[],
    parallelGroup?: number,
    parent?: ts.Node,
  ): void => {
    if (ts.isFunctionLike(node) && node !== body) return;

    if (ts.isBlock(node)) {
      let curScope = scopeId;
      for (const stmt of node.statements) {
        visit(stmt, inCatchTry, curScope, [], parallelGroup, node);
        if (ts.isIfStatement(stmt) || isLoopStatement(stmt) || ts.isSwitchStatement(stmt)) {
          if (isLoopStatement(stmt) || ts.isSwitchStatement(stmt) || EARLY_EXIT_RE.test(stmt.getText(sf))) {
            ws.scopeSeq += 1;
            curScope = ws.scopeSeq;
          }
        }
      }
      return;
    }

    if (ts.isIfStatement(node)) {
      visit(node.expression, inCatchTry, scopeId, [], parallelGroup, node);
      ws.scopeSeq += 1;
      visit(node.thenStatement, inCatchTry, ws.scopeSeq, [], parallelGroup, node);
      if (node.elseStatement) {
        ws.scopeSeq += 1;
        visit(node.elseStatement, inCatchTry, ws.scopeSeq, [], parallelGroup, node);
      }
      if (EARLY_EXIT_RE.test(node.thenStatement.getText(sf))) {
        pushStep("guard:early-return", "call", "handler", lineOf(sf, node), false, scopeId, parallelGroup);
      }
      return;
    }

    if (ts.isConditionalExpression(node)) {
      visit(node.condition, inCatchTry, scopeId, [], parallelGroup, node);
      addTaint(targetNames, findDepSteps(node.condition));
      ws.scopeSeq += 1;
      visit(node.whenTrue, inCatchTry, ws.scopeSeq, targetNames, parallelGroup, node);
      ws.scopeSeq += 1;
      visit(node.whenFalse, inCatchTry, ws.scopeSeq, targetNames, parallelGroup, node);
      return;
    }

    if (isLoopStatement(node)) {
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        visit(node.expression, inCatchTry, scopeId, [], parallelGroup, node);
        const iterDeps = findDepSteps(node.expression);
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const d of node.initializer.declarations) addTaint(collectBindingNames(d.name), iterDeps);
        }
        ws.scopeSeq += 1;
        visit(node.statement, inCatchTry, ws.scopeSeq, [], parallelGroup, node);
        return;
      }
      ws.scopeSeq += 1;
      const loopScope = ws.scopeSeq;
      ts.forEachChild(node, (child) => visit(child, inCatchTry, loopScope, [], parallelGroup, node));
      return;
    }

    if (ts.isSwitchStatement(node)) {
      visit(node.expression, inCatchTry, scopeId, [], parallelGroup, node);
      for (const clause of node.caseBlock.clauses) {
        ws.scopeSeq += 1;
        const clauseScope = ws.scopeSeq;
        for (const stmt of clause.statements) visit(stmt, inCatchTry, clauseScope, [], parallelGroup, clause);
      }
      return;
    }

    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, Boolean(node.catchClause) || inCatchTry, scopeId, [], parallelGroup, node);
      if (node.finallyBlock) {
        ws.scopeSeq += 1;
        visit(node.finallyBlock, inCatchTry, ws.scopeSeq, [], parallelGroup, node);
      }
      return;
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const names = collectBindingNames(node.name);
      addTaint(names, findDepSteps(node.initializer));
      visit(node.initializer, inCatchTry, scopeId, names, parallelGroup, node);
      return;
    }

    if (ts.isBinaryExpression(node)) {
      if (isAssignmentOp(node.operatorToken.kind)) {
        const lhsTargets = collectAssignmentTargets(node.left);
        addTaint(lhsTargets, findDepSteps(node.right));
        visit(node.right, inCatchTry, scopeId, lhsTargets, parallelGroup, node);
        return;
      }
      if (isShortCircuitOp(node.operatorToken.kind)) {
        visit(node.left, inCatchTry, scopeId, targetNames, parallelGroup, node);
        ws.scopeSeq += 1;
        visit(node.right, inCatchTry, ws.scopeSeq, targetNames, parallelGroup, node);
        return;
      }
    }

    if (ts.isAwaitExpression(node)) {
      const inner = node.expression;
      if (ts.isCallExpression(inner) && isPromiseAllCall(inner)) {
        ws.parallelSeq += 1;
        const grp = ws.parallelSeq;
        for (const arg of inner.arguments) visit(arg, inCatchTry, scopeId, targetNames, grp, inner);
        return;
      }
      if (ts.isCallExpression(inner)) {
        const fn = callNameOf(inner.expression);
        const depSteps = findDepSteps(inner);
        if (fn === "notify" && inner.arguments.length >= 2) {
          const labelArg = inner.arguments[0];
          const label = labelArg && ts.isStringLiteral(labelArg) ? labelArg.text : "notify";
          const idx = pushStep(`notify(${label})`, "notify", "async_push", lineOf(sf, inner), true, scopeId, parallelGroup, label, depSteps);
          addTaint(targetNames, [idx, ...depSteps]);
          return;
        }
        const cls = classifyCall(fn, inner, true);
        if (cls.op !== "call") {
          const firstArg = inner.arguments[0];
          const target = firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : undefined;
          const idx = pushStep(fn || "await", cls.op, cls.lane, lineOf(sf, inner), inCatchTry, scopeId, parallelGroup, target, depSteps);
          addTaint(targetNames, [idx, ...depSteps]);
          if (cls.op === "span") {
            for (const arg of inner.arguments) {
              if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) visit(arg.body, inCatchTry, scopeId, [], parallelGroup, arg);
            }
          }
          return;
        }
        addTaint(targetNames, depSteps);
        return;
      }
    }

    if (ts.isCallExpression(node)) {
      const awaited = parent !== undefined && ts.isAwaitExpression(parent);
      const resKind = responseStatusKind(node, awaited);
      if (resKind === "error") return;
      if (resKind === "success") {
        pushStep("res.send", "response_send", "client", lineOf(sf, node), inCatchTry, scopeId, parallelGroup);
        ws.responseSent = true;
        return;
      }
      const fn = callNameOf(node.expression);
      const cls = classifyCall(fn, node, awaited);
      if (cls.op === "cache_del" || cls.op === "cache_read" || cls.op === "async_enqueue") {
        pushStep(fn, cls.op, cls.lane, lineOf(sf, node), inCatchTry, scopeId, parallelGroup);
        return;
      }
      if (cls.op === "span") {
        const firstArg = node.arguments[0];
        const spanName = firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : fn;
        pushStep(spanName, "span", "handler", lineOf(sf, node), inCatchTry, scopeId, parallelGroup, spanName);
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) visit(arg.body, inCatchTry, scopeId, [], parallelGroup, arg);
        }
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, inCatchTry, scopeId, targetNames, parallelGroup, node));
  };

  visit(body, false, 1, []);
  return ws.steps;
}
