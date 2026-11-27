import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { langPythonPlugin } from "@repospec/plugin-lang-python";

describe("@repospec/plugin-lang-python unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into extractor domain", async () => {
    expect(langPythonPlugin.id).toBe("repospec.lang.python");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [langPythonPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.lang.python");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.extractor.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
