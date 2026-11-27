import type { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { diffFactSets, type ExtractorPlugin, type FactDiffResult, type FactRecord, type SpecDiagnostic } from "@repospec/plugin";
import { loadDeclarativeFactsExtractor } from "./declarativeFacts.ts";
import type { RepoSpecConfig } from "./toolkit.ts";

export { diffFactSets };
export type { FactDiffResult };

export interface LoadedRepoExtensions {
  readonly dotDir: string;
  readonly config: RepoSpecConfig | null;
  readonly extractors: ExtractorPlugin[];
  readonly extraRulesDirs: string[];
  readonly studioCustomizations: unknown[];
  readonly showMeCustomizations: unknown[];
  readonly ciDefinitions: unknown[];
  readonly diagnostics: SpecDiagnostic[];
}

function isExtractorPlugin(value: unknown): value is ExtractorPlugin {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.extract === "function";
}

async function importLocalModule(
  absPath: string,
  diagnostics: SpecDiagnostic[],
  code: string,
): Promise<Record<string, unknown> | null> {
  if (!fs.existsSync(absPath)) return null;
  try {
    const modUrl = `${pathToFileURL(absPath).href}?mtime=${fs.statSync(absPath).mtimeMs}`;
    const loaded = (await import(modUrl)) as Record<string, unknown>;
    return loaded;
  } catch (err) {
    diagnostics.push({
      code,
      severity: "warn",
      message: `Failed loading ${path.basename(absPath)}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}

export async function loadRepoExtensions(repoDir: string): Promise<LoadedRepoExtensions> {
  const absRepo = path.resolve(repoDir);
  const dotDir = path.join(absRepo, ".repospec");
  const diagnostics: SpecDiagnostic[] = [];
  const extractors: ExtractorPlugin[] = [];
  const extraRulesDirs: string[] = [];

  if (!fs.existsSync(dotDir)) {
    return {
      dotDir,
      config: null,
      extractors,
      extraRulesDirs,
      studioCustomizations: [],
      showMeCustomizations: [],
      ciDefinitions: [],
      diagnostics,
    };
  }

  let config: RepoSpecConfig | null = null;
  const cfgPath = path.join(dotDir, "config.ts");
  const cfgMod = await importLocalModule(cfgPath, diagnostics, "plugin.config.load-failed");
  if (cfgMod?.default && typeof cfgMod.default === "object") {
    config = cfgMod.default as RepoSpecConfig;
    for (const ext of config.extractors ?? []) {
      if (isExtractorPlugin(ext)) extractors.push(ext);
    }
  }

  const factsCandidates = [
    config?.factsFile ? path.resolve(absRepo, config.factsFile) : null,
    path.join(dotDir, "facts.yaml"),
    path.join(dotDir, "facts.yml"),
    path.join(dotDir, "facts.json"),
  ].filter((p): p is string => Boolean(p));

  const seenFactsPaths = new Set<string>();
  for (const fp of factsCandidates) {
    if (seenFactsPaths.has(fp) || !fs.existsSync(fp)) continue;
    seenFactsPaths.add(fp);
    try {
      const dec = loadDeclarativeFactsExtractor(fp);
      if (dec) extractors.push(dec);
    } catch (err) {
      diagnostics.push({
        code: "plugin.facts.load-failed",
        severity: "warn",
        message: `Failed loading ${path.relative(absRepo, fp)}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const extDir = path.join(dotDir, "extractors");
  if (fs.existsSync(extDir) && fs.statSync(extDir).isDirectory()) {
    const extFiles = fs
      .readdirSync(extDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
      .sort();
    for (const f of extFiles) {
      const mod = await importLocalModule(path.join(extDir, f), diagnostics, "plugin.extractor.load-failed");
      if (!mod) continue;
      const candidate = mod.default ?? mod.extractor;
      if (isExtractorPlugin(candidate)) {
        extractors.push(candidate);
      } else if (Array.isArray(candidate)) {
        for (const item of candidate) {
          if (isExtractorPlugin(item)) extractors.push(item);
        }
      }
    }
  }

  const rulesCandidates = [
    config?.rulesDir ? path.resolve(absRepo, config.rulesDir) : null,
    path.join(dotDir, "rules"),
  ].filter((p): p is string => Boolean(p));
  for (const rd of rulesCandidates) {
    if (fs.existsSync(rd) && fs.statSync(rd).isDirectory() && !extraRulesDirs.includes(rd)) {
      extraRulesDirs.push(rd);
    }
  }

  const reportMod = await importLocalModule(path.join(dotDir, "report.ts"), diagnostics, "plugin.report.load-failed");
  const showMeMod = await importLocalModule(path.join(dotDir, "show-me.ts"), diagnostics, "plugin.showme.load-failed");
  const ciMod = await importLocalModule(path.join(dotDir, "ci.ts"), diagnostics, "plugin.ci.load-failed");

  const studioCustomizations: unknown[] = [];
  const showMeCustomizations: unknown[] = [];
  const ciDefinitions: unknown[] = [];
  if (config?.report) studioCustomizations.push(config.report);
  if (reportMod?.default) studioCustomizations.push(reportMod.default);
  if (config?.showMe) showMeCustomizations.push(config.showMe);
  if (showMeMod?.default) showMeCustomizations.push(showMeMod.default);
  if (config?.ci) ciDefinitions.push(config.ci);
  if (ciMod?.default) ciDefinitions.push(ciMod.default);

  return {
    dotDir,
    config,
    extractors,
    extraRulesDirs,
    studioCustomizations,
    showMeCustomizations,
    ciDefinitions,
    diagnostics,
  };
}

export function queryFactsFromDb(
  db: Database,
  opts?: { kind?: string; file?: string; limit?: number },
): FactRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.kind) {
    clauses.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts?.file) {
    clauses.push("file = ?");
    params.push(opts.file);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(5000, opts?.limit ?? 1000));
  const sql = `SELECT extractor_id, kind, key, file, line, unit, symbol, severity, payload_json FROM facts ${where} ORDER BY kind, key, file, line LIMIT ${limit}`;
  const rows = db.query(sql).all(...params) as Array<{
    extractor_id: string;
    kind: string;
    key: string;
    file: string;
    line: number;
    unit: string;
    symbol: string | null;
    severity: string | null;
    payload_json: string;
  }>;
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(r.payload_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
    const sev = r.severity === "error" || r.severity === "warn" || r.severity === "info" ? r.severity : undefined;
    return {
      extractorId: r.extractor_id,
      kind: r.kind,
      key: r.key,
      file: r.file,
      line: r.line,
      unit: r.unit,
      symbol: r.symbol ?? undefined,
      severity: sev,
      payload,
    };
  });
}
