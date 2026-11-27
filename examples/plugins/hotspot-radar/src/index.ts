import fs from "node:fs";
import path from "node:path";
import { Plugin, type FactRecord, type RepoContext, type RepoSpecV4 } from "@repospec/plugin";

const PLUGIN_RULES_DIR = path.resolve(import.meta.dir, "../rules");

export const hotspotRadarPlugin = Plugin.define({
  id: "example.hotspot-radar",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add({
        id: "example.hotspot-radar.extractor",
        domain: "arch",
        extract(repoCtx: RepoContext) {
          const facts: FactRecord[] = [];
          const sourceFiles = repoCtx.allFiles.filter((f) => /\.(?:ts|tsx|rs|py|cs)$/.test(f));
          for (const relFile of sourceFiles) {
            const abs = path.join(repoCtx.rootDir, relFile);
            if (!fs.existsSync(abs)) continue;
            const lines = fs.readFileSync(abs, "utf8").split("\n").length;
            facts.push({
              extractorId: "example.hotspot-radar.extractor",
              kind: "hotspot_radar",
              key: relFile,
              file: relFile,
              line: 1,
              unit: repoCtx.repoName,
              severity: "info",
              payload: { lines },
            });
          }
          return {
            nodes: [],
            edges: [],
            rules: [],
            diagnostics: [],
            facts,
          };
        },
      });
    });

    await ctx.rule.transform((ed) => {
      ed.add({
        id: "example.hotspot-radar.rules",
        dir: PLUGIN_RULES_DIR,
      });
    });

    await ctx.studio.transform((ed) => {
      ed.addCss(".rs-hotspot-radar{padding:16px;font-family:ui-monospace,monospace}");
      ed.addTab({
        id: "hotspot-radar",
        label: "Hotspot Radar",
        renderHtml: (renderCtx) => {
          const spec = (renderCtx as { spec?: RepoSpecV4 } | null)?.spec;
          const items = (spec?.extensions.facts ?? []).filter((f) => f.kind === "hotspot_radar");
          const rows = items
            .map((f) => `<li><code>${f.file}</code> (${String(f.payload.lines ?? 0)} lines)</li>`)
            .join("");
          return `<section class="rs-hotspot-radar"><h3>Hotspot Radar (${items.length} files)</h3><ul>${rows}</ul></section>`;
        },
      });
    });

    await ctx.ci.transform((ed) => {
      ed.addGate({
        id: "example.hotspot-radar.gate",
        name: "Hotspot Radar Gate",
        severity: "warn",
        evaluate: (ciCtx) => {
          const spec = (ciCtx as { spec?: RepoSpecV4 } | null)?.spec;
          const count = (spec?.extensions.facts ?? []).filter((f) => f.kind === "hotspot_radar").length;
          return {
            passed: true,
            message: `Hotspot Radar observed ${count} source file(s)`,
          };
        },
      });
    });
  },
});

export default hotspotRadarPlugin;
