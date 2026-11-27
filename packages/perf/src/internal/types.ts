export type BigOClass =
  | "O(1)"
  | "O(log n)"
  | "O(n)"
  | "O(n log n)"
  | "O(n^2)"
  | "O(n^2 log n)"
  | "O(n^3)"
  | "O(2^n)";

export type PerfPatternId =
  | "linear-lookup-in-loop"
  | "nested-loop-join"
  | "array-shift-unshift-in-loop"
  | "spread-accumulator-in-reduce"
  | "regex-or-formatter-in-loop"
  | "json-deep-clone-in-loop"
  | "sort-to-find-extremum"
  | "string-concat-in-loop"
  | "serial-await-in-loop"
  | "chained-array-allocations";

export interface PerfAntiPatternFinding {
  readonly patternId: PerfPatternId;
  readonly severity: "high" | "medium" | "low";
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
  readonly currentComplexity: BigOClass;
  readonly targetComplexity: BigOClass;
  readonly summary: string;
  readonly swapTo: string;
  readonly helperRef: string;
}

export interface ComplexityProfile {
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
  readonly timeComplexity: BigOClass;
  readonly spaceComplexity: BigOClass;
  readonly loopDepthMax: number;
  readonly hasSelfRecursion: boolean;
  readonly hasBranchingRecursion: boolean;
  readonly hasSortCall: boolean;
  readonly hasLinearLookupInLoop: boolean;
  readonly recommendation: string | null;
  readonly suggestedPrimitive: string | null;
}

export interface PerfAnalysisBundle {
  readonly scannedFiles: number;
  readonly findings: readonly PerfAntiPatternFinding[];
  readonly profiles: readonly ComplexityProfile[];
  readonly highSeverityCount: number;
  readonly quadraticOrWorseCount: number;
}
