import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createPluginHost } from "@repospec/core";
import { passportPlugin } from "@repospec/plugin-passport";

class VerifyRegistrationCmd implements fc.Command<{ checked: number }, { registered: () => boolean }> {
  check(): boolean {
    return true;
  }
  run(model: { checked: number }, real: { registered: () => boolean }): void {
    model.checked += 1;
    expect(real.registered()).toBe(true);
  }
}

describe("@repospec/plugin-passport host boundary contract (R3 MBT)", () => {
  test("plugin registration remains stable across stateful reads and cleans up completely on dispose", async () => {
    const host = await createPluginHost({ includeBuiltins: false, plugins: [passportPlugin] });
    fc.assert(
      fc.property(fc.commands([fc.constant(new VerifyRegistrationCmd())], { maxCommands: 4 }), (cmds) => {
        fc.modelRun(
          () => ({ model: { checked: 0 }, real: { registered: () => host.domains.query.get().length >= 1 } }),
          cmds,
        );
      }),
      { numRuns: 10 },
    );
    await host.dispose();
    expect(host.domains.query.get().length === 0).toBe(true);
  });
});
