import ts from "typescript";
import { analyzePolyglotSource, detectPolyglotLanguage } from "./polyglotPerfScanner.ts";
import type { PerfAntiPatternFinding } from "./types.ts";

const LINEAR_LOOKUP_METHODS = new Set(["includes", "indexOf", "lastIndexOf", "find", "findIndex", "some"]);
const HIGHER_ORDER_LOOPS = new Set(["forEach", "map", "filter", "reduce", "reduceRight", "flatMap", "some", "every"]);
const CHAINABLE_ARRAY_METHODS = new Set(["map", "filter", "flatMap", "slice", "concat"]);
const INTL_CONSTRUCTORS = new Set(["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat"]);
const STRING_METHODS = new Set(["slice", "substring", "trim", "toLowerCase", "toUpperCase", "replace", "padStart", "padEnd", "repeat", "join"]);

interface WalkFrame {
  readonly node: ts.Node;
  readonly loopDepth: number;
  readonly inReduceCallback: boolean;
  readonly symbolName: string;
}

interface InspectContext {
  readonly sf: ts.SourceFile;
  readonly file: string;
  readonly findings: PerfAntiPatternFinding[];
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

function resolveSymbolName(node: ts.Node, fallback: string): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return fallback;
}

function lineOfNode(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function isStringExpression(expr: ts.Expression): boolean {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isTemplateExpression(expr)) return true;
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    return STRING_METHODS.has(expr.expression.name.text);
  }
  return false;
}

function isLikelyStringLookup(methodName: string, call: ts.CallExpression, recvText: string): boolean {
  if (methodName !== "includes" && methodName !== "indexOf" && methodName !== "lastIndexOf") return false;
  const firstArg = call.arguments[0];
  if (firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) return true;
  if (methodName === "includes" && call.arguments.length >= 2) return true;
  return /\bas\s+string\b|String\(|\.toLowerCase\(\)|\.toUpperCase\(\)|\.trim\(\)|\.toString\(\)/.test(recvText);
}

function countArrayChainLength(call: ts.CallExpression): number {
  let depth = 0;
  let cur: ts.Expression = call;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    if (!CHAINABLE_ARRAY_METHODS.has(cur.expression.name.text)) break;
    depth += 1;
    cur = cur.expression.expression;
  }
  return depth;
}

function inspectLoopCall(
  ctx: InspectContext,
  frame: WalkFrame,
  call: ts.CallExpression,
  prop: ts.PropertyAccessExpression,
): void {
  if (!ctx.file) throw new Error("inspectLoopCall requires file path");
  const line = lineOfNode(ctx.sf, call);
  const methodName = prop.name.text;
  const recvText = prop.expression.getText(ctx.sf);
  if (LINEAR_LOOKUP_METHODS.has(methodName) && !recvText.startsWith("Set") && !recvText.startsWith("Map") && !isLikelyStringLookup(methodName, call, recvText)) {
    ctx.findings.push({
      patternId: "linear-lookup-in-loop",
      severity: "high",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n^2)",
      targetComplexity: "O(n)",
      summary: `Linear .${methodName}() scan inside loop in ${frame.symbolName}.`,
      swapTo: "Pre-index into a Set/Map for O(1) lookups or use hashJoin() from @repospec/perf/algorithms.",
      helperRef: "@repospec/perf/algorithms#hashJoin",
    });
  }
  if (methodName === "shift" || methodName === "unshift") {
    ctx.findings.push({
      patternId: "array-shift-unshift-in-loop",
      severity: "high",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n^2)",
      targetComplexity: "O(n)",
      summary: `Array.${methodName}() inside loop re-indexes remaining elements each iteration.`,
      swapTo: "Swap to RingBufferDeque from @repospec/perf/data-structures for O(1) amortized pushFront/popFront.",
      helperRef: "@repospec/perf/data-structures#RingBufferDeque",
    });
  }
  if (methodName === "parse" && recvText === "JSON") {
    const firstArg = call.arguments[0];
    if (firstArg && ts.isCallExpression(firstArg) && firstArg.expression.getText(ctx.sf) === "JSON.stringify") {
      ctx.findings.push({
        patternId: "json-deep-clone-in-loop",
        severity: "medium",
        file: ctx.file,
        line,
        symbol: frame.symbolName,
        currentComplexity: "O(n^2)",
        targetComplexity: "O(n)",
        summary: "JSON.parse(JSON.stringify(...)) deep clone inside loop.",
        swapTo: "Hoist immutable data or use shallow copy / structuredClone outside the hot loop.",
        helperRef: "structuredClone",
      });
    }
  }
}

