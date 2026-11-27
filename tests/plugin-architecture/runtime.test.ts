import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRepoSpecPluginRuntime, readPluginStatus, REPOSPEC_ROOT, type LoadedPluginRuntime } from "./contract.ts";

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
}

describe("Behavioral Conformance: Replayable State, Composition, Fault Isolation & Distribution", () => {
  let tmpRoot = "";
  let polyglotRepo = "";
  let rt: LoadedPluginRuntime | null = null;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-plugin-arch-"));
    polyglotRepo = path.join(tmpRoot, "polyglot");
    writeFiles(polyglotRepo, {
      "package.json": JSON.stringify({ name: "conformance-fixture", version: "1.0.0" }, null, 2),
      "src/app.ts": [
        "export function emitSignal(code: string): string {",
        "  return `SIGNAL_${code}`;",
        "}",
        "export const boot = emitSignal('READY');",
      ].join("\n"),
      "crates/worker/Cargo.toml": '[package]\nname = "worker"\nversion = "0.1.0"\nedition = "2021"\n',
      "crates/worker/src/lib.rs": [
        "pub enum JobState { Pending, Done }",
        "pub fn run_worker(state: JobState) -> JobState {",
        "    match state { JobState::Pending => JobState::Done, JobState::Done => JobState::Done }",
        "}",
      ].join("\n"),
    });
    rt = await loadRepoSpecPluginRuntime();
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("Law 5: Replayable State replays cleanly on disposal without mutating earlier snapshots", () => {
    expect(rt).not.toBeNull();
    if (!rt) throw new Error("Missing @repospec/plugin / @repospec/core plugin runtime");

    const state = rt.createState<string[], { add: (v: string) => void; remove: (v: string) => void }>({
      name: "test.items",
      initial: () => [],
      editor: (draft) => ({
        add: (v) => draft.push(v),
        remove: (v) => {
          const idx = draft.indexOf(v);
          if (idx >= 0) draft.splice(idx, 1);
        },
      }),
    });

    const before = state.get();
    expect(before).toEqual([]);

    const regA = state.transform((e) => e.add("alpha")) as { dispose?: () => void };
    const regB = state.transform((e) => e.add("beta")) as { dispose?: () => void };
    const withBoth = state.get();
    expect(withBoth).toEqual(["alpha", "beta"]);
    expect(before).toEqual([]);

    if (typeof regA?.dispose === "function") regA.dispose();
    const afterDisposeA = state.get();
    expect(afterDisposeA).toEqual(["beta"]);
    expect(withBoth).toEqual(["alpha", "beta"]);
    if (typeof regB?.dispose === "function") regB.dispose();
  });

  test("Law 5b: Removing a dogfooded built-in language plugin removes its extraction cleanly and re-enabling restores it", async () => {
    expect(rt).not.toBeNull();
    if (!rt) throw new Error("Missing @repospec/plugin / @repospec/core plugin runtime");

    const hostFull = await rt.createPluginHost({ repoDir: polyglotRepo, includeBuiltins: true });
    try {
      const fullList = await hostFull.list();
      const rustPlugin = fullList.find((p) => p.id.includes("rust") && readPluginStatus(p) === "active");
      expect(rustPlugin).toBeDefined();
      if (!rustPlugin) throw new Error("Expected an active dogfooded Rust built-in plugin");

      const fullScan = await hostFull.scan(polyglotRepo, { dbPath: path.join(tmpRoot, "full.sqlite") });
      const fullAst = fullScan.spec.ast as { files?: Array<{ file?: string }> } | undefined;
      expect((fullAst?.files ?? []).some((f) => f.file?.endsWith(".rs"))).toBe(true);

      const hostNoRust = await rt.createPluginHost({
        repoDir: polyglotRepo,
        includeBuiltins: true,
        operations: [{ type: "remove", target: rustPlugin.id }],
      });
      try {
        const disabledScan = await hostNoRust.scan(polyglotRepo, { dbPath: path.join(tmpRoot, "norust.sqlite") });
        const disabledAst = disabledScan.spec.ast as { files?: Array<{ file?: string }> } | undefined;
        expect((disabledAst?.files ?? []).some((f) => f.file?.endsWith(".rs"))).toBe(false);
        expect((disabledAst?.files ?? []).some((f) => f.file?.endsWith(".ts"))).toBe(true);
      } finally {
        await hostNoRust.dispose();
      }
    } finally {
      await hostFull.dispose();
    }
  });

  test("Law 6: Two independent external plugins compose across extractors, SQL rules, Studio tabs, and CI gates without overwriting each other", async () => {
    expect(rt).not.toBeNull();
    if (!rt) throw new Error("Missing @repospec/plugin / @repospec/core plugin runtime");

    const pluginA = rt.definePlugin({
      id: "acme.plugin.alpha",
      async setup(ctx) {
        await ctx.extractor.transform((ed) => {
          ed.add({
            id: "acme.extractor.alpha",
            extract: () => ({
              nodes: [],
              edges: [],
              rules: [],
              diagnostics: [],
              facts: [
                {
                  extractorId: "acme.extractor.alpha",
                  kind: "alpha_fact",
                  key: "alpha:1",
                  file: "src/app.ts",
                  line: 1,
                  unit: "conformance-fixture",
                  payload: {},
                },
              ],
            }),
          });
        });
        await ctx.studio.transform((ed) => {
          ed.addTab({ id: "alpha-tab", label: "Alpha View", renderHtml: () => "<section>Alpha</section>" });
        });
        await ctx.ci.transform((ed) => {
          ed.addGate({
            id: "acme.gate.alpha",
            name: "Alpha Gate",
            severity: "warn",
            evaluate: () => ({ passed: true, message: "alpha ok" }),
          });
        });
      },
    });

    const pluginB = rt.definePlugin({
      id: "acme.plugin.beta",
      async setup(ctx) {
        await ctx.extractor.transform((ed) => {
          ed.add({
            id: "acme.extractor.beta",
            extract: () => ({
              nodes: [],
              edges: [],
              rules: [],
              diagnostics: [],
              facts: [
                {
                  extractorId: "acme.extractor.beta",
                  kind: "beta_fact",
                  key: "beta:1",
                  file: "src/app.ts",
                  line: 2,
                  unit: "conformance-fixture",
                  payload: {},
                },
              ],
            }),
          });
        });
        await ctx.studio.transform((ed) => {
          ed.addTab({ id: "beta-tab", label: "Beta View", renderHtml: () => "<section>Beta</section>" });
        });
        await ctx.ci.transform((ed) => {
          ed.addGate({
            id: "acme.gate.beta",
            name: "Beta Gate",
            severity: "warn",
            evaluate: () => ({ passed: true, message: "beta ok" }),
          });
        });
      },
    });

    const host = await rt.createPluginHost({
      repoDir: polyglotRepo,
      includeBuiltins: true,
      plugins: [pluginA, pluginB],
    });
    try {
      const scanRes = await host.scan(polyglotRepo, { dbPath: path.join(tmpRoot, "compose.sqlite") });
      const extensions = scanRes.spec.extensions as { facts?: Array<{ kind?: string }> } | undefined;
      const factKinds = new Set((extensions?.facts ?? []).map((f) => f.kind));
      expect(factKinds.has("alpha_fact")).toBe(true);
      expect(factKinds.has("beta_fact")).toBe(true);

      const html = await host.renderStudio(scanRes);
      expect(html).toContain("Alpha View");
      expect(html).toContain("Beta View");

      const checkRes = await host.check(polyglotRepo, { allowFail: true });
      const gateIds = new Set((checkRes.customGates ?? []).map((g) => g.id));
      expect(gateIds.has("acme.gate.alpha")).toBe(true);
      expect(gateIds.has("acme.gate.beta")).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  test("Law 7: Fault isolation detaches a throwing plugin across all domains while healthy plugins and guarded policies survive", async () => {
    expect(rt).not.toBeNull();
    if (!rt) throw new Error("Missing @repospec/plugin / @repospec/core plugin runtime");

    const crashingPlugin = rt.definePlugin({
      id: "acme.plugin.faulty",
      async setup(ctx) {
        await ctx.studio.transform((ed) => {
          ed.addTab({ id: "faulty-tab", label: "Should Be Detached", renderHtml: () => "<div>bad</div>" });
        });
        await ctx.ci.transform(() => {
          throw new Error("simulated transform crash");
        });
      },
    });

    const healthyPlugin = rt.definePlugin({
      id: "acme.plugin.healthy",
      async setup(ctx) {
        await ctx.studio.transform((ed) => {
          ed.addTab({ id: "healthy-tab", label: "Healthy View", renderHtml: () => "<div>good</div>" });
        });
      },
    });

    const host = await rt.createPluginHost({
      repoDir: polyglotRepo,
      includeBuiltins: true,
      plugins: [crashingPlugin, healthyPlugin],
    });
    try {
      const scanRes = await host.scan(polyglotRepo, { dbPath: path.join(tmpRoot, "fault.sqlite") });
      const html = await host.renderStudio(scanRes);
      expect(html).toContain("Healthy View");
      expect(html).not.toContain("Should Be Detached");

      const statuses = await host.list();
      const faultyStatus = statuses.find((s) => s.id === "acme.plugin.faulty");
      expect(faultyStatus).toBeDefined();
      expect(faultyStatus ? readPluginStatus(faultyStatus) : undefined).toBe("failed");
    } finally {
      await host.dispose();
    }

    const hostWildcardRemove = await rt.createPluginHost({
      repoDir: polyglotRepo,
      includeBuiltins: true,
      operations: [{ type: "remove", target: "*" }],
    });
    try {
      const remaining = await hostWildcardRemove.list();
      const activeGuarded = remaining.filter((p) => p.guarded === true && readPluginStatus(p) === "active");
      expect(activeGuarded.length).toBeGreaterThanOrEqual(1);
    } finally {
      await hostWildcardRemove.dispose();
    }
  });

  test("Law 8: External package plugins load via package.json exports and preserve byte-identical SHA-256 determinism", async () => {
    expect(rt).not.toBeNull();
    if (!rt) throw new Error("Missing @repospec/plugin / @repospec/core plugin runtime");

    const extPkgDir = path.join(tmpRoot, "ext-plugin-pkg");
    const sdkAbs = path.join(REPOSPEC_ROOT, "packages/plugin/src/index.ts");
    writeFiles(extPkgDir, {
      "package.json": JSON.stringify(
        {
          name: "repospec-plugin-ext-test",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./index.ts" },
        },
        null,
        2,
      ),
      "index.ts": [
        `import { Plugin } from ${JSON.stringify(sdkAbs)};`,
        "export default Plugin.define({",
        '  id: "ext.pkg.signal",',
        "  async setup(ctx) {",
        "    await ctx.ci.transform((ed) => {",
        "      ed.addGate({",
        '        id: "ext.pkg.gate",',
        '        name: "External Pkg Gate",',
        '        severity: "warn",',
        '        evaluate: () => ({ passed: true, message: "loaded from package" }),',
        "      });",
        "    });",
        "  },",
        "});",
      ].join("\n"),
    });

    const host = await rt.createPluginHost({
      repoDir: polyglotRepo,
      includeBuiltins: true,
      operations: [{ type: "add", target: extPkgDir }],
    });
    try {
      const statuses = await host.list();
      const loaded = statuses.find((s) => s.id === "ext.pkg.signal");
      expect(loaded).toBeDefined();
      expect(loaded ? readPluginStatus(loaded) : undefined).toBe("active");

      const run1 = await host.scan(polyglotRepo, { dbPath: path.join(tmpRoot, "det1.sqlite") });
      const run2 = await host.scan(polyglotRepo, { dbPath: path.join(tmpRoot, "det2.sqlite") });
      expect(run1.digest).toBe(run2.digest);
    } finally {
      await host.dispose();
    }
  });
});
