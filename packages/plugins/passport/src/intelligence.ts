import { execFileSync } from "node:child_process";
import type { Database } from "bun:sqlite";

export interface SecretsSummary {
  hiddenDecisions: {
    datastores: string[];
    externalServices: string[];
    envVars: string[];
  };
  exportedLeaks: Array<{ symbol: string; file: string; line: number; detail: string }>;
}

export interface ContractionReport {
  schema: "repospec.contraction/v1";
  target: string;
  targetKind: "file" | "unit" | "prefix";
  internalFiles: number;
  externalImportersBroken: string[];
  brokenEdgeCount: number;
  ownedEntities: string[];
  sharedEntities: string[];
  ownedEnvVars: string[];
  sharedEnvVars: string[];
  iacReferences: number;
  deletabilityScore: number;
  verdict: "cartridge" | "extractable" | "entangled";
}

export interface SymbolSliceSummary {
  changedSymbols: Array<{ file: string; symbol: string; line: number }>;
  impactedConsumers: string[];
  coarseFileConsumers: number;
  precisionGainPct: number;
}

export interface ChangeRiskSummary {
  kameiEntropy: number;
  priorBugFixTouches: number;
  lowOwnershipFiles: Array<{ file: string; majorAuthor: string | null; majorOwnerPct: number; minorAuthors: number }>;
  codeowners: string[];
}

export function buildSecretsSummary(db: Database, scopeFiles: readonly string[]): SecretsSummary {
  if (scopeFiles.length === 0) {
    return { hiddenDecisions: { datastores: [], externalServices: [], envVars: [] }, exportedLeaks: [] };
  }
  const ph = scopeFiles.map(() => "?").join(",");
  const dsRows = db
    .query(`SELECT DISTINCT datastore || '.' || entity AS ref FROM entity_access WHERE file IN (${ph}) ORDER BY ref ASC LIMIT 25`)
    .all(...scopeFiles) as Array<{ ref: string }>;
  const extRows = db
    .query(`SELECT DISTINCT service_label AS label FROM external_hosts WHERE file IN (${ph}) ORDER BY label ASC LIMIT 25`)
    .all(...scopeFiles) as Array<{ label: string }>;
  const envRows = db
    .query(`SELECT DISTINCT env_name FROM env_bindings WHERE file IN (${ph}) ORDER BY env_name ASC LIMIT 25`)
    .all(...scopeFiles) as Array<{ env_name: string }>;
  const leakRows = db
    .query(
      `SELECT COALESCE(symbol, key) AS sym, file, line, payload_json
       FROM facts
       WHERE kind = 'secret_leak' AND file IN (${ph})
       ORDER BY file ASC, line ASC LIMIT 25`,
    )
    .all(...scopeFiles) as Array<{ sym: string; file: string; line: number; payload_json: string }>;

  return {
    hiddenDecisions: {
      datastores: dsRows.map((r) => r.ref),
      externalServices: extRows.map((r) => r.label),
      envVars: envRows.map((r) => r.env_name),
    },
    exportedLeaks: leakRows.map((r) => {
      let detail = `Leaks ${r.sym}`;
      try {
        const parsed = JSON.parse(r.payload_json) as { snippet?: string };
        if (parsed.snippet) detail = parsed.snippet;
      } catch {
        void 0;
      }
      return { symbol: r.sym, file: r.file, line: r.line, detail };
    }),
  };
}

