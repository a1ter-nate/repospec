import { describe, expect, test } from "bun:test";
import { createPluginHost } from "@repospec/core";
import { passportPlugin } from "@repospec/plugin-passport";

describe("@repospec/plugin-passport unit invariants (R2)", () => {
  test("defines valid dogfooded plugin and activates cleanly into query domain", async () => {
    expect(passportPlugin.id).toBe("repospec.passport");
    const host = await createPluginHost({ includeBuiltins: false, plugins: [passportPlugin] });
    try {
      const entries = host.list();
      expect(entries.length).toBe(1);
      expect(entries[0]?.id).toBe("repospec.passport");
      expect(entries[0]?.status).toBe("active");
      expect(host.domains.query.get().length >= 1).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
