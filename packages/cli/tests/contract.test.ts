import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { buildPluginOperations } from "@repospec/cli";

class ParseOpsCmd implements fc.Command<{ count: number }, { verify: (adds: string[], rems: string[]) => void }> {
  constructor(readonly adds: string[], readonly rems: string[]) {}
  check(): boolean { return true; }
  run(model: { count: number }, real: { verify: (adds: string[], rems: string[]) => void }): void {
    model.count += 1;
    real.verify(this.adds, this.rems);
  }
}

describe("@repospec/cli option parser contract (R3 MBT)", () => {
  test("buildPluginOperations preserves exact add-before-remove ordering", () => {
    fc.assert(
      fc.property(
        fc.commands(
          [
            fc
              .tuple(
                fc.array(fc.stringMatching(/^[a-z]{2,6}$/), { maxLength: 3 }),
                fc.array(fc.stringMatching(/^[a-z]{2,6}$/), { maxLength: 3 }),
              )
              .map(([a, r]) => new ParseOpsCmd(a, r)),
          ],
          { maxCommands: 4 },
        ),
        (cmds) => {
          fc.modelRun(
            () => ({
              model: { count: 0 },
              real: {
                verify: (adds, rems) => {
                  const ops = buildPluginOperations(adds.join(","), rems.join(","));
                  expect(ops.length).toBe(adds.length + rems.length);
                  expect(ops.slice(0, adds.length).every((o) => o.type === "add")).toBe(true);
                  expect(ops.slice(adds.length).every((o) => o.type === "remove")).toBe(true);
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