export function buildContractionReport(db: Database, target: string): ContractionReport {
  const unitRow = db
    .query("SELECT id, name, dir FROM units WHERE id = ? OR name = ? OR slug = ? OR dir = ? LIMIT 1")
    .get(target, target, target, target) as { id: string; name: string; dir: string } | null;

  let targetKind: ContractionReport["targetKind"] = "prefix";
  let internalFiles: string[] = [];

  if (unitRow) {
    targetKind = "unit";
    const rows = db
      .query("SELECT file FROM files WHERE unit = ? AND is_test = 0 ORDER BY file ASC")
      .all(unitRow.name) as Array<{ file: string }>;
    internalFiles = rows.map((r) => r.file);
  } else {
    const exact = db.query("SELECT file FROM files WHERE file = ? LIMIT 1").get(target) as { file: string } | null;
    if (exact) {
      targetKind = "file";
      internalFiles = [exact.file];
    } else {
      const clean = target.replace(/\/+$/, "");
      const rows = db
        .query("SELECT file FROM files WHERE (file = ? OR file LIKE ? || '/%') AND is_test = 0 ORDER BY file ASC")
        .all(clean, clean) as Array<{ file: string }>;
      internalFiles = rows.map((r) => r.file);
    }
  }

  if (internalFiles.length === 0) {
    return {
      schema: "repospec.contraction/v1",
      target,
      targetKind,
      internalFiles: 0,
      externalImportersBroken: [],
      brokenEdgeCount: 0,
      ownedEntities: [],
      sharedEntities: [],
      ownedEnvVars: [],
      sharedEnvVars: [],
      iacReferences: 0,
      deletabilityScore: 100,
      verdict: "cartridge",
    };
  }

  const internalSet = new Set(internalFiles);
  const ph = internalFiles.map(() => "?").join(",");

  const incoming = db
    .query(
      `SELECT fi.from_file AS fromFile
       FROM file_imports fi
       JOIN files f ON f.file = fi.from_file AND f.is_test = 0
       WHERE fi.to_file IN (${ph}) AND fi.type_only = 0`,
    )
    .all(...internalFiles) as Array<{ fromFile: string }>;

  const extImporters = new Set<string>();
  let brokenEdgeCount = 0;
  for (const row of incoming) {
    if (!internalSet.has(row.fromFile)) {
      extImporters.add(row.fromFile);
      brokenEdgeCount += 1;
    }
  }

  const entityRows = db
    .query(`SELECT DISTINCT datastore || '.' || entity AS ref, entity FROM entity_access WHERE file IN (${ph})`)
    .all(...internalFiles) as Array<{ ref: string; entity: string }>;
  const ownedEntities: string[] = [];
  const sharedEntities: string[] = [];
  for (const er of entityRows) {
    const outside = db
      .query(`SELECT COUNT(DISTINCT file) AS cnt FROM entity_access WHERE entity = ? AND file NOT IN (${ph})`)
      .get(er.entity, ...internalFiles) as { cnt: number };
    if ((outside?.cnt ?? 0) > 0) sharedEntities.push(er.ref);
    else ownedEntities.push(er.ref);
  }

  const envRows = db
    .query(`SELECT DISTINCT env_name FROM env_bindings WHERE file IN (${ph}) AND source_kind = 'code_read'`)
    .all(...internalFiles) as Array<{ env_name: string }>;
  const ownedEnvVars: string[] = [];
  const sharedEnvVars: string[] = [];
  for (const ev of envRows) {
    const outside = db
      .query(`SELECT COUNT(DISTINCT file) AS cnt FROM env_bindings WHERE env_name = ? AND source_kind = 'code_read' AND file NOT IN (${ph})`)
      .get(ev.env_name, ...internalFiles) as { cnt: number };
    if ((outside?.cnt ?? 0) > 0) sharedEnvVars.push(ev.env_name);
    else ownedEnvVars.push(ev.env_name);
  }

  const iacCountRow = unitRow
    ? (db
        .query("SELECT COUNT(*) AS cnt FROM edges WHERE to_id = ? AND from_id LIKE 'iac:%'")
        .get(unitRow.id) as { cnt: number })
    : { cnt: 0 };
  const iacReferences = iacCountRow?.cnt ?? 0;

  const penalty =
    extImporters.size * 12 +
    sharedEntities.length * 10 +
    sharedEnvVars.length * 4 +
    iacReferences * 8;
  const deletabilityScore = Math.max(0, Math.min(100, 100 - penalty));
  const verdict: ContractionReport["verdict"] =
    deletabilityScore >= 80 ? "cartridge" : deletabilityScore >= 45 ? "extractable" : "entangled";

  return {
    schema: "repospec.contraction/v1",
    target,
    targetKind,
    internalFiles: internalFiles.length,
    externalImportersBroken: Array.from(extImporters).sort(),
    brokenEdgeCount,
    ownedEntities: ownedEntities.sort(),
    sharedEntities: sharedEntities.sort(),
    ownedEnvVars: ownedEnvVars.sort(),
    sharedEnvVars: sharedEnvVars.sort(),
    iacReferences,
    deletabilityScore,
    verdict,
  };
}

