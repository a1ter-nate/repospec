import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { csharpFlowLanguage } from "./csharpLanguage.ts";
import { extractFieldEventsFromSource, extractStateMachinesFromSource } from "./dataLifecycle.ts";
import { extractWorkFlowsFromSource } from "./effectTracer.ts";
import { defineFlowLanguage, type FlowLanguagePlugin } from "./languageTypes.ts";
import { rustFlowLanguage } from "./rustLanguage.ts";

function parseTsSource(relFile: string, text: string): ts.SourceFile {
  const kind = relFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(relFile, text, ts.ScriptTarget.Latest, true, kind);
}

export const typescriptFlowLanguage = defineFlowLanguage({
  id: "typescript",
  label: "TypeScript / JavaScript",
  extensions: [".ts", ".tsx", ".mts", ".js", ".mjs"],
  extractFlows: (ctx) => {
    if (ctx.relFile.endsWith(".d.ts")) return [];
    return extractWorkFlowsFromSource(parseTsSource(ctx.relFile, ctx.text), ctx.relFile, ctx.unitSlug, ctx.anchors);
  },
  extractFieldEvents: (ctx) => {
    if (ctx.relFile.endsWith(".d.ts")) return [];
    return extractFieldEventsFromSource(parseTsSource(ctx.relFile, ctx.text), ctx.relFile);
  },
  extractStateMachines: (ctx) => {
    if (ctx.relFile.endsWith(".d.ts")) return [];
    return extractStateMachinesFromSource(parseTsSource(ctx.relFile, ctx.text), ctx.relFile, ctx.unitSlug);
  },
});

export const BUILTIN_FLOW_LANGUAGES: readonly FlowLanguagePlugin[] = [
  typescriptFlowLanguage,
  rustFlowLanguage,
  csharpFlowLanguage,
];

function isFlowLanguagePlugin(val: unknown): val is FlowLanguagePlugin {
  if (!val || typeof val !== "object") return false;
  const r = val as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.label === "string" &&
    Array.isArray(r.extensions) &&
    r.extensions.length > 0
  );
}

export async function loadRepoFlowLanguages(repoDir: string): Promise<FlowLanguagePlugin[]> {
  const dir = path.join(path.resolve(repoDir), ".repospec", "languages");
  if (!fs.existsSync(dir)) return [];
  const loaded: FlowLanguagePlugin[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(?:ts|mts|js|mjs)$/.test(f) && !f.endsWith(".d.ts"))
    .sort();
  for (const f of files) {
    const abs = path.join(dir, f);
    try {
      const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
      if (isFlowLanguagePlugin(mod.default)) {
        loaded.push(mod.default);
      }
    } catch {
      continue;
    }
  }
  return loaded;
}
