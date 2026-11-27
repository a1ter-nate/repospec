import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { moduleAtlasPlugin } from "@repospec/plugin-module-atlas";

describe("@repospec/plugin-module-atlas unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into diagram domain", async () => {
    expect(moduleAtlasPlugin.id).toBe("repospec.module-atlas");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [moduleAtlasPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.module-atlas");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.diagram.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