function parseChangedLineRanges(repoDir: string, range: string): Map<string, Array<{ start: number; end: number }>> {
  const ranges = new Map<string, Array<{ start: number; end: number }>>();
  let raw = "";
  try {
    raw = execFileSync("git", ["-C", repoDir, "diff", "-U0", "--no-color", range], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return ranges;
  }
  let curFile = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++ b/")) {
      curFile = line.slice(6).trim();
      continue;
    }
    if (curFile && line.startsWith("@@ ")) {
      const m = line.match(/\+(\d+)(?:,(\d+))?/);
      if (m?.[1]) {
        const start = Number.parseInt(m[1], 10);
        const len = m[2] ? Math.max(1, Number.parseInt(m[2], 10)) : 1;
        const list = ranges.get(curFile) ?? [];
        list.push({ start, end: start + len });
        ranges.set(curFile, list);
      }
    }
  }
  return ranges;
}

export function buildSymbolSlice(
  db: Database,
  repoDir: string,
  range: string,
  touchedFiles: readonly string[],
): SymbolSliceSummary {
  if (touchedFiles.length === 0) {
    return { changedSymbols: [], impactedConsumers: [], coarseFileConsumers: 0, precisionGainPct: 0 };
  }
  const lineRanges = parseChangedLineRanges(repoDir, range);
  const changedSymbols: Array<{ file: string; symbol: string; line: number }> = [];
  const impacted = new Set<string>();
  const coarse = new Set<string>();

  for (const file of touchedFiles) {
    const fileCoarse = db
      .query("SELECT DISTINCT from_file FROM file_imports WHERE to_file = ? AND type_only = 0")
      .all(file) as Array<{ from_file: string }>;
    for (const r of fileCoarse) coarse.add(r.from_file);

    const syms = db
      .query("SELECT name, line FROM file_symbols WHERE file = ? ORDER BY line ASC")
      .all(file) as Array<{ name: string; line: number }>;
    const hunks = lineRanges.get(file) ?? [];

    const fileChangedSyms: Array<{ name: string; line: number }> = [];
    for (let i = 0; i < syms.length; i += 1) {
      const sym = syms[i];
      if (!sym) continue;
      const nextLine = syms[i + 1]?.line ?? sym.line + 40;
      const hit = hunks.length === 0 || hunks.some((h) => h.start <= nextLine && h.end >= sym.line);
      if (hit) {
        fileChangedSyms.push(sym);
        changedSymbols.push({ file, symbol: sym.name, line: sym.line });
      }
    }

    const symEdgeCountRow = db
      .query("SELECT COUNT(*) AS cnt FROM symbol_imports WHERE to_file = ?")
      .get(file) as { cnt: number };
    if ((symEdgeCountRow?.cnt ?? 0) === 0 || fileChangedSyms.length === 0) {
      for (const r of fileCoarse) impacted.add(r.from_file);
      continue;
    }

    const queue: Array<{ targetFile: string; symName: string }> = fileChangedSyms.map((s) => ({
      targetFile: file,
      symName: s.name,
    }));
    const seen = new Set<string>();
    let head = 0;
    while (head < queue.length) {
      const item = queue[head];
      head += 1;
      if (!item) continue;
      const key = `${item.targetFile}::${item.symName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const consumers = db
        .query("SELECT DISTINCT from_file FROM symbol_imports WHERE to_file = ? AND (symbol_name = ? OR symbol_name = '*')")
        .all(item.targetFile, item.symName) as Array<{ from_file: string }>;
      for (const c of consumers) {
        impacted.add(c.from_file);
        const barrelRow = db.query("SELECT is_barrel FROM files WHERE file = ?").get(c.from_file) as { is_barrel: number } | null;
        if (barrelRow?.is_barrel === 1) {
          queue.push({ targetFile: c.from_file, symName: item.symName });
        }
      }
    }
  }

  for (const tf of touchedFiles) {
    impacted.delete(tf);
    coarse.delete(tf);
  }
  const coarseCount = coarse.size;
  const precisionGainPct =
    coarseCount > 0 ? Math.max(0, Math.round(((coarseCount - impacted.size) / coarseCount) * 1000) / 10) : 0;

  return {
    changedSymbols: changedSymbols.slice(0, 40),
    impactedConsumers: Array.from(impacted).sort().slice(0, 50),
    coarseFileConsumers: coarseCount,
    precisionGainPct,
  };
}

export function buildChangeRiskSummary(
  db: Database,
  repoDir: string,
  range: string,
  touchedFiles: readonly string[],
): ChangeRiskSummary {
  const fileSizes = new Map<string, number>();
  try {
    const out = execFileSync("git", ["-C", repoDir, "diff", "--numstat", range], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const ch = (Number.parseInt(parts[0] ?? "0", 10) || 0) + (Number.parseInt(parts[1] ?? "0", 10) || 0);
      const rel = (parts[2] ?? "").trim();
      if (rel) fileSizes.set(rel, Math.max(1, ch));
    }
  } catch {
    for (const f of touchedFiles) fileSizes.set(f, 1);
  }

  const totalChanged = Array.from(fileSizes.values()).reduce((s, v) => s + v, 0);
  let entropy = 0;
  if (fileSizes.size >= 2 && totalChanged > 0) {
    for (const v of fileSizes.values()) {
      const p = v / totalChanged;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    entropy = Math.round((entropy / Math.log2(fileSizes.size)) * 1000) / 1000;
  }

  let priorBugFixTouches = 0;
  const lowOwnershipFiles: ChangeRiskSummary["lowOwnershipFiles"] = [];
  const codeowners = new Set<string>();

  for (const file of touchedFiles) {
    const churn = db
      .query("SELECT bug_fix_commits, major_author, major_owner_pct, minor_authors FROM file_churn WHERE file = ?")
      .get(file) as {
      bug_fix_commits: number;
      major_author: string | null;
      major_owner_pct: number;
      minor_authors: number;
    } | null;
    if (churn) {
      priorBugFixTouches += churn.bug_fix_commits;
      if (churn.major_owner_pct < 60 || churn.minor_authors >= 2) {
        lowOwnershipFiles.push({
          file,
          majorAuthor: churn.major_author,
          majorOwnerPct: churn.major_owner_pct,
          minorAuthors: churn.minor_authors,
        });
      }
    }
    const owners = db
      .query(
        `SELECT symbol FROM gov_rules
         WHERE kind = 'owner' AND (scope_prefix = '' OR ? = scope_prefix OR ? LIKE scope_prefix || '/%')
         ORDER BY LENGTH(scope_prefix) DESC LIMIT 1`,
      )
      .all(file, file) as Array<{ symbol: string | null }>;
    for (const o of owners) {
      if (o.symbol) codeowners.add(o.symbol);
    }
  }

  return {
    kameiEntropy: entropy,
    priorBugFixTouches,
    lowOwnershipFiles: lowOwnershipFiles.slice(0, 15),
    codeowners: Array.from(codeowners).sort(),
  };
}
