import ts from "typescript";
import { analyzePolyglotSource, detectPolyglotLanguage } from "./polyglotPerfScanner.ts";
import type { BigOClass, ComplexityProfile } from "./types.ts";

const LINEAR_METHODS = new Set(["includes", "indexOf", "lastIndexOf", "find", "findIndex", "some"]);
const LOOP_CALLBACK_METHODS = new Set(["forEach", "map", "filter", "reduce", "reduceRight", "flatMap", "some", "every"]);
const ALLOC_METHODS = new Set(["map", "filter", "flatMap", "slice", "concat", "from"]);

function assertAdvisor(condition: boolean, message: string): void {
  if (!condition) throw new Error(`@repospec/perf complexity advisor invariant failed: ${message}`);
}

function isLoopNode(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

function isHalvingUpdate(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  const kind = node.operatorToken.kind;
  if (kind === ts.SyntaxKind.SlashEqualsToken || kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken) return true;
  if ((kind === ts.SyntaxKind.GreaterThanGreaterThanToken || kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) && ts.isNumericLiteral(node.right) && node.right.text === "1") return true;
  return kind === ts.SyntaxKind.SlashToken && ts.isNumericLiteral(node.right) && node.right.text === "2";
}

interface FunctionCandidate {
  readonly name: string;
  readonly line: number;
  readonly body: ts.Node;
}

interface ScanCounters {
  loopDepthMax: number;
  selfCallCount: number;
  hasMemoRef: boolean;
  hasHalvingLoop: boolean;
  hasSortCall: boolean;
  hasLinearLookupInLoop: boolean;
  allocDepthMax: number;
  hasAnyAlloc: boolean;
}

function collectFunctionCandidates(sf: ts.SourceFile): FunctionCandidate[] {
  const candidates: FunctionCandidate[] = [];
  const stack: ts.Node[] = [sf];
  let steps = 0;
  const stepLimit = 100_000;
  while (stack.length > 0 && steps < stepLimit) {
    steps += 1;
    const node = stack.pop();
    if (!node) break;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      candidates.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, body: node.body });
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      candidates.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, body: node.body });
    } else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      candidates.push({ name: node.parent.name.text, line: sf.getLineAndCharacterOfPosition(node.parent.getStart(sf)).line + 1, body: node.body });
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (c) => {
      children.push(c);
    });
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
  return candidates;
}

function classifyComplexity(metrics: ScanCounters): {
  readonly timeComplexity: BigOClass;
  readonly spaceComplexity: BigOClass;
  readonly recommendation: string | null;
  readonly suggestedPrimitive: string | null;
} {
  if (metrics.loopDepthMax < 0) throw new Error("loopDepthMax must be non-negative");
  const effectiveDepth = metrics.loopDepthMax + (metrics.hasLinearLookupInLoop ? 1 : 0);
  let timeComplexity: BigOClass = "O(1)";
  if (metrics.selfCallCount >= 2 && !metrics.hasMemoRef) timeComplexity = "O(2^n)";
  else if (metrics.hasSortCall) timeComplexity = effectiveDepth >= 1 ? "O(n^2 log n)" : "O(n log n)";
  else if (effectiveDepth >= 3) timeComplexity = "O(n^3)";
  else if (effectiveDepth === 2) timeComplexity = "O(n^2)";
  else if (effectiveDepth === 1 || metrics.selfCallCount === 1) timeComplexity = metrics.hasHalvingLoop ? "O(log n)" : "O(n)";

  let spaceComplexity: BigOClass = "O(1)";
  if (metrics.allocDepthMax >= 2) spaceComplexity = "O(n^2)";
  else if (metrics.hasAnyAlloc || metrics.selfCallCount >= 1) spaceComplexity = "O(n)";

  let recommendation: string | null = null;
  let suggestedPrimitive: string | null = null;
  if (timeComplexity === "O(2^n)") {
    recommendation = "Branching recursion without memoization is exponential; wrap with memoize() or rewrite as bottom-up DP.";
    suggestedPrimitive = "@repospec/perf/algorithms#memoize";
  } else if (timeComplexity === "O(n^3)") {
    recommendation = "Cubic loop nesting detected; pre-index inner dimensions with Map/Set, prefixSums(), or hashJoin().";
    suggestedPrimitive = "@repospec/perf/algorithms#hashJoin";
  } else if (timeComplexity === "O(n^2)" || timeComplexity === "O(n^2 log n)") {
    recommendation = metrics.hasLinearLookupInLoop
      ? "Quadratic lookup inside loop; pre-index into Set/Map or hashJoin() for O(n) total work."
      : "Quadratic loop nesting detected; consider hashJoin(), prefixSums(), binarySearch(), or UnionFind.";
    suggestedPrimitive = metrics.hasLinearLookupInLoop ? "@repospec/perf/algorithms#hashJoin" : "@repospec/perf/algorithms#binarySearch";
  }
  return { timeComplexity, spaceComplexity, recommendation, suggestedPrimitive };
}

