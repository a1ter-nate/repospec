import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { langCsharpPlugin } from "@repospec/plugin-lang-csharp";

describe("@repospec/plugin-lang-csharp unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(langCsharpPlugin.id).toBe("repospec.lang.csharp");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [langCsharpPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.lang.csharp");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
