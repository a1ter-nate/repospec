import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { sdkGenPlugin } from "@repospec/plugin-sdk-gen";

describe("@repospec/plugin-sdk-gen unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into command domain", async () => {
    expect(sdkGenPlugin.id).toBe("repospec.sdk-gen");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [sdkGenPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.sdk-gen");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.command.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
