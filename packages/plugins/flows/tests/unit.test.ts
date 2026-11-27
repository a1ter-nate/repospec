import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { flowsPlugin } from "@repospec/plugin-flows";

describe("@repospec/plugin-flows unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(flowsPlugin.id).toBe("repospec.flows");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [flowsPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.flows");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
