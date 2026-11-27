import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { defineShowMe } from "@repospec/show-me";

const identityComment = (_ctx: unknown, fallback: () => string): string => fallback();

class DefineCmd implements fc.Command<{ count: number }, { check: () => void }> {
  check(): boolean {
    return true;
  }
  run(model: { count: number }, real: { check: () => void }): void {
    model.count += 1;
    real.check();
  }
}

describe("@repospec/show-me hook contract (R3 MBT)", () => {
  test("defineShowMe preserves identity of custom hooks across calls", () => {
    fc.assert(
      fc.property(fc.commands([fc.constant(new DefineCmd())], { maxCommands: 4 }), (cmds) => {
        fc.modelRun(
          () => ({
            model: { count: 0 },
            real: {
              check: () => {
                const def = defineShowMe({ formatComment: identityComment });
                expect(def.formatComment).toBe(identityComment);
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
