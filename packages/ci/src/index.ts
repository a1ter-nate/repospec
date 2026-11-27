import type { RepoSpecV4 } from "@repospec/plugin";

export interface CiGateContext {
  readonly spec: RepoSpecV4;
  readonly digest: string;
}

export interface CiGateOutcome {
  readonly passed: boolean;
  readonly message: string;
  readonly items?: readonly string[];
}

export interface CiGate {
  readonly id: string;
  readonly name: string;
  readonly severity: "error" | "warn";
  readonly evaluate: (ctx: CiGateContext) => CiGateOutcome;
}

export interface CiGateResult {
  readonly id: string;
  readonly name: string;
  readonly severity: "error" | "warn";
  readonly passed: boolean;
  readonly message: string;
  readonly items: readonly string[];
}

export interface CiDefinition {
  readonly gates?: readonly CiGate[];
  readonly format?: (summary: { ok: boolean; results: readonly CiGateResult[] }) => string;
}

export const defaultCi: CiDefinition = {
  gates: [],
};

export function defineCi(def: CiDefinition): CiDefinition {
  return def;
}

export function evaluateCiGates(
  ctx: CiGateContext,
  def?: CiDefinition | null,
): { ok: boolean; results: CiGateResult[] } {
  const gates = def?.gates ?? [];
  const results: CiGateResult[] = gates.map((g) => {
    const out = g.evaluate(ctx);
    return {
      id: g.id,
      name: g.name,
      severity: g.severity,
      passed: out.passed,
      message: out.message,
      items: out.items ?? [],
    };
  });
  const ok = results.every((r) => r.passed || r.severity !== "error");
  return { ok, results };
}

export function formatCiReport(
  summary: { ok: boolean; results: readonly CiGateResult[] },
  def?: CiDefinition | null,
): string {
  if (def?.format) return def.format(summary);
  if (summary.results.length === 0) return "No custom CI gates configured.";
  return summary.results
    .map((r) => `${r.passed ? "PASS" : r.severity.toUpperCase()} [${r.id}] ${r.name}: ${r.message}`)
    .join("\n");
}

export function renderGithubShowMeWorkflow(opts?: {
  rank?: "risk" | "hotspot" | "contract" | "blast";
  top?: number;
}): string {
  const rank = opts?.rank ?? "risk";
  const top = opts?.top ?? 3;
  return `name: RepoSpec Show-Me

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  show-me:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 50
          persist-credentials: false
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: latest
      - env:
          BASE_REF: \${{ github.base_ref }}
        run: |
          git fetch --no-tags --depth=50 origin "$BASE_REF"
          bunx repospec@latest show-me . "origin/\${BASE_REF}..HEAD" --out .repospec-show-me --top ${top} --rank ${rank} --format both --focus auto --theme auto
`;
}
