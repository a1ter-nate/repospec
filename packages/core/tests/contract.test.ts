import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createState, type StateInstance } from "@repospec/core";

interface Model { items: string[] }
interface Real {
  state: StateInstance<string[], { add: (v: string) => void }>;
  regs: Array<{ dispose: () => void }>;
}

class AddCmd implements fc.Command<Model, Real> {
  constructor(readonly val: string) {}
  check(): boolean { return true; }
  run(model: Model, real: Real): void {
    const snap = real.state.get();
    const copy = [...snap];
    const reg = real.state.transform((e) => e.add(this.val));
    model.items.push(this.val);
    real.regs.push(reg);
    expect(snap).toEqual(copy);
    expect(real.state.get()).toEqual(model.items);
  }
}

class DisposeCmd implements fc.Command<Model, Real> {
  check(model: Readonly<Model>): boolean { return model.items.length > 0; }
  run(model: Model, real: Real): void {
    model.items.shift();
    real.regs.shift()?.dispose();
    expect(real.state.get()).toEqual(model.items);
  }
}

describe("@repospec/core replayable state contract (R3 MBT)", () => {
  test("State.create satisfies snapshot immutability and replay equivalence under arbitrary sequences", () => {
    fc.assert(
      fc.property(
        fc.commands(
          [fc.stringMatching(/^[a-z]{2,5}$/).map((v) => new AddCmd(v)), fc.constant(new DisposeCmd())],
          { maxCommands: 10 },
        ),
        (cmds) => {
          fc.modelRun(
            () => ({
              model: { items: [] as string[] },
              real: {
                state: createState<string[], { add: (v: string) => void }>({
                  name: "core.mbt",
                  initial: () => [],
                  editor: (d) => ({ add: (v) => { d.push(v); } }),
                }),
                regs: [],
              },
            }),
            cmds,
          );
        },
      ),
      { numRuns: 25 },
    );
  });
});
