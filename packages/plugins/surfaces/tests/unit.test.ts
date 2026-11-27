import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { surfacesPlugin } from "@repospec/plugin-surfaces";

describe("@repospec/plugin-surfaces unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(surfacesPlugin.id).toBe("repospec.surfaces");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [surfacesPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.surfaces");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
