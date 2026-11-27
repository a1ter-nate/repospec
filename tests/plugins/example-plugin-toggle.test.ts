import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPluginHost } from "@repospec/core";
import { Plugin } from "@repospec/plugin";

const REPOSPEC_ROOT = path.resolve(import.meta.dir, "../..");
const EXAMPLE_PLUGIN_DIR = path.join(REPOSPEC_ROOT, "examples/plugins/hotspot-radar");

describe("Standalone reference plugin ON/OFF toggle proof (examples/plugins/hotspot-radar)", () => {
  let tmpRoot = "";
  let sampleRepo = "";

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-toggle-"));
    sampleRepo = path.join(tmpRoot, "sample");
    fs.mkdirSync(path.join(sampleRepo, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(sampleRepo, "package.json"),
      JSON.stringify({ name: "toggle-demo", version: "1.0.0" }, null, 2),
    );
    fs.writeFileSync(
      path.join(sampleRepo, "src", "service.ts"),
      "export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n",
    );
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("toggling hotspot-radar ON emits fact, SQL invariant, Studio tab, and CI gate; toggling OFF leaves zero residue and restores exact baseline SHA-256", async () => {
    const baseHost = await createPluginHost({ repoDir: sampleRepo, includeBuiltins: true });
    let baselineDigest = "";
    try {
      const baseScan = await baseHost.scan(sampleRepo, { dbPath: path.join(tmpRoot, "base.sqlite") });
      baselineDigest = baseScan.digest;
      expect(baseScan.spec.extensions.facts.some((f) => f.kind === "hotspot_radar")).toBe(false);
      expect(baseScan.spec.invariants.some((i) => i.id === "plugin:hotspot-radar-detected")).toBe(false);
      expect(baseHost.renderStudio(baseScan)).not.toContain("Hotspot Radar");
      const baseCheck = await baseHost.check(sampleRepo, { allowFail: true });
      expect(baseCheck.customGates.some((g) => g.id === "example.hotspot-radar.gate")).toBe(false);
    } finally {
      await baseHost.dispose();
    }

    const onHost = await createPluginHost({
      repoDir: sampleRepo,
      includeBuiltins: true,
      operations: [{ type: "add", target: EXAMPLE_PLUGIN_DIR }],
    });
    try {
      const onScan = await onHost.scan(sampleRepo, { dbPath: path.join(tmpRoot, "on.sqlite") });
      expect(onScan.spec.extensions.facts.some((f) => f.kind === "hotspot_radar")).toBe(true);
      expect(onScan.spec.invariants.some((i) => i.id === "plugin:hotspot-radar-detected")).toBe(true);
      const onHtml = onHost.renderStudio(onScan);
      expect(onHtml).toContain("Hotspot Radar");
      expect(onHtml).toContain(".rs-hotspot-radar");
      const onCheck = await onHost.check(sampleRepo, { allowFail: true });
      expect(onCheck.customGates.some((g) => g.id === "example.hotspot-radar.gate")).toBe(true);
      expect(onScan.digest).not.toBe(baselineDigest);

      await onHost.activate([], [
        { type: "add", target: EXAMPLE_PLUGIN_DIR },
        { type: "remove", target: "example.hotspot-radar" },
      ]);
      const offScan = await onHost.scan(sampleRepo, { dbPath: path.join(tmpRoot, "off.sqlite") });
      expect(offScan.spec.extensions.facts.some((f) => f.kind === "hotspot_radar")).toBe(false);
      expect(offScan.spec.invariants.some((i) => i.id === "plugin:hotspot-radar-detected")).toBe(false);
      expect(onHost.renderStudio(offScan)).not.toContain("Hotspot Radar");
      const offCheck = await onHost.check(sampleRepo, { allowFail: true });
      expect(offCheck.customGates.some((g) => g.id === "example.hotspot-radar.gate")).toBe(false);
      expect(offScan.digest).toBe(baselineDigest);
    } finally {
      await onHost.dispose();
    }
  });

  test("external UI plugins can restyle Studio via setUi/addCss or completely replace the renderer via setRenderer", async () => {
    const themePlugin = Plugin.define({
      id: "acme.custom.theme",
      async setup(ctx) {
        await ctx.studio.transform((ed) => {
          ed.setUi?.({
            title: "Acme Custom Studio",
            brandLabel: "AcmeBrand",
            theme: { accent: "#ff3366", bg: "#090b10" },
          });
          ed.addCss(".acme-theme-token{color:#ff3366}");
          ed.addTab({
            id: "acme-home",
            label: "Acme Home",
            renderHtml: () => "<div class=\"acme-theme-token\">Acme Summary</div>",
          });
        });
      },
    });

    const fullUiPlugin = Plugin.define({
      id: "acme.custom.full-ui",
      async setup(ctx) {
        await ctx.studio.transform((ed) => {
          ed.setRenderer?.({
            id: "acme.custom.spa",
            renderVisualHtml: (spec, _digest, opts) => {
              const ui = (opts?.ui ?? {}) as { extraTabs?: Array<{ label: string }>; customCss?: string };
              const tabNames = (ui.extraTabs ?? []).map((t) => t.label).join(",");
              return `<!doctype html><html><head><style>${ui.customCss ?? ""}</style></head><body><h1>Custom UI for ${spec.repo.name}</h1><nav>${tabNames}</nav></body></html>`;
            },
          });
        });
      },
    });

    const themedHost = await createPluginHost({
      repoDir: sampleRepo,
      includeBuiltins: true,
      plugins: [themePlugin],
    });
    try {
      const scan = await themedHost.scan(sampleRepo, { dbPath: path.join(tmpRoot, "themed.sqlite") });
      const html = themedHost.renderStudio(scan);
      expect(html).toContain("Acme Custom Studio");
      expect(html).toContain("AcmeBrand");
      expect(html).toContain("--accent:#ff3366;");
      expect(html).toContain(".acme-theme-token{color:#ff3366}");
      expect(html).toContain("Acme Home");
    } finally {
      await themedHost.dispose();
    }

    const replacedHost = await createPluginHost({
      repoDir: sampleRepo,
      includeBuiltins: true,
      plugins: [themePlugin, fullUiPlugin],
    });
    try {
      const scan = await replacedHost.scan(sampleRepo, { dbPath: path.join(tmpRoot, "replaced.sqlite") });
      const html = replacedHost.renderStudio(scan);
      expect(html).toContain("<h1>Custom UI for toggle-demo</h1>");
      expect(html).toContain("<nav>");
      expect(html).toContain("Acme Home");
      expect(html).toContain(".acme-theme-token{color:#ff3366}");
    } finally {
      await replacedHost.dispose();
    }
  });
});
