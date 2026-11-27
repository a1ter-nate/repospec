import type { BigOClass, ComplexityProfile, PerfAntiPatternFinding, PerfPatternId } from "./types.ts";

export type PolyglotPerfLanguage = "rust" | "python" | "csharp";

interface BraceBlockContext {
  readonly line: number;
  readonly symbol: string;
  readonly startDepth: number;
  loopDepthMax: number;
  selfCalls: number;
  hasSort: boolean;
  hasHalving: boolean;
  hasLinearInLoop: boolean;
  hasAlloc: boolean;
}

interface LineInspectInput {
  readonly code: string;
  readonly lineNo: number;
  readonly filePath: string;
  readonly symbol: string;
  readonly inLoop: boolean;
  readonly findings: PerfAntiPatternFinding[];
}

interface LinePatternRule {
  readonly requiresLoop: boolean;
  readonly match: RegExp;
  readonly exclude?: RegExp;
  readonly patternId: PerfPatternId;
  readonly severity: "high" | "medium" | "low";
  readonly currentComplexity: BigOClass;
  readonly targetComplexity: BigOClass;
  readonly summary: string;
  readonly swapTo: string;
  readonly helperRef: string;
  readonly marksLinear?: boolean;
}

const RUST_FN_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/;
const CSHARP_FN_RE = /^\s*(?:public|private|protected|internal|static|async|virtual|override|sealed|partial|\s)+[A-Za-z0-9_<>,?[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/;
const PYTHON_FN_RE = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

const RUST_LOOP_RE = /\b(?:for|while)\b|\bloop\s*\{|\.(?:iter|into_iter|iter_mut)\(\)\.(?:for_each|map|filter|fold)\(/;
const CSHARP_LOOP_RE = /\b(?:for|foreach|while|do)\s*\(|\.(?:ForEach|Select|Where)\(/;
const PYTHON_LOOP_RE = /^\s*(?:async\s+)?(?:for|while)\b/;
const HALVING_RE = />>=\s*1|\/=\s*2|\/\/=\s*2|>>\s*1|\/\s*2|\/\/\s*2/;

const RUST_RULES: readonly LinePatternRule[] = [
  {
    requiresLoop: true,
    match: /\.(?:contains|position|find|any)\(/,
    exclude: /\.contains\(\s*(?:"|'|r#")|\b(?:set|map|seen|visited|cache|index)\b/i,
    patternId: "linear-lookup-in-loop",
    severity: "high",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Linear slice/Vec scan inside Rust loop.",
    swapTo: "Pre-index into std::collections::HashSet or HashMap for O(1) lookup.",
    helperRef: "std::collections::HashSet",
    marksLinear: true,
  },
  {
    requiresLoop: true,
    match: /\.(?:remove|insert)\(\s*0\b/,
    patternId: "array-shift-unshift-in-loop",
    severity: "high",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Vec::remove(0) / Vec::insert(0, ...) inside loop shifts every remaining element.",
    swapTo: "Swap Vec to std::collections::VecDeque for O(1) pop_front() / push_front().",
    helperRef: "std::collections::VecDeque",
  },
  {
    requiresLoop: true,
    match: /\b(?:Regex|RegexBuilder)::new\(/,
    patternId: "regex-or-formatter-in-loop",
    severity: "medium",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Compiling Regex::new(...) inside Rust loop.",
    swapTo: "Hoist compiled Regex into std::sync::LazyLock or OnceLock.",
    helperRef: "std::sync::LazyLock",
  },
  {
    requiresLoop: true,
    match: /serde_json::from_str\s*\(\s*&?\s*serde_json::to_string/,
    patternId: "json-deep-clone-in-loop",
    severity: "medium",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "JSON round-trip deep clone inside Rust loop.",
    swapTo: "Derive Clone or borrow slices (&T) instead of serializing/deserializing in a loop.",
    helperRef: "std::clone::Clone",
  },
  {
    requiresLoop: true,
    match: /\.await\b/,
    patternId: "serial-await-in-loop",
    severity: "medium",
    currentComplexity: "O(n)",
    targetComplexity: "O(1)",
    summary: "Sequential .await inside Rust loop serializes async I/O latency.",
    swapTo: "Batch independent futures with futures::stream::iter(...).buffer_unordered(N) or tokio::task::JoinSet.",
    helperRef: "tokio::task::JoinSet",
  },
  {
    requiresLoop: false,
    match: /\.sort(?:_by|_unstable|_unstable_by)?\([^)]*\)\s*;?\s*.*(?:\[0\]|\.first\(|\.last\(|\.truncate\()/,
    patternId: "sort-to-find-extremum",
    severity: "medium",
    currentComplexity: "O(n log n)",
    targetComplexity: "O(n)",
    summary: "Full .sort() used only to extract min/max or top-k items.",
    swapTo: "Use .iter().min()/max() (O(n)) or std::collections::BinaryHeap (O(n log k)).",
    helperRef: "std::collections::BinaryHeap",
  },
];

const CSHARP_RULES: readonly LinePatternRule[] = [
  {
    requiresLoop: true,
    match: /\.(?:Contains|IndexOf|Find|FindIndex|FirstOrDefault|Any)\(/,
    exclude: /\.(?:Contains|IndexOf)\(\s*(?:"|'|@")|\b(?:set|dict|map|hash|cache)\b/i,
    patternId: "linear-lookup-in-loop",
    severity: "high",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Linear List/LINQ scan inside C# loop.",
    swapTo: "Pre-index into HashSet<T> or Dictionary<TKey, TValue> for O(1) lookup.",
    helperRef: "System.Collections.Generic.HashSet",
    marksLinear: true,
  },
  {
    requiresLoop: true,
    match: /\.(?:RemoveAt|Insert)\(\s*0\b/,
    patternId: "array-shift-unshift-in-loop",
    severity: "high",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "List.RemoveAt(0) / Insert(0, ...) inside loop shifts remaining elements.",
    swapTo: "Swap to Queue<T> or LinkedList<T> for O(1) head operations.",
    helperRef: "System.Collections.Generic.Queue",
  },
  {
    requiresLoop: true,
    match: /\bnew\s+Regex\s*\(/,
    patternId: "regex-or-formatter-in-loop",
    severity: "medium",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Constructing new Regex(...) inside C# loop.",
    swapTo: "Hoist as static readonly Regex or use [GeneratedRegex].",
    helperRef: "GeneratedRegexAttribute",
  },
  {
    requiresLoop: true,
    match: /\+=\s*(?:"|\$"|@")/,
    patternId: "string-concat-in-loop",
    severity: "low",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "String += concatenation inside C# loop.",
    swapTo: "Accumulate into System.Text.StringBuilder.",
    helperRef: "System.Text.StringBuilder",
  },
  {
    requiresLoop: true,
    match: /\bawait\s+/,
    patternId: "serial-await-in-loop",
    severity: "medium",
    currentComplexity: "O(n)",
    targetComplexity: "O(1)",
    summary: "Sequential await inside C# loop.",
    swapTo: "Use Parallel.ForEachAsync with MaxDegreeOfParallelism or bounded SemaphoreSlim.",
    helperRef: "Parallel.ForEachAsync",
  },
  {
    requiresLoop: false,
    match: /\.OrderBy(?:Descending)?\([^)]*\)\.(?:First|FirstOrDefault|Last|Take)\(/,
    patternId: "sort-to-find-extremum",
    severity: "medium",
    currentComplexity: "O(n log n)",
    targetComplexity: "O(n)",
    summary: "LINQ OrderBy().First()/Take() sorts the full sequence for extremum/top-k.",
    swapTo: "Use MinBy()/MaxBy() (O(n)) or PriorityQueue<TElement, TPriority> (O(n log k)).",
    helperRef: "System.Collections.Generic.PriorityQueue",
  },
];

const PYTHON_RULES: readonly LinePatternRule[] = [
  {
    requiresLoop: true,
    match: /\.(?:index|count)\(/,
    exclude: /\b(?:set|dict|map|seen)\b/i,
    patternId: "linear-lookup-in-loop",
    severity: "high",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Linear list .index()/.count() inside Python loop.",
    swapTo: "Pre-index into a dict or set for O(1) lookup.",
    helperRef: "python:set/dict",
    marksLinear: true,
  },
  {
    requiresLoop: true,
    match: /\.(?:pop|insert)\(\s*0\b/,
    patternId: "array-shift-unshift-in-loop",
    severity: "high",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "list.pop(0) / list.insert(0, ...) inside loop shifts every element.",
    swapTo: "Swap list to collections.deque for O(1) popleft() / appendleft().",
    helperRef: "collections.deque",
  },
  {
    requiresLoop: true,
    match: /\bre\.compile\s*\(/,
    patternId: "regex-or-formatter-in-loop",
    severity: "medium",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "re.compile(...) called inside Python loop.",
    swapTo: "Hoist compiled regex pattern to module scope.",
    helperRef: "re.compile",
  },
  {
    requiresLoop: true,
    match: /\bcopy\.deepcopy\s*\(|json\.loads\(\s*json\.dumps\(/,
    patternId: "json-deep-clone-in-loop",
    severity: "medium",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Deep copy inside Python loop.",
    swapTo: "Use shallow copy or hoist immutable inputs outside the loop.",
    helperRef: "copy.copy",
  },
  {
    requiresLoop: true,
    match: /\+=\s*(?:f?"|f?')/,
    patternId: "string-concat-in-loop",
    severity: "low",
    currentComplexity: "O(n^2)",
    targetComplexity: "O(n)",
    summary: "Incremental string += inside Python loop.",
    swapTo: "Append chunks to a list and join once with ''.join(parts).",
    helperRef: "str.join",
  },
  {
    requiresLoop: true,
    match: /\bawait\s+/,
    patternId: "serial-await-in-loop",
    severity: "medium",
    currentComplexity: "O(n)",
    targetComplexity: "O(1)",
    summary: "Sequential await inside Python loop.",
    swapTo: "Batch independent coroutines with asyncio.gather + asyncio.Semaphore(N).",
    helperRef: "asyncio.Semaphore",
  },
  {
    requiresLoop: false,
    match: /\bsorted\([^)]*\)\s*\[/,
    patternId: "sort-to-find-extremum",
    severity: "medium",
    currentComplexity: "O(n log n)",
    targetComplexity: "O(n)",
    summary: "sorted(...)[...] sorts full list to extract extremum or top-k.",
    swapTo: "Use min()/max() (O(n)) or heapq.nlargest()/nsmallest() (O(n log k)).",
    helperRef: "heapq.nlargest",
  },
];

export function detectPolyglotLanguage(filePath: string): PolyglotPerfLanguage | null {
  if (filePath.endsWith(".rs")) return "rust";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".cs")) return "csharp";
  return null;
}

function stripLineComment(rawLine: string, lang: PolyglotPerfLanguage): string {
  const token = lang === "python" ? "#" : "//";
  const idx = rawLine.indexOf(token);
  return idx >= 0 ? rawLine.slice(0, idx) : rawLine;
}

function countBraces(code: string): { readonly open: number; readonly close: number } {
  let open = 0;
  let close = 0;
  let inQuote = "";
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (inQuote) {
      if (ch === "\\" && i + 1 < code.length) i += 1;
      else if (ch === inQuote) inQuote = "";
      continue;
    }
    if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === "{") open += 1;
    else if (ch === "}") close += 1;
  }
  return { open, close };
}

function applyLineRules(input: LineInspectInput, rules: readonly LinePatternRule[]): boolean {
  let linearHit = false;
  for (const rule of rules) {
    if (rule.requiresLoop && !input.inLoop) continue;
    if (!rule.match.test(input.code)) continue;
    if (rule.exclude && rule.exclude.test(input.code)) continue;
    if (rule.marksLinear) linearHit = true;
    input.findings.push({
      patternId: rule.patternId,
      severity: rule.severity,
      file: input.filePath,
      line: input.lineNo,
      symbol: input.symbol,
      currentComplexity: rule.currentComplexity,
      targetComplexity: rule.targetComplexity,
      summary: rule.summary,
      swapTo: rule.swapTo,
      helperRef: rule.helperRef,
    });
  }
  return linearHit;
}

function classifyBraceProfile(block: BraceBlockContext, filePath: string, lang: PolyglotPerfLanguage): ComplexityProfile {
  if (block.symbol.length === 0) throw new Error("classifyBraceProfile requires symbol name");
  const effective = block.loopDepthMax + (block.hasLinearInLoop ? 1 : 0);
  let timeComplexity: BigOClass = "O(1)";
  if (block.selfCalls >= 2) timeComplexity = "O(2^n)";
  else if (block.hasSort) timeComplexity = effective >= 1 ? "O(n^2 log n)" : "O(n log n)";
  else if (effective >= 3) timeComplexity = "O(n^3)";
  else if (effective === 2) timeComplexity = "O(n^2)";
  else if (effective === 1 || block.selfCalls === 1) timeComplexity = block.hasHalving ? "O(log n)" : "O(n)";

  const spaceComplexity: BigOClass = block.hasAlloc || block.selfCalls >= 1 ? "O(n)" : "O(1)";
  const mapHint = lang === "rust" ? "HashMap/HashSet" : lang === "csharp" ? "Dictionary/HashSet" : "dict/set";
  let recommendation: string | null = null;
  let suggestedPrimitive: string | null = null;
  if (timeComplexity === "O(2^n)") {
    recommendation = `Branching recursion in ${lang}; add memoization table (${mapHint}) or bottom-up DP.`;
    suggestedPrimitive = `${lang}:memoization`;
  } else if (timeComplexity === "O(n^3)") {
    recommendation = `Cubic loop nesting in ${lang}; pre-index inner dimensions with ${mapHint}.`;
    suggestedPrimitive = `${lang}:${mapHint}`;
  } else if (timeComplexity === "O(n^2)" || timeComplexity === "O(n^2 log n)") {
    recommendation = `Quadratic hotspot in ${lang}; replace linear inner scans with ${mapHint} or binary search.`;
    suggestedPrimitive = `${lang}:${mapHint}`;
  }
  return {
    file: filePath,
    line: block.line,
    symbol: block.symbol,
    timeComplexity,
    spaceComplexity,
    loopDepthMax: block.loopDepthMax,
    hasSelfRecursion: block.selfCalls >= 1,
    hasBranchingRecursion: block.selfCalls >= 2,
    hasSortCall: block.hasSort,
    hasLinearLookupInLoop: block.hasLinearInLoop,
    recommendation,
    suggestedPrimitive,
  };
}

function updateActiveBlock(block: BraceBlockContext, code: string, curLoopDepth: number, linearHit: boolean): void {
  if (curLoopDepth > block.loopDepthMax) block.loopDepthMax = curLoopDepth;
  if (linearHit) block.hasLinearInLoop = true;
  if (curLoopDepth >= 1 && HALVING_RE.test(code)) block.hasHalving = true;
  if (/\.sort(?:_by|_unstable)?\(|\.OrderBy(?:Descending)?\(|\bsorted\(/.test(code)) block.hasSort = true;
  if (/\b(?:Vec::new|Vec::with_capacity|HashMap::new|HashSet::new|new\s+List|new\s+Dictionary|new\s+HashSet|dict\(|set\(|list\()\b/.test(code)) {
    block.hasAlloc = true;
  }
  const callToken = `${block.symbol}(`;
  if (code.includes(callToken) && !code.includes(`.${callToken}`)) {
    block.selfCalls += Math.max(0, code.split(callToken).length - 1);
  }
}

function scanBraceLanguage(
  sourceText: string,
  filePath: string,
  lang: "rust" | "csharp",
): { readonly findings: readonly PerfAntiPatternFinding[]; readonly profiles: readonly ComplexityProfile[] } {
  if (!sourceText || !filePath) throw new Error("scanBraceLanguage requires sourceText and filePath");
  const lines = sourceText.split("\n");
  const findings: PerfAntiPatternFinding[] = [];
  const profiles: ComplexityProfile[] = [];
  const fnRe = lang === "rust" ? RUST_FN_RE : CSHARP_FN_RE;
  const loopRe = lang === "rust" ? RUST_LOOP_RE : CSHARP_LOOP_RE;
  const rules = lang === "rust" ? RUST_RULES : CSHARP_RULES;

  let braceDepth = 0;
  const loopEndDepths: number[] = [];
  let activeFn: BraceBlockContext | null = null;
  let inCfgTest = false;
  let cfgTestStartDepth = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const code = stripLineComment(lines[i] ?? "", lang);
    if (lang === "rust" && /#\[cfg\(test\)\]/.test(code)) {
      inCfgTest = true;
      cfgTestStartDepth = braceDepth;
    }
    const { open, close } = countBraces(code);
    if (!inCfgTest) {
      const fnMatch = code.match(fnRe);
      if (fnMatch?.[1] && !activeFn && !/^\s*(?:if|for|while|switch|catch|match)\b/.test(code)) {
        activeFn = { line: lineNo, symbol: fnMatch[1], startDepth: braceDepth, loopDepthMax: 0, selfCalls: 0, hasSort: false, hasHalving: false, hasLinearInLoop: false, hasAlloc: false };
      }
      const entersLoop = loopRe.test(code);
      if (entersLoop && open > 0) loopEndDepths.push(braceDepth);
      const curLoopDepth = loopEndDepths.length + (entersLoop && open === 0 ? 1 : 0);
      const linearHit = applyLineRules({ code, lineNo, filePath, symbol: activeFn?.symbol ?? "<module>", inLoop: curLoopDepth >= 1, findings }, rules);
      if (activeFn && lineNo > activeFn.line) updateActiveBlock(activeFn, code, curLoopDepth, linearHit);
    }
    braceDepth = Math.max(0, braceDepth + open - close);
    while (loopEndDepths.length > 0 && (loopEndDepths[loopEndDepths.length - 1] ?? 0) >= braceDepth) loopEndDepths.pop();
    if (activeFn && braceDepth <= activeFn.startDepth && (open > 0 || close > 0)) {
      profiles.push(classifyBraceProfile(activeFn, filePath, lang));
      activeFn = null;
    }
    if (inCfgTest && close > 0 && braceDepth <= cfgTestStartDepth) {
      inCfgTest = false;
      cfgTestStartDepth = -1;
    }
  }
  return { findings, profiles };
}

function scanPythonSource(
  sourceText: string,
  filePath: string,
): { readonly findings: readonly PerfAntiPatternFinding[]; readonly profiles: readonly ComplexityProfile[] } {
  if (!sourceText || !filePath) throw new Error("scanPythonSource requires sourceText and filePath");
  const lines = sourceText.split("\n");
  const findings: PerfAntiPatternFinding[] = [];
  const profiles: ComplexityProfile[] = [];
  const loopIndents: number[] = [];
  let activeFn: BraceBlockContext | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const code = stripLineComment(lines[i] ?? "", "python");
    if (code.trim().length === 0) continue;
    const indent = code.length - code.trimStart().length;

    while (loopIndents.length > 0 && (loopIndents[loopIndents.length - 1] ?? 0) >= indent) loopIndents.pop();
    if (activeFn && indent <= activeFn.startDepth) {
      profiles.push(classifyBraceProfile(activeFn, filePath, "python"));
      activeFn = null;
    }
    const fnMatch = code.match(PYTHON_FN_RE);
    if (fnMatch?.[2]) {
      activeFn = { line: lineNo, symbol: fnMatch[2], startDepth: indent, loopDepthMax: 0, selfCalls: 0, hasSort: false, hasHalving: false, hasLinearInLoop: false, hasAlloc: false };
      continue;
    }
    if (PYTHON_LOOP_RE.test(code)) loopIndents.push(indent);
    const curLoopDepth = loopIndents.length;
    const linearHit = applyLineRules({ code, lineNo, filePath, symbol: activeFn?.symbol ?? "<module>", inLoop: curLoopDepth >= 1, findings }, PYTHON_RULES);
    if (activeFn) updateActiveBlock(activeFn, code, curLoopDepth, linearHit);
  }
  if (activeFn) profiles.push(classifyBraceProfile(activeFn, filePath, "python"));
  return { findings, profiles };
}

export function analyzePolyglotSource(
  sourceText: string,
  filePath: string,
): { readonly findings: readonly PerfAntiPatternFinding[]; readonly profiles: readonly ComplexityProfile[] } {
  const lang = detectPolyglotLanguage(filePath);
  if (!lang || sourceText.length === 0) return { findings: [], profiles: [] };
  if (lang === "python") return scanPythonSource(sourceText, filePath);
  return scanBraceLanguage(sourceText, filePath, lang);
}
