import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { langRustPlugin } from "@repospec/plugin-lang-rust";

describe("@repospec/plugin-lang-rust unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(langRustPlugin.id).toBe("repospec.lang.rust");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [langRustPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.lang.rust");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
