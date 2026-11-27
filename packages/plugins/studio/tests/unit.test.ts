import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { studioPlugin } from "@repospec/plugin-studio";

describe("@repospec/plugin-studio unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into studio domain", async () => {
    expect(studioPlugin.id).toBe("repospec.studio");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [studioPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.studio");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.studio.get().renderer !== null).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
