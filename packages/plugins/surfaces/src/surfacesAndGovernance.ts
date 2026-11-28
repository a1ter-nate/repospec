import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
  CatalogArtifact,
  ExtractorPlugin,
  GraphFragment,
  RepoContext,
} from "@repospec/plugin";
import { createEmptyAst, isSecretEnvName, resolveUnitForFile } from "@repospec/plugin";

function readTextSafe(absPath: string): string | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  security?: Array<Record<string, unknown>>;
  paths?: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        security?: Array<Record<string, unknown>>;
      }
    >
  >;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export const surfacesAndGovernanceExtractor: ExtractorPlugin = {
  id: "surfaces.governance.v4",
  domain: "rules",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const ast = createEmptyAst();
    const catalogArtifacts: CatalogArtifact[] = [];
    const fileSet = new Set(ctx.allFiles);

    for (const rel of ctx.allFiles) {
      if (/(?:^|\/)[^/]*openapi[^/]*\.(?:json|ya?ml)$/i.test(rel)) {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (!text) continue;
        let doc: OpenApiDoc | null = null;
        try {
          doc = rel.endsWith(".json")
            ? (JSON.parse(text) as OpenApiDoc)
            : (yaml.load(text) as OpenApiDoc);
        } catch {
          continue;
        }
        if (!doc || (!doc.openapi && !doc.swagger) || !doc.paths) continue;
        const unit = resolveUnitForFile(rel, ctx.units);
        const unitName = unit?.name ?? ctx.repoName;
        catalogArtifacts.push({
          id: `catalog:openapi:${rel}`,
          kind: "openapi",
          file: rel,
          ownerUnitId: unit?.id ?? null,
        });

        const rootSec = Array.isArray(doc.security) && doc.security.length > 0
          ? Object.keys(doc.security[0] ?? {}).join(",")
          : null;

        for (const [routePath, methodsObj] of Object.entries(doc.paths).sort(([a], [b]) => a.localeCompare(b))) {
          if (!methodsObj || typeof methodsObj !== "object") continue;
          for (const [verb, op] of Object.entries(methodsObj).sort(([a], [b]) => a.localeCompare(b))) {
            if (!HTTP_METHODS.has(verb.toLowerCase()) || !op || typeof op !== "object") continue;
            let guard: string | null = rootSec;
            if (Array.isArray(op.security)) {
              if (op.security.length === 0) {
                guard = "public";
              } else {
                const schemes = op.security.flatMap((s) => Object.keys(s)).filter(Boolean);
                guard = schemes.length > 0 ? Array.from(new Set(schemes)).join("|") : "public";
              }
            }
            ast.httpEndpoints.push({
              unit: unitName,
              method: verb.toUpperCase(),
              path: routePath,
              authGuard: guard,
              source: "openapi",
              resolution: "contract",
              handlerFile: rel,
              line: 1,
              operationId: typeof op.operationId === "string" ? op.operationId : null,
            });
          }
        }
      }

      if (/(?:^|\/)(?:\.env\.example|example\.env|[^/]*\.env\.template)$/i.test(rel)) {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (!text) continue;
        const unit = resolveUnitForFile(rel, ctx.units);
        const unitName = unit?.name ?? ctx.repoName;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = (lines[i] ?? "").trim();
          if (!line || line.startsWith("#")) continue;
          const m = line.match(/^([A-Z][A-Z0-9_]{2,})\s*=/);
          if (m?.[1]) {
            ast.envBindings.push({
              envName: m[1],
              sourceKind: "env_example",
              unit: unitName,
              file: rel,
              line: i + 1,
              isSecret: isSecretEnvName(m[1]),
            });
          }
        }
      }

      if (rel.endsWith(".tf")) {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (!text) continue;
        for (const m of text.matchAll(/\benv\s*\{([\s\S]*?)\n\s*\}/g)) {
          const body = m[1] ?? "";
          const nameMatch = body.match(/\bname\s*=\s*"([A-Z][A-Z0-9_]{2,})"/);
          if (nameMatch?.[1]) {
            const isSecret = /secret_key_ref|value_source/i.test(body) || isSecretEnvName(nameMatch[1]);
            ast.envBindings.push({
              envName: nameMatch[1],
              sourceKind: isSecret ? "iac_secret" : "iac_env",
              unit: "iac",
              file: rel,
              line: lineOf(text, m.index ?? 0),
              isSecret,
            });
          }
        }
      }

      if (/(?:^|\/)appsettings(?:\.[^/]+)?\.json$/i.test(rel)) {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (text) {
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const unit = resolveUnitForFile(rel, ctx.units);
            const unitName = unit?.name ?? ctx.repoName;
            const walkKeys = (obj: Record<string, unknown>, prefix: string): void => {
              for (const [k, v] of Object.entries(obj)) {
                if (k === "$schema" || k === "Logging" || k === "AllowedHosts") continue;
                const fullKey = prefix ? `${prefix}:${k}` : k;
                ast.envBindings.push({
                  envName: fullKey,
                  sourceKind: "env_example",
                  unit: unitName,
                  file: rel,
                  line: 1,
                  isSecret: isSecretEnvName(fullKey),
                });
                if (v && typeof v === "object" && !Array.isArray(v)) {
                  walkKeys(v as Record<string, unknown>, fullKey);
                }
              }
            };
            walkKeys(parsed, "");
          } catch {
            continue;
          }
        }
      }

      if (rel === "turbo.json") {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (text) {
          try {
            const parsed = JSON.parse(text) as { globalEnv?: string[]; tasks?: Record<string, { env?: string[] }> };
            for (const envName of parsed.globalEnv ?? []) {
              if (/^[A-Z][A-Z0-9_]{2,}$/.test(envName)) {
                ast.envBindings.push({
                  envName,
                  sourceKind: "ci_config",
                  unit: ctx.repoName,
                  file: rel,
                  line: 1,
                  isSecret: isSecretEnvName(envName),
                });
              }
            }
            for (const task of Object.values(parsed.tasks ?? {})) {
              for (const envName of task.env ?? []) {
                if (/^[A-Z][A-Z0-9_]{2,}$/.test(envName)) {
                  ast.envBindings.push({
                    envName,
                    sourceKind: "ci_config",
                    unit: ctx.repoName,
                    file: rel,
                    line: 1,
                    isSecret: isSecretEnvName(envName),
                  });
                }
              }
            }
          } catch {
            continue;
          }
        }
      }

      if (rel.endsWith(".dfy") || rel.endsWith(".qnt") || rel.endsWith(".tla")) {
        const unit = resolveUnitForFile(rel, ctx.units);
        catalogArtifacts.push({
          id: `catalog:formal:${rel}`,
          kind: "formal_spec",
          file: rel,
          ownerUnitId: unit?.id ?? null,
        });
      }

      if (rel === "clippy.toml" || rel.endsWith("/clippy.toml")) {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (text) {
          const scopePrefix = rel === "clippy.toml" ? "" : path.posix.dirname(rel);
          for (const m of text.matchAll(/\{\s*path\s*=\s*"([^"]+)"\s*,\s*reason\s*=\s*"([^"]+)"\s*\}/g)) {
            if (m[1] && m[2]) {
              const ln = lineOf(text, m.index ?? 0);
              ast.govRules.push({
                id: `gov:clippy:${m[1]}`,
                kind: "prohibition",
                scopePrefix,
                symbol: m[1],
                text: `Disallowed method: ${m[1]}`,
                rationale: m[2],
                file: rel,
                line: ln,
              });
            }
          }
        }
      }

      if (rel === ".editorconfig" || rel.endsWith("/.editorconfig")) {
        const text = readTextSafe(path.join(ctx.rootDir, rel));
        if (text) {
          const scopePrefix = rel === ".editorconfig" ? "" : path.posix.dirname(rel);
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i += 1) {
            const m = (lines[i] ?? "").match(/^dotnet_diagnostic\.([A-Z0-9_]+)\.severity\s*=\s*(\w+)/i);
            if (m?.[1] && m[2]) {
              ast.govRules.push({
                id: `gov:editorconfig:${m[1]}`,
                kind: "diagnostic",
                scopePrefix,
                symbol: m[1],
                text: `dotnet_diagnostic.${m[1]}.severity = ${m[2]}`,
                rationale: null,
                file: rel,
                line: i + 1,
              });
            }
          }
        }
      }
    }

    const guidanceDocs = new Map<string, { absPath: string; relLabel: string; scopePrefix: string }>();
    for (const rel of ctx.allFiles) {
      if (/(?:^|\/)(?:AGENTS|CLAUDE)\.md$/i.test(rel)) {
        const dir = path.posix.dirname(rel);
        guidanceDocs.set(path.join(ctx.rootDir, rel), {
          absPath: path.join(ctx.rootDir, rel),
          relLabel: rel,
          scopePrefix: dir === "." ? "" : dir,
        });
      }
    }

    if (ctx.scopeRoot !== ctx.rootDir) {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const parentDoc = path.join(ctx.scopeRoot, name);
        if (fs.existsSync(parentDoc) && !guidanceDocs.has(parentDoc)) {
          guidanceDocs.set(parentDoc, {
            absPath: parentDoc,
            relLabel: path.relative(ctx.rootDir, parentDoc).replace(/\\/g, "/"),
            scopePrefix: "",
          });
        }
      }
    }

    for (const doc of Array.from(guidanceDocs.values()).sort((a, b) => a.relLabel.localeCompare(b.relLabel))) {
      const text = readTextSafe(doc.absPath);
      if (!text) continue;
      catalogArtifacts.push({
        id: `catalog:doc:${doc.relLabel}`,
        kind: "governance_doc",
        file: doc.relLabel,
        ownerUnitId: null,
      });

      const lines = text.split("\n");
      const headings: string[] = [];
      const directives: string[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        const hMatch = line.match(/^#{1,3}\s+(.+)$/);
        if (hMatch?.[1]) {
          headings.push(hMatch[1].trim());
        }
        const bMatch = line.match(/^\s*[-*]\s+(.{12,180})$/);
        if (bMatch?.[1] && directives.length < 8) {
          const cleanedBullet = bMatch[1].replace(/\*\*/g, "").trim();
          if (/\b(?:must|never|always|do not|don't|forbid|require|use |keep |avoid |only )\b/i.test(cleanedBullet)) {
            directives.push(cleanedBullet);
          }
        }
        for (const bm of line.matchAll(/`([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.*-]+)+)`/g)) {
          const refPath = (bm[1] ?? "").replace(/\/+$/, "");
          if (
            !refPath ||
            refPath.includes("*") ||
            refPath.includes("<") ||
            refPath.includes("{") ||
            refPath.startsWith("http") ||
            refPath.startsWith("@") ||
            refPath.startsWith("api/") ||
            refPath.includes("://") ||
            !/\.(?:ts|tsx|js|mjs|cjs|rs|cs|sql|json|ya?ml|toml|md|sh|py|tf|csproj|slnx|dfy|qnt)$/.test(refPath)
          ) {
            continue;
          }
          const docRelative = path.resolve(path.dirname(doc.absPath), refPath);
          const suffixNeedle = `/${refPath}`;
          const existsInRepo =
            fileSet.has(refPath) ||
            fs.existsSync(path.join(ctx.rootDir, refPath)) ||
            fs.existsSync(path.join(ctx.scopeRoot, refPath)) ||
            fs.existsSync(docRelative) ||
            ctx.allFiles.some((f) => f.endsWith(suffixNeedle));
          ast.docPathRefs.push({
            docFile: doc.relLabel,
            line: i + 1,
            referencedPath: refPath,
            existsInRepo,
          });
        }
      }

      const baseDocName = path.basename(doc.relLabel).toUpperCase();
      const siblingAgents = path.join(path.dirname(doc.absPath), "AGENTS.md");
      const isPointerDoc =
        baseDocName === "CLAUDE.MD" &&
        headings.length === 0 &&
        text.trim().length <= 160 &&
        fs.existsSync(siblingAgents);
      if (isPointerDoc) continue;

      const summarySections = headings.slice(0, 6).join(" · ");
      const rationaleLines = directives.length > 0 ? directives.slice(0, 6).join(" | ") : headings.length > 0 ? headings.join(" | ") : null;

      ast.govRules.push({
        id: `gov:doc:${doc.relLabel}`,
        kind: "instruction",
        scopePrefix: doc.scopePrefix,
        symbol: path.basename(doc.relLabel),
        text: summarySections ? `${doc.relLabel}: ${summarySections}` : `Scoped instructions in ${doc.relLabel}`,
        rationale: rationaleLines,
        file: doc.relLabel,
        line: 1,
      });
    }

    const codeownersCandidates = [
      path.join(ctx.rootDir, ".github/CODEOWNERS"),
      path.join(ctx.rootDir, "CODEOWNERS"),
      path.join(ctx.scopeRoot, ".github/CODEOWNERS"),
      path.join(ctx.scopeRoot, "CODEOWNERS"),
    ];
    const codeownersAbs = codeownersCandidates.find((p) => fs.existsSync(p));
    if (codeownersAbs) {
      const coText = readTextSafe(codeownersAbs);
      const coRel = path.relative(ctx.rootDir, codeownersAbs).replace(/\\/g, "/");
      if (coText) {
        const lines = coText.split("\n");
        const effectiveByPattern = new Map<string, { pattern: string; scopePrefix: string; owners: string[]; line: number }>();
        for (let i = 0; i < lines.length; i += 1) {
          const line = (lines[i] ?? "").trim();
          if (!line || line.startsWith("#")) continue;
          const parts = line.split(/\s+/);
          const pattern = parts[0];
          const owners = parts.slice(1);
          if (!pattern || owners.length === 0) continue;
          const scopePrefix = pattern.replace(/^\/+/, "").replace(/\/\*+$/, "").replace(/\*+$/, "");
          if (
            scopePrefix &&
            !pattern.includes("*") &&
            !fs.existsSync(path.join(ctx.rootDir, scopePrefix)) &&
            !fs.existsSync(path.join(ctx.scopeRoot, scopePrefix))
          ) {
            continue;
          }
          effectiveByPattern.set(scopePrefix || pattern, { pattern, scopePrefix, owners, line: i + 1 });
        }
        const usesAdoOnly =
          ctx.allFiles.some((f) => /azure-pipelines\.ya?ml$/i.test(f)) &&
          !ctx.allFiles.some((f) => f.startsWith(".github/workflows/"));
        for (const entry of effectiveByPattern.values()) {
          ast.govRules.push({
            id: `gov:owner:${entry.line}`,
            kind: "owner",
            scopePrefix: entry.scopePrefix,
            symbol: entry.owners.join(" "),
            text: `${entry.pattern} owned by ${entry.owners.join(", ")}`,
            rationale: usesAdoOnly ? "Advisory: Azure DevOps does not natively enforce GitHub CODEOWNERS." : null,
            file: coRel,
            line: entry.line,
          });
        }
      }
    }

    return {
      nodes: [],
      edges: [],
      rules: [],
      catalogArtifacts,
      ast,
    };
  },
};