function updateCountersForNode(node: ts.Node, depth: number, fnName: string, counters: ScanCounters): boolean {
  if (depth < 0) throw new Error("depth must be non-negative");
  if (depth > counters.loopDepthMax) counters.loopDepthMax = depth;
  if (depth >= 1 && isHalvingUpdate(node)) counters.hasHalvingLoop = true;
  if (ts.isIdentifier(node) && /memo|cache|dp/i.test(node.text)) counters.hasMemoRef = true;
  if (ts.isNewExpression(node)) {
    const ctor = node.expression.getText();
    if (ctor === "Map" || ctor === "Set" || ctor === "Array" || ctor.endsWith("Array")) {
      counters.hasAnyAlloc = true;
      if (depth > counters.allocDepthMax) counters.allocDepthMax = depth;
    }
  }
  if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) {
    counters.hasAnyAlloc = true;
    if (depth > counters.allocDepthMax) counters.allocDepthMax = depth;
  }
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression) && node.expression.text === fnName) {
    counters.selfCallCount += 1;
    return false;
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const m = node.expression.name.text;
  if (m === fnName && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) counters.selfCallCount += 1;
  if (m === "sort") counters.hasSortCall = true;
  if (depth >= 1 && LINEAR_METHODS.has(m)) counters.hasLinearLookupInLoop = true;
  if (ALLOC_METHODS.has(m) || m === "push") {
    counters.hasAnyAlloc = true;
    if (depth > counters.allocDepthMax) counters.allocDepthMax = depth;
  }
  return LOOP_CALLBACK_METHODS.has(m);
}

function analyzeSingleFunction(candidate: FunctionCandidate, filePath: string): ComplexityProfile {
  if (candidate.name.length === 0) throw new Error("analyzeSingleFunction requires named candidate");
  const counters: ScanCounters = {
    loopDepthMax: 0,
    selfCallCount: 0,
    hasMemoRef: false,
    hasHalvingLoop: false,
    hasSortCall: false,
    hasLinearLookupInLoop: false,
    allocDepthMax: 0,
    hasAnyAlloc: false,
  };
  const stack: Array<{ readonly node: ts.Node; readonly depth: number }> = [{ node: candidate.body, depth: 0 }];
  let steps = 0;
  const stepLimit = 50_000;

  while (stack.length > 0 && steps < stepLimit) {
    steps += 1;
    const frame = stack.pop();
    if (!frame) break;
    const isHoLoop = updateCountersForNode(frame.node, frame.depth, candidate.name, counters);
    const children: ts.Node[] = [];
    ts.forEachChild(frame.node, (c) => {
      if (ts.isFunctionDeclaration(c) || ts.isMethodDeclaration(c)) return;
      if ((ts.isArrowFunction(c) || ts.isFunctionExpression(c)) && !isHoLoop) return;
      children.push(c);
    });
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (!child) continue;
      const nextDepth = isLoopNode(frame.node) || (isHoLoop && (ts.isArrowFunction(child) || ts.isFunctionExpression(child))) ? frame.depth + 1 : frame.depth;
      stack.push({ node: child, depth: nextDepth });
    }
  }

  const classified = classifyComplexity(counters);
  return {
    file: filePath,
    line: candidate.line,
    symbol: candidate.name,
    timeComplexity: classified.timeComplexity,
    spaceComplexity: classified.spaceComplexity,
    loopDepthMax: counters.loopDepthMax,
    hasSelfRecursion: counters.selfCallCount >= 1,
    hasBranchingRecursion: counters.selfCallCount >= 2 && !counters.hasMemoRef,
    hasSortCall: counters.hasSortCall,
    hasLinearLookupInLoop: counters.hasLinearLookupInLoop,
    recommendation: classified.recommendation,
    suggestedPrimitive: classified.suggestedPrimitive,
  };
}

export function analyzeComplexityProfile(
  sourceText: string,
  filePath = "inline.ts",
): readonly ComplexityProfile[] {
  assertAdvisor(typeof sourceText === "string" && filePath.length > 0, "analyzeComplexityProfile requires sourceText and filePath");
  if (detectPolyglotLanguage(filePath) !== null) return analyzePolyglotSource(sourceText, filePath).profiles;
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  return collectFunctionCandidates(sf)
    .map((c) => analyzeSingleFunction(c, filePath))
    .sort((a, b) => a.line - b.line || a.symbol.localeCompare(b.symbol));
}