function inspectCallExpression(ctx: InspectContext, frame: WalkFrame, call: ts.CallExpression): void {
  if (!ctx.file) throw new Error("inspectCallExpression requires file path");
  if (!ts.isPropertyAccessExpression(call.expression)) return;
  const line = lineOfNode(ctx.sf, call);
  const methodName = call.expression.name.text;

  if (frame.loopDepth >= 1) inspectLoopCall(ctx, frame, call, call.expression);

  if (methodName === "sort" && (ts.isElementAccessExpression(call.parent) || (ts.isPropertyAccessExpression(call.parent) && call.parent.name.text === "slice"))) {
    ctx.findings.push({
      patternId: "sort-to-find-extremum",
      severity: "medium",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n log n)",
      targetComplexity: "O(n)",
      summary: "Full .sort() used only to read top-1 or top-k elements.",
      swapTo: "Swap to a single-pass scan for min/max (O(n)) or topK()/BinaryHeap from @repospec/perf (O(n log k)).",
      helperRef: "@repospec/perf/algorithms#topK",
    });
  }

  const isOuterChain = !(ts.isPropertyAccessExpression(call.parent) && ts.isCallExpression(call.parent.parent) && CHAINABLE_ARRAY_METHODS.has(call.parent.name.text));
  if (isOuterChain && countArrayChainLength(call) >= 3) {
    ctx.findings.push({
      patternId: "chained-array-allocations",
      severity: "low",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n)",
      targetComplexity: "O(n)",
      summary: "3+ chained array transforms allocate multiple intermediate arrays.",
      swapTo: "Fuse chained .filter()/.map()/.flatMap() steps into a single loop pass to cut heap churn.",
      helperRef: "single-pass-loop",
    });
  }
}

function inspectBinaryNode(ctx: InspectContext, frame: WalkFrame, node: ts.BinaryExpression): void {
  if (!ctx.file) throw new Error("inspectBinaryNode requires file path");
  const line = lineOfNode(ctx.sf, node);
  if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && isStringExpression(node.right)) {
    ctx.findings.push({
      patternId: "string-concat-in-loop",
      severity: "low",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n^2)",
      targetComplexity: "O(n)",
      summary: "Incremental string concatenation (+=) inside loop.",
      swapTo: "Push chunks into a string[] buffer and call .join('') once after the loop.",
      helperRef: "array-join-buffer",
    });
  }
  if (
    frame.loopDepth >= 2 &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
    ts.isPropertyAccessExpression(node.left) &&
    ts.isPropertyAccessExpression(node.right)
  ) {
    ctx.findings.push({
      patternId: "nested-loop-join",
      severity: "high",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n^2)",
      targetComplexity: "O(n)",
      summary: "Nested-loop equality join detected across two property keys.",
      swapTo: "Swap to hashJoin() from @repospec/perf/algorithms or pre-index the inner collection in a Map.",
      helperRef: "@repospec/perf/algorithms#hashJoin",
    });
  }
}

