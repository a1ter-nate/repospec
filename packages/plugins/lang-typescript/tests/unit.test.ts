import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { langTypescriptPlugin } from "@repospec/plugin-lang-typescript";

describe("@repospec/plugin-lang-typescript unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(langTypescriptPlugin.id).toBe("repospec.lang.typescript");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [langTypescriptPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.lang.typescript");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
