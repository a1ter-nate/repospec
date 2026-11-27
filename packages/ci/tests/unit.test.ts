import { describe, expect, test } from "bun:test";
import { defineCi, evaluateCiGates, formatCiReport, renderGithubShowMeWorkflow } from "@repospec/ci";
import type { RepoSpecV4 } from "@repospec/plugin";

describe("@repospec/ci unit invariants (R2)", () => {
  test("evaluates error vs warn severity gates and formats workflow YAML", () => {
    const def = defineCi({
      gates: [
        { id: "g.warn", name: "Warn Gate", severity: "warn", evaluate: () => ({ passed: false, message: "advisory" }) },
        { id: "g.ok", name: "Pass Gate", severity: "error", evaluate: () => ({ passed: true, message: "clean" }) },
      ],
    });
    const res = evaluateCiGates({ spec: {} as RepoSpecV4, digest: "abc" }, def);
    expect(res.ok).toBe(true);
    expect(formatCiReport(res, def)).toContain("WARN [g.warn]");
    expect(renderGithubShowMeWorkflow({ top: 4 })).toContain("--top 4");
  });
});