function inspectMiscNode(ctx: InspectContext, frame: WalkFrame): void {
  if (!ctx.file) throw new Error("inspectMiscNode requires file path");
  const { node } = frame;
  const line = lineOfNode(ctx.sf, node);

  if (frame.loopDepth >= 1 && ts.isNewExpression(node)) {
    const exprText = node.expression.getText(ctx.sf);
    const isIntl = exprText.startsWith("Intl.") && INTL_CONSTRUCTORS.has(exprText.slice(5));
    if (exprText === "RegExp" || isIntl) {
      ctx.findings.push({
        patternId: "regex-or-formatter-in-loop",
        severity: "medium",
        file: ctx.file,
        line,
        symbol: frame.symbolName,
        currentComplexity: "O(n^2)",
        targetComplexity: "O(n)",
        summary: `Re-compiling ${exprText} inside loop.`,
        swapTo: `Hoist new ${exprText}(...) to module or pre-loop scope.`,
        helperRef: "hoist-invariant",
      });
    }
  }
  if (frame.inReduceCallback && (ts.isSpreadElement(node) || ts.isSpreadAssignment(node))) {
    ctx.findings.push({
      patternId: "spread-accumulator-in-reduce",
      severity: "high",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n^2)",
      targetComplexity: "O(n)",
      summary: "Object/array spread inside .reduce() copies the accumulator on every element.",
      swapTo: "Mutate a freshly allocated Map/Array accumulator in place for O(n) aggregation.",
      helperRef: "in-place-accumulator",
    });
  }
  if (frame.loopDepth >= 1 && ts.isAwaitExpression(node)) {
    ctx.findings.push({
      patternId: "serial-await-in-loop",
      severity: "medium",
      file: ctx.file,
      line,
      symbol: frame.symbolName,
      currentComplexity: "O(n)",
      targetComplexity: "O(1)",
      summary: "Sequential await inside loop serializes independent async I/O latency.",
      swapTo: "Batch independent work with bounded concurrency (Effect.forEach(..., { concurrency: N }) or worker pool).",
      helperRef: "bounded-concurrency",
    });
  }
  if (frame.loopDepth >= 1 && ts.isBinaryExpression(node)) inspectBinaryNode(ctx, frame, node);
}

export function analyzeSourcePerformance(
  sourceText: string,
  filePath = "inline.ts",
): readonly PerfAntiPatternFinding[] {
  if (typeof sourceText !== "string" || filePath.length === 0) throw new Error("analyzeSourcePerformance requires sourceText and filePath");
  if (detectPolyglotLanguage(filePath) !== null) return analyzePolyglotSource(sourceText, filePath).findings;
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const findings: PerfAntiPatternFinding[] = [];
  const ctx: InspectContext = { sf, file: filePath, findings };
  const dedup = new Set<string>();
  const stack: WalkFrame[] = [{ node: sf, loopDepth: 0, inReduceCallback: false, symbolName: "<module>" }];
  let steps = 0;
  const stepLimit = 200_000;

  while (stack.length > 0 && steps < stepLimit) {
    steps += 1;
    const frame = stack.pop();
    if (!frame) break;
    const { node } = frame;
    const beforeCount = findings.length;
    if (ts.isCallExpression(node)) inspectCallExpression(ctx, frame, node);
    else inspectMiscNode(ctx, frame);

    for (let i = beforeCount; i < findings.length; i += 1) {
      const f = findings[i];
      if (!f) continue;
      const key = `${f.patternId}|${f.file}|${f.line}`;
      if (dedup.has(key)) {
        findings.splice(i, 1);
        i -= 1;
      } else {
        dedup.add(key);
      }
    }

    const nextSymbol = resolveSymbolName(node, frame.symbolName);
    const isHoLoopCall = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && HIGHER_ORDER_LOOPS.has(node.expression.name.text);
    const isReduceCall = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === "reduce" || node.expression.name.text === "reduceRight");

    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (!child) continue;
      const entersLoop = isLoopStatement(node) || (isHoLoopCall && (ts.isArrowFunction(child) || ts.isFunctionExpression(child)));
      const entersReduce = frame.inReduceCallback || (isReduceCall && (ts.isArrowFunction(child) || ts.isFunctionExpression(child)));
      stack.push({
        node: child,
        loopDepth: entersLoop ? frame.loopDepth + 1 : frame.loopDepth,
        inReduceCallback: entersReduce,
        symbolName: nextSymbol,
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.patternId.localeCompare(b.patternId));
}
