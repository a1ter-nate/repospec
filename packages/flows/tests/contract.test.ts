import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { buildFlowAnalysisFromFacts } from "@repospec/flows";

class AnalyzeCmd implements fc.Command<{ calls: number }, { run: () => void }> {
  check(): boolean { return true; }
  run(model: { calls: number }, real: { run: () => void }): void {
    model.calls += 1;
    real.run();
  }
}

describe("@repospec/flows deterministic projection contract (R3 MBT)", () => {
  test("buildFlowAnalysisFromFacts is deterministic across repeated calls", () => {
    fc.assert(
      fc.property(fc.commands([fc.constant(new AnalyzeCmd())], { maxCommands: 4 }), (cmds) => {
        fc.modelRun(
          () => ({
            model: { calls: 0 },
            real: {
              run: () => {
                const a = buildFlowAnalysisFromFacts([]);
                const b = buildFlowAnalysisFromFacts([]);
                expect(a).toEqual(b);
              },
            },
          }),
          cmds,
        );
      }),
      { numRuns: 10 },
    );
  });
});
