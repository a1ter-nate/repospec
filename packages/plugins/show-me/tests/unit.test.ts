import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { showMePlugin } from "@repospec/plugin-show-me";

describe("@repospec/plugin-show-me unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into showMe domain", async () => {
    expect(showMePlugin.id).toBe("repospec.show-me");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [showMePlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.show-me");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.showMe.get().triages.length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
