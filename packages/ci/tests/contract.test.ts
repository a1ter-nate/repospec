import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { defineCi, evaluateCiGates } from "@repospec/ci";
import type { RepoSpecV4 } from "@repospec/plugin";

class EvalGateCmd implements fc.Command<{ runs: number }, { check: (sev: "error" | "warn", pass: boolean) => void }> {
  constructor(readonly sev: "error" | "warn", readonly pass: boolean) {}
  check(): boolean { return true; }
  run(model: { runs: number }, real: { check: (sev: "error" | "warn", pass: boolean) => void }): void {
    model.runs += 1;
    real.check(this.sev, this.pass);
  }
}

describe("@repospec/ci gate evaluation contract (R3 MBT)", () => {
  test("overall ok is false if and only if an error-severity gate fails", () => {
    fc.assert(
      fc.property(
        fc.commands(
          [fc.tuple(fc.constantFrom<"error" | "warn">("error", "warn"), fc.boolean()).map(([s, p]) => new EvalGateCmd(s, p))],
          { maxCommands: 4 },
        ),
        (cmds) => {
          fc.modelRun(
            () => ({
              model: { runs: 0 },
              real: {
                check: (sev, pass) => {
                  const res = evaluateCiGates(
                    { spec: {} as RepoSpecV4, digest: "d" },
                    defineCi({ gates: [{ id: "g", name: "G", severity: sev, evaluate: () => ({ passed: pass, message: "m" }) }] }),
                  );
                  expect(res.ok).toBe(pass || sev !== "error");
                },
              },
            }),
            cmds,
          );
        },
      ),
      { numRuns: 20 },
    );
  });
});
