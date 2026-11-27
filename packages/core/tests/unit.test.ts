import { describe, expect, test } from "bun:test";
import { createPluginHost, createState, diffSpecs, mergeFragments } from "@repospec/core";

describe("@repospec/core unit invariants (R2)", () => {
  test("State.create tracks revisions, replays cleanly, and PluginHost boots all 16 built-ins", async () => {
    const st = createState<string[], { push: (v: string) => void }>({
      name: "core.unit.list",
      initial: () => [],
      editor: (draft) => ({ push: (v) => { draft.push(v); } }),
    });
    expect(st.revision()).toBe(0);
    const reg = st.transform((e) => e.push("item"));
    expect(st.get()).toEqual(["item"]);
    expect(st.revision()).toBe(1);
    reg.dispose();
    expect(st.get()).toEqual([]);

    const merged = mergeFragments([{ nodes: [], edges: [], rules: [] }]);
    expect(merged.nodes).toEqual([]);
    expect(typeof diffSpecs).toBe("function");

    const host = await createPluginHost({ includeBuiltins: true });
    try {
      const list = host.list();
      expect(list.length).toBeGreaterThanOrEqual(16);
      expect(list.every((p) => p.status === "active")).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});
