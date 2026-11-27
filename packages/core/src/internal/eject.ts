import fs from "node:fs";
import path from "node:path";

export type EjectTarget = "show-me" | "report" | "ci" | "extractor" | "facts" | "flows" | "language" | "rule" | "all";

export interface EjectResult {
  readonly target: EjectTarget;
  readonly written: string[];
  readonly skipped: string[];
}

const ALL_TARGETS: ReadonlyArray<Exclude<EjectTarget, "all">> = [
  "show-me", "report", "ci", "extractor", "facts", "flows", "language", "rule",
];

const TEMPLATES: Record<Exclude<EjectTarget, "all">, { relPath: string; content: string }> = {
  "show-me": {
    relPath: ".repospec/show-me.ts",
    content: [
      'import { defineShowMe } from "repospec/show-me";',
      "export default defineShowMe({",
      "  triage(ctx, fallback) {",
      "    const base = fallback();",
      '    const addedFlags = ctx.factDiff("feature_flag").added;',
      '    if (addedFlags.length === 0) return base;',
      '    return { ...base, level: base.level === "skim" ? "look" : base.level, attentionItems: [...base.attentionItems, { kind: "contract", title: "Feature flag introduced", detail: addedFlags.map((f) => "`" + f.key + "`").join(", ") }] };',
      "  },",
      "});",
      "",
    ].join("\n"),
  },
  report: {
    relPath: ".repospec/report.ts",
    content: [
      'import { defineReport } from "repospec/report";',
      "export default defineReport({",
      '  theme: { accent: "#38bdf8" },',
      '  customCss: "",',
      "  customBriefingHtml: (ctx) => {",
      "    const count = ctx.spec.extensions.facts.length;",
      '    return count === 0 ? "" : \'<div class="story-box"><strong>Custom Extracted Facts:</strong> \' + count + " records indexed.</div>";',
      "  },",
      "  extraTabs: [],",
      "});",
      "",
    ].join("\n"),
  },
  ci: {
    relPath: ".repospec/ci.ts",
    content: [
      'import { defineCi } from "repospec/ci";',
      "export default defineCi({",
      "  gates: [{",
      '    id: "custom:zero-error-facts",',
      '    name: "No error-severity custom facts",',
      '    severity: "error",',
      "    evaluate(ctx) {",
      '      const errors = ctx.spec.extensions.facts.filter((f) => f.severity === "error");',
      '      return { passed: errors.length === 0, message: errors.length === 0 ? "0 error facts" : errors.length + " error fact(s) found", items: errors.map((f) => f.file + ":" + f.line + " " + f.kind + "=" + f.key) };',
      "    },",
      "  }],",
      "});",
      "",
    ].join("\n"),
  },
  extractor: {
    relPath: ".repospec/extractors/custom.ts",
    content: [
      'import { defineExtractor } from "repospec/core";',
      "export default defineExtractor({",
      '  id: "custom.todo-markers",',
      '  domain: "arch",',
      "  extract(kit) {",
      '    for (const file of kit.files("src/**/*.{ts,tsx}")) {',
      "      const text = kit.readText(file);",
      "      if (!text) continue;",
      '      const lines = text.split("\\n");',
      "      for (let i = 0; i < lines.length; i += 1) {",
      '        const match = (lines[i] ?? "").match(/TODO\\(([^)]+)\\)/);',
      "        if (!match?.[1]) continue;",
      '        kit.emitFact({ kind: "todo_owner", key: match[1], file, line: i + 1, payload: { owner: match[1] } });',
      "      }",
      "    }",
      "  },",
      "});",
      "",
    ].join("\n"),
  },
  facts: {
    relPath: ".repospec/facts.yaml",
    content: 'facts:\n  - kind: feature_flag\n    files: "src/**/*.{ts,tsx}"\n    match:\n      call: ["useFeatureFlag", "isFeatureEnabled"]\n    extract:\n      key: "$arg0"\n      payload:\n        callee: "$callee"\n',
  },
  flows: {
    relPath: ".repospec/flows.yaml",
    content: 'journeys:\n  - id: primary-write-path\n    name: Primary Write Path\n    entryFile: src/controller/updates.ts\n    entryFn: handleUpdate\n    tags: ["critical-path", "ddia"]\n',
  },
  language: {
    relPath: ".repospec/languages/custom-language.ts",
    content: [
      'import { defineFlowLanguage, detectFlowHazards } from "repospec/flows/languages";',
      "export default defineFlowLanguage({",
      '  id: "custom-lang", label: "Custom Language", extensions: [".go"],',
      "  extractFlows(ctx) {",
      '    const steps = []; const lines = ctx.text.split("\\n");',
      "    for (let i = 0; i < lines.length; i += 1) {",
      '      if (/\\.ExecContext\\(/.test(lines[i] ?? "")) steps.push({ index: steps.length, fn: "db.ExecContext", op: "tx_commit" as const, lane: "datastore" as const, file: ctx.relFile, line: i + 1, afterResponse: false, bestEffort: false });',
      "    }",
      "    if (steps.length < 2) return [];",
      '    return [{ id: `flow:${ctx.unitSlug}:${ctx.relFile}:handler`, name: "handler", entryFn: "handler", triggerKind: "http" as const, file: ctx.relFile, line: 1, unit: ctx.unitSlug, steps, responseStepIndex: null, commitStepIndex: steps.length - 1, serialAwaitCount: steps.length, hazards: detectFlowHazards("handler", ctx.relFile, steps, null, steps.length - 1) }];',
      "  },",
      "});",
      "",
    ].join("\n"),
  },
  rule: {
    relPath: ".repospec/rules/01-custom-fact-check.sql",
    content: "-- @id: custom:error-facts\n-- @name: No Error-Severity Custom Facts\n-- @rung: R1\n-- @severity: warn\n-- @statement: Custom extractors should not emit unresolved error-severity facts.\n-- @why: Custom domain checks surfaced an error fact in source code.\n-- @fix: Inspect the reported fact and resolve the underlying domain violation.\n\nSELECT key AS subject, kind || ': ' || key AS detail, file, line FROM facts WHERE severity = 'error';\n",
  },
};

export function parseEjectTarget(raw: string): EjectTarget | null {
  if (raw === "all" || ALL_TARGETS.includes(raw as Exclude<EjectTarget, "all">)) return raw as EjectTarget;
  return null;
}

export function ejectJellywareTarget(repoDir: string, target: EjectTarget, overwrite = false): EjectResult {
  const absRepo = path.resolve(repoDir);
  const keys = target === "all" ? ALL_TARGETS : [target];
  const written: string[] = [];
  const skipped: string[] = [];
  for (const k of keys) {
    const spec = TEMPLATES[k];
    const absDest = path.join(absRepo, spec.relPath);
    if (fs.existsSync(absDest) && !overwrite) {
      skipped.push(absDest);
      continue;
    }
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.writeFileSync(absDest, spec.content, "utf8");
    written.push(absDest);
  }
  return { target, written, skipped };
}
