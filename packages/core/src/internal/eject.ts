import fs from "node:fs";
import path from "node:path";

export type EjectTarget = "show-me" | "report" | "ci" | "extractor" | "facts" | "flows" | "rule" | "all";

export interface EjectResult {
  readonly target: EjectTarget;
  readonly written: string[];
  readonly skipped: string[];
}

const TEMPLATES: Record<Exclude<EjectTarget, "all">, { relPath: string; content: string }> = {
  "show-me": {
    relPath: ".repospec/show-me.ts",
    content: `import { defineShowMe } from "repospec/show-me";

export default defineShowMe({
  triage(ctx, fallback) {
    const base = fallback();
    const addedFlags = ctx.factDiff("feature_flag").added;
    if (addedFlags.length > 0) {
      return {
        ...base,
        level: base.level === "skim" ? "look" : base.level,
        attentionItems: [
          ...base.attentionItems,
          {
            kind: "contract",
            title: "Feature flag introduced",
            detail: addedFlags.map((f) => "\`" + f.key + "\`").join(", "),
          },
        ],
      };
    }
    return base;
  },
});
`,
  },
  report: {
    relPath: ".repospec/report.ts",
    content: `import { defineReport } from "repospec/report";

export default defineReport({
  title: undefined,
  theme: {
    accent: "#38bdf8",
  },
  customCss: "",
  customBriefingHtml: (ctx) => {
    const count = ctx.spec.extensions.facts.length;
    if (count === 0) return "";
    return '<div class="story-box"><strong>Custom Extracted Facts:</strong> ' + count + " records indexed.</div>";
  },
  extraTabs: [],
});
`,
  },
  ci: {
    relPath: ".repospec/ci.ts",
    content: `import { defineCi } from "repospec/ci";

export default defineCi({
  gates: [
    {
      id: "custom:zero-error-facts",
      name: "No error-severity custom facts",
      severity: "error",
      evaluate(ctx) {
        const errors = ctx.spec.extensions.facts.filter((f) => f.severity === "error");
        return {
          passed: errors.length === 0,
          message: errors.length === 0 ? "0 error facts" : errors.length + " error fact(s) found",
          items: errors.map((f) => f.file + ":" + f.line + " " + f.kind + "=" + f.key),
        };
      },
    },
  ],
});
`,
  },
  extractor: {
    relPath: ".repospec/extractors/custom.ts",
    content: `import { defineExtractor } from "repospec/core";

export default defineExtractor({
  id: "custom.todo-markers",
  domain: "arch",
  extract(kit) {
    for (const file of kit.files("src/**/*.{ts,tsx}")) {
      const text = kit.readText(file);
      if (!text) continue;
      const lines = text.split("\\n");
      for (let i = 0; i < lines.length; i += 1) {
        const match = (lines[i] ?? "").match(/TODO\\(([^)]+)\\)/);
        if (!match?.[1]) continue;
        kit.emitFact({
          kind: "todo_owner",
          key: match[1],
          file,
          line: i + 1,
          payload: { owner: match[1] },
        });
      }
    }
  },
});
`,
  },
  facts: {
    relPath: ".repospec/facts.yaml",
    content: `facts:
  - kind: feature_flag
    files: "src/**/*.{ts,tsx}"
    match:
      call: ["useFeatureFlag", "isFeatureEnabled"]
    extract:
      key: "$arg0"
      payload:
        callee: "$callee"
`,
  },
  flows: {
    relPath: ".repospec/flows.yaml",
    content: `journeys:
  - id: primary-write-path
    name: Primary Write Path
    entryFile: src/controller/updates.ts
    entryFn: handleUpdate
    tags: ["critical-path", "ddia"]
`,
  },
  rule: {
    relPath: ".repospec/rules/01-custom-fact-check.sql",
    content: `-- @id: custom:error-facts
-- @name: No Error-Severity Custom Facts
-- @rung: R1
-- @severity: warn
-- @statement: Custom extractors should not emit unresolved error-severity facts.
-- @why: Custom domain checks surfaced an error fact in source code.
-- @fix: Inspect the reported fact and resolve the underlying domain violation.

SELECT
  key AS subject,
  kind || ': ' || key AS detail,
  file,
  line
FROM facts
WHERE severity = 'error';
`,
  },
};

export function parseEjectTarget(raw: string): EjectTarget | null {
  if (
    raw === "show-me" ||
    raw === "report" ||
    raw === "ci" ||
    raw === "extractor" ||
    raw === "facts" ||
    raw === "flows" ||
    raw === "rule" ||
    raw === "all"
  ) {
    return raw;
  }
  return null;
}

export function ejectJellywareTarget(
  repoDir: string,
  target: EjectTarget,
  overwrite = false,
): EjectResult {
  const absRepo = path.resolve(repoDir);
  const keys: Array<Exclude<EjectTarget, "all">> =
    target === "all" ? ["show-me", "report", "ci", "extractor", "facts", "flows", "rule"] : [target];

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
