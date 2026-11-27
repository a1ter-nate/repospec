import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { diffFactSets, type FactRecord } from "@repospec/plugin";

function toFacts(keys: string[]): FactRecord[] {
  return Array.from(new Set(keys)).map((k) => ({
    extractorId: "p",
    kind: "k",
    key: k,
    file: "a.ts",
    line: 1,
    unit: "u",
    payload: {},
  }));
}

class CheckDiffCmd implements fc.Command<{ seen: number }, { run: (keys: string[]) => void }> {
  constructor(readonly keys: string[]) {}
  check(): boolean {
    return true;
  }
  run(model: { seen: number }, real: { run: (keys: string[]) => void }): void {
    model.seen += 1;
    real.run(this.keys);
  }
}

describe("@repospec/plugin diffFactSets contract (R3 MBT)", () => {
  test("diffFactSets is reflexive (empty delta on identical sets) and symmetric on add/remove counts", () => {
    fc.assert(
      fc.property(
        fc.commands([fc.array(fc.stringMatching(/^[a-z]{1,4}$/), { maxLength: 6 }).map((k) => new CheckDiffCmd(k))], {
          maxCommands: 4,
        }),
        (cmds) => {
          fc.modelRun(
            () => ({
              model: { seen: 0 },
              real: {
                run: (keys) => {
                  const fsList = toFacts(keys);
                  const d = diffFactSets(fsList, fsList, "k");
                  expect(d.added.length).toBe(0);
                  expect(d.removed.length).toBe(0);
                  expect(d.unchangedCount).toBe(fsList.length);
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
