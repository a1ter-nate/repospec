import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { ciPlugin } from "@repospec/plugin-ci";

describe("@repospec/plugin-ci unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(ciPlugin.id).toBe("repospec.ci");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [ciPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.ci");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
