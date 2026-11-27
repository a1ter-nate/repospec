import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { iacPlugin } from "@repospec/plugin-iac";

describe("@repospec/plugin-iac unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(iacPlugin.id).toBe("repospec.iac");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [iacPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.iac");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
