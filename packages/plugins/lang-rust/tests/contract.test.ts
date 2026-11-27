import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { createPluginHost } from "@repospec/core";
import { langRustPlugin } from "@repospec/plugin-lang-rust";

class VerifyRegistrationCmd implements fc.Command<{ checked: number }, { registered: () => boolean }> {
  check(): boolean {
    return true;
  }
  run(model: { checked: number }, real: { registered: () => boolean }): void {
    model.checked += 1;
    expect(real.registered()).toBe(true);
  }
}

describe("@repospec/plugin-lang-rust host boundary contract (R3 MBT)", () => {
  test("plugin registration remains stable across stateful reads and cleans up completely on dispose", async () => {
    const host = await createPluginHost({ includeBuiltins: false, plugins: [langRustPlugin] });
    fc.assert(
      fc.property(fc.commands([fc.constant(new VerifyRegistrationCmd())], { maxCommands: 4 }), (cmds) => {
        fc.modelRun(
          () => ({ model: { checked: 0 }, real: { registered: () => host.domains.extractor.get().length >= 1 } }),
          cmds,
        );
      }),
      { numRuns: 10 },
    );
    await host.dispose();
    expect(host.domains.extractor.get().length === 0).toBe(true);
  });
});
