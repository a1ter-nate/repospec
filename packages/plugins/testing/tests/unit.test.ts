import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { testingPlugin } from "@repospec/plugin-testing";

describe("@repospec/plugin-testing unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(testingPlugin.id).toBe("repospec.testing");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [testingPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.testing");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
