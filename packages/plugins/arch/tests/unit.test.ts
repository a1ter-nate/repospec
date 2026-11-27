import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { archPlugin } from "@repospec/plugin-arch";

describe("@repospec/plugin-arch unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(archPlugin.id).toBe("repospec.arch");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [archPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.arch");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
