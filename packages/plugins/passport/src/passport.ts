import { execFileSync } from "node:child_process";
import type { Database } from "bun:sqlite";
import {
  buildChangeRiskSummary,
  buildContractionReport,
  buildSecretsSummary,
  buildSymbolSlice,
  type ChangeRiskSummary,
  type ContractionReport,
  type SecretsSummary,
  type SymbolSliceSummary,
} from "./intelligence.ts";

export type AdvisoryTier = "observed" | "constrained" | "refuse";

export interface FilePassport {
  schema: "repospec.passport/v1";
  kind: "file";
  specDigest: string;
  file: string;
  unit: { id: string; name: string; archetype: string; layerPolicy: string };
  signal: {
    advisory: AdvisoryTier;
    layer: { raw: string; canonical: string; source: string; trusted: boolean };
    domain: { value: string | null; source: string; trusted: boolean };
    reason: string;
  };
  facts: {
    language: string;
    lines: number;
    exportsCount: number;
    prodFanIn: number;
    fanOut: number;
    importsOut: Array<{ file: string; layer: string; line: number }>;
    importsIn: Array<{ file: string; layer: string; line: number }>;
    tests: Array<{ file: string; line: number }>;
    entities: Array<{ datastore: string; entity: string; op: string; line: number }>;
    fkCascades: Array<{ fromTable: string; fromColumn: string; toTable: string; onDelete: string | null }>;
    machines: Array<{ name: string; evidence: string; stateCount: number; transitionCount: number }>;
    endpoints: Array<{ method: string; path: string; authGuard: string | null; source: string }>;
    envNames: string[];
    violations: Array<{ ruleId: string; severity: string; detail: string; line: number }>;
  };
  rules: Array<{ id: string; kind: string; symbol: string | null; text: string; rationale: string | null; file: string }>;
  secrets: SecretsSummary;
  contraction: ContractionReport;
  ownership: { commits: number; relativeChurn: number; bugFixCommits: number; majorAuthor: string | null; majorOwnerPct: number; minorAuthors: number } | null;
  advice: string | null;
}

export interface UnitPassport {
  schema: "repospec.passport/v1";
  kind: "unit";
  specDigest: string;
  unit: {
    id: string;
    name: string;
    slug: string;
    dir: string;
    ecosystem: string;
    archetype: string;
    layerPolicy: string;
    prodFiles: number;
    testFiles: number;
    prodLines: number;
    endpointCount: number;
    violationCount: number;
  };
  layers: Array<{ layer: string; canonicalLayer: string; fileCount: number }>;
  dependsOn: string[];
  dependedBy: string[];
  verifiedBy: string[];
  rules: Array<{ id: string; kind: string; symbol: string | null; text: string; file: string }>;
  violations: Array<{ ruleId: string; severity: string; subject: string; file: string; line: number }>;
  secrets: SecretsSummary;
  contraction: ContractionReport;
}

export interface ImpactReport {
  schema: "repospec.passport/v1";
  kind: "impact";
  specDigest: string;
  range: string;
  touchedFiles: string[];
  unindexedFiles: string[];
  units: string[];
  layers: string[];
  entities: string[];
  fkCascades: Array<{ fromTable: string; toTable: string; onDelete: string }>;
  machines: string[];
  endpoints: Array<{ method: string; path: string; authGuard: string | null }>;
  envNames: string[];
  testsToRun: string[];
  ciWorkflows: string[];
  activeViolations: Array<{ ruleId: string; severity: string; file: string; line: number; detail: string }>;
  docDrift: Array<{ docFile: string; line: number; referencedPath: string }>;
  symbolSlice: SymbolSliceSummary;
  changeRisk: ChangeRiskSummary;
  refusals: string[];
}

export interface PrecedentsReport {
  schema: "repospec.passport/v1";
  kind: "precedents";
  specDigest: string;
  query: { path?: string; intent?: string };
  advisory: AdvisoryTier;
  reason: string;
  destination: string | null;
  exemplars: Array<{ file: string; unit: string; layer: string; canonicalLayer: string }>;
  prohibitions: Array<{ id: string; symbol: string | null; text: string; rationale: string | null; file: string }>;
}

function readMeta(db: Database, key: string): string {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? "";
}

export function buildFilePassport(db: Database, relFile: string): FilePassport | { found: false; file: string; reason: string } {
  const row = db.query("SELECT * FROM v_file_passport WHERE file = ?").get(relFile) as {
    file: string;
    unit: string;
    unit_id: string;
    unit_archetype: string;
    layer_policy: string;
    language: string;
    raw_layer: string;
    canonical_layer: string;
    domain_area: string | null;
    layer_source: string;
    domain_source: string;
    is_test: number;
    is_barrel: number;
    lines: number;
    exports_count: number;
    prod_fan_in: number;
    fan_out: number;
  } | null;

  if (!row) {
    return { found: false, file: relFile, reason: `File "${relFile}" is not indexed in repospec.sqlite.` };
  }

  const layerTrusted = row.layer_source !== "token_heuristic" && row.canonical_layer !== "unclassified";
  const domainTrusted = row.domain_source === "declared_manifest" || row.domain_source === "subdir_module";

  const importsOut = db
    .query("SELECT to_file AS file, to_layer AS layer, line FROM file_imports WHERE from_file = ? AND type_only = 0 ORDER BY line ASC LIMIT 30")
    .all(relFile) as Array<{ file: string; layer: string; line: number }>;

  const importsIn = db
    .query(
      `SELECT fi.from_file AS file, fi.from_layer AS layer, fi.line
       FROM file_imports fi
       JOIN files f ON f.file = fi.from_file AND f.is_test = 0
       WHERE fi.to_file = ? AND fi.type_only = 0
       ORDER BY fi.from_file ASC LIMIT 30`,
    )
    .all(relFile) as Array<{ file: string; layer: string; line: number }>;

  const tests = db
    .query(
      `SELECT fi.from_file AS file, fi.line
       FROM file_imports fi
       JOIN files f ON f.file = fi.from_file AND f.is_test = 1
       WHERE fi.to_file = ?
       ORDER BY fi.from_file ASC LIMIT 30`,
    )
    .all(relFile) as Array<{ file: string; line: number }>;

  const entities = db
    .query("SELECT datastore, entity, op, line FROM entity_access WHERE file = ? ORDER BY line ASC LIMIT 40")
    .all(relFile) as Array<{ datastore: string; entity: string; op: string; line: number }>;

  const entityNames = Array.from(new Set(entities.map((e) => e.entity)));
  const fkCascades: Array<{ fromTable: string; fromColumn: string; toTable: string; onDelete: string | null }> = [];
  for (const en of entityNames) {
    const fks = db
      .query(
        `SELECT from_table AS fromTable, from_column AS fromColumn, to_table AS toTable, on_delete AS onDelete
         FROM db_foreign_keys
         WHERE (to_table = ? OR from_table = ?) AND on_delete IS NOT NULL
         LIMIT 20`,
      )
      .all(en, en) as Array<{ fromTable: string; fromColumn: string; toTable: string; onDelete: string | null }>;
    fkCascades.push(...fks);
  }

  const machines = db
    .query(
      "SELECT name, evidence, state_count AS stateCount, transition_count AS transitionCount FROM state_machines WHERE file = ?",
    )
    .all(relFile) as Array<{ name: string; evidence: string; stateCount: number; transitionCount: number }>;

  const endpoints = db
    .query("SELECT method, path, auth_guard AS authGuard, source FROM http_endpoints WHERE handler_file = ? ORDER BY line ASC LIMIT 40")
    .all(relFile) as Array<{ method: string; path: string; authGuard: string | null; source: string }>;

  const envRows = db
    .query("SELECT DISTINCT env_name FROM env_bindings WHERE file = ? ORDER BY env_name ASC")
    .all(relFile) as Array<{ env_name: string }>;

  const violations = db
    .query("SELECT rule_id AS ruleId, severity, detail, line FROM invariant_evidence WHERE file = ? ORDER BY line ASC LIMIT 30")
    .all(relFile) as Array<{ ruleId: string; severity: string; detail: string; line: number }>;

  const rules = db
    .query(
      `SELECT id, kind, symbol, text, rationale, file
       FROM gov_rules
       WHERE scope_prefix = '' OR ? = scope_prefix OR ? LIKE scope_prefix || '/%'
       ORDER BY LENGTH(scope_prefix) DESC, kind ASC LIMIT 30`,
    )
    .all(relFile, relFile) as Array<{
    id: string;
    kind: string;
    symbol: string | null;
    text: string;
    rationale: string | null;
    file: string;
  }>;

  let advisory: AdvisoryTier = "refuse";
  let reason = "Layer or domain classification relies on heuristic fallback.";
  if (layerTrusted && domainTrusted) {
    advisory = "observed";
    reason = `Both layer (${row.layer_source}) and domain (${row.domain_source}) are grounded in repository structure/manifests.`;
  } else if (layerTrusted || rules.length > 0) {
    advisory = "constrained";
    reason = layerTrusted
      ? `Layer is grounded (${row.layer_source}); domain is not declared.`
      : `Declared governance rules apply, but layer classification (${row.layer_source}) is untrusted.`;
  }

  const advice =
    advisory === "refuse"
      ? null
      : `${row.unit} (${row.canonical_layer}) — ${tests.length} direct test(s), ${violations.length} active violation(s), ${rules.length} scoped rule(s).`;

  const churnRow = db
    .query("SELECT commits, relative_churn, bug_fix_commits, major_author, major_owner_pct, minor_authors FROM file_churn WHERE file = ?")
    .get(relFile) as {
    commits: number;
    relative_churn: number;
    bug_fix_commits: number;
    major_author: string | null;
    major_owner_pct: number;
    minor_authors: number;
  } | null;

  return {
    schema: "repospec.passport/v1",
    kind: "file",
    specDigest: readMeta(db, "specDigest"),
    file: row.file,
    unit: {
      id: row.unit_id,
      name: row.unit,
      archetype: row.unit_archetype,
      layerPolicy: row.layer_policy,
    },
    signal: {
      advisory,
      layer: { raw: row.raw_layer, canonical: row.canonical_layer, source: row.layer_source, trusted: layerTrusted },
      domain: { value: row.domain_area, source: row.domain_source, trusted: domainTrusted },
      reason,
    },
    facts: {
      language: row.language,
      lines: row.lines,
      exportsCount: row.exports_count,
      prodFanIn: row.prod_fan_in,
      fanOut: row.fan_out,
      importsOut,
      importsIn,
      tests,
      entities,
      fkCascades: fkCascades.slice(0, 20),
      machines,
      endpoints,
      envNames: envRows.map((e) => e.env_name),
      violations,
    },
    rules,
    secrets: buildSecretsSummary(db, [row.file]),
    contraction: buildContractionReport(db, row.file),
    ownership: churnRow
      ? {
          commits: churnRow.commits,
          relativeChurn: churnRow.relative_churn,
          bugFixCommits: churnRow.bug_fix_commits,
          majorAuthor: churnRow.major_author,
          majorOwnerPct: churnRow.major_owner_pct,
          minorAuthors: churnRow.minor_authors,
        }
      : null,
    advice,
  };
}

export function buildUnitPassport(
  db: Database,
  unitQuery: string,
): UnitPassport | { found: false; query: string; reason: string } {
  const row = db
    .query("SELECT * FROM v_unit_passport WHERE id = ? OR name = ? OR slug = ? OR dir = ? LIMIT 1")
    .get(unitQuery, unitQuery, unitQuery, unitQuery) as {
    id: string;
    name: string;
    slug: string;
    dir: string;
    ecosystem: string;
    archetype: string;
    layer_policy: string;
    prod_files: number;
    test_files: number;
    prod_lines: number;
    endpoint_count: number;
    violation_count: number;
  } | null;

  if (!row) {
    return { found: false, query: unitQuery, reason: `Unit "${unitQuery}" not found in repospec.sqlite.` };
  }

  const layers = db
    .query(
      `SELECT layer, canonical_layer AS canonicalLayer, COUNT(*) AS fileCount
       FROM files
       WHERE unit = ? AND is_test = 0 AND canonical_layer != 'ops_script'
       GROUP BY layer, canonical_layer
       ORDER BY fileCount DESC`,
    )
    .all(row.name) as Array<{ layer: string; canonicalLayer: string; fileCount: number }>;

  const dependsOn = (
    db.query("SELECT to_id FROM edges WHERE from_id = ? AND kind = 'depends_on' ORDER BY to_id ASC").all(row.id) as Array<{
      to_id: string;
    }>
  ).map((r) => r.to_id);

  const dependedBy = (
    db.query("SELECT from_id FROM edges WHERE to_id = ? AND kind = 'depends_on' ORDER BY from_id ASC").all(row.id) as Array<{
      from_id: string;
    }>
  ).map((r) => r.from_id);

  const verifiedBy = (
    db
      .query("SELECT from_id FROM edges WHERE to_id = ? AND kind IN ('verifies', 'analyzes') ORDER BY from_id ASC")
      .all(row.id) as Array<{ from_id: string }>
  ).map((r) => r.from_id);

  const rules = db
    .query(
      `SELECT id, kind, symbol, text, file
       FROM gov_rules
       WHERE scope_prefix = '' OR ? = scope_prefix OR ? LIKE scope_prefix || '/%'
       ORDER BY LENGTH(scope_prefix) DESC LIMIT 25`,
    )
    .all(row.dir, row.dir) as Array<{ id: string; kind: string; symbol: string | null; text: string; file: string }>;

  const violations = db
    .query(
      `SELECT ie.rule_id AS ruleId, ie.severity, ie.subject, ie.file, ie.line
       FROM invariant_evidence ie
       JOIN files f ON f.file = ie.file
       WHERE f.unit = ?
       ORDER BY ie.severity ASC, ie.file ASC LIMIT 30`,
    )
    .all(row.name) as Array<{ ruleId: string; severity: string; subject: string; file: string; line: number }>;

  const unitProdFiles = (
    db.query("SELECT file FROM files WHERE unit = ? AND is_test = 0 ORDER BY file ASC").all(row.name) as Array<{ file: string }>
  ).map((r) => r.file);

  return {
    schema: "repospec.passport/v1",
    kind: "unit",
    specDigest: readMeta(db, "specDigest"),
    unit: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      dir: row.dir,
      ecosystem: row.ecosystem,
      archetype: row.archetype,
      layerPolicy: row.layer_policy,
      prodFiles: row.prod_files,
      testFiles: row.test_files,
      prodLines: row.prod_lines,
      endpointCount: row.endpoint_count,
      violationCount: row.violation_count,
    },
    layers,
    dependsOn,
    dependedBy,
    verifiedBy,
    rules,
    violations,
    secrets: buildSecretsSummary(db, unitProdFiles),
    contraction: buildContractionReport(db, row.name),
  };
}

export function buildImpactReport(db: Database, repoDir: string, range: string): ImpactReport {
  let diffFiles: string[] = [];
  try {
    const out = execFileSync("git", ["-C", repoDir, "diff", "--name-only", range], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    diffFiles = out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
  } catch {
    diffFiles = [];
  }

  const units = new Set<string>();
  const layers = new Set<string>();
  const entities = new Set<string>();
  const fkCascades: Array<{ fromTable: string; toTable: string; onDelete: string }> = [];
  const machines = new Set<string>();
  const endpoints: Array<{ method: string; path: string; authGuard: string | null }> = [];
  const envNames = new Set<string>();
  const testsToRun = new Set<string>();
  const ciWorkflows = new Set<string>();
  const activeViolations: Array<{ ruleId: string; severity: string; file: string; line: number; detail: string }> = [];
  const unindexedFiles: string[] = [];
  const refusals: string[] = [];

  for (const rel of diffFiles) {
    const fp = buildFilePassport(db, rel);
    if ("found" in fp) {
      unindexedFiles.push(rel);
      continue;
    }
    units.add(fp.unit.name);
    layers.add(`${fp.unit.name}:${fp.signal.layer.raw}`);
    if (fp.signal.advisory === "refuse") {
      refusals.push(`${rel}: ${fp.signal.reason}`);
    }
    for (const e of fp.facts.entities) entities.add(`${e.datastore}.${e.entity}`);
    for (const fk of fp.facts.fkCascades) {
      if (fk.onDelete) fkCascades.push({ fromTable: fk.fromTable, toTable: fk.toTable, onDelete: fk.onDelete });
    }
    for (const m of fp.facts.machines) machines.add(m.name);
    for (const ep of fp.facts.endpoints) endpoints.push({ method: ep.method, path: ep.path, authGuard: ep.authGuard });
    for (const ev of fp.facts.envNames) envNames.add(ev);
    for (const t of fp.facts.tests) testsToRun.add(t.file);
    for (const v of fp.facts.violations) {
      activeViolations.push({ ruleId: v.ruleId, severity: v.severity, file: rel, line: v.line, detail: v.detail });
    }

    const wfs = db
      .query("SELECT from_id FROM edges WHERE to_id = ? AND kind IN ('verifies', 'deploys') AND from_id LIKE 'ci:wf:%'")
      .all(fp.unit.id) as Array<{ from_id: string }>;
    for (const w of wfs) ciWorkflows.add(w.from_id.replace(/^ci:wf:/, ""));
  }

  const docDrift = db
    .query("SELECT doc_file AS docFile, line, referenced_path AS referencedPath FROM v_doc_drift LIMIT 20")
    .all() as Array<{ docFile: string; line: number; referencedPath: string }>;

  const symbolSlice = buildSymbolSlice(db, repoDir, range, diffFiles);
  const changeRisk = buildChangeRiskSummary(db, repoDir, range, diffFiles);

  return {
    schema: "repospec.passport/v1",
    kind: "impact",
    specDigest: readMeta(db, "specDigest"),
    range,
    touchedFiles: diffFiles,
    unindexedFiles,
    units: Array.from(units).sort(),
    layers: Array.from(layers).sort(),
    entities: Array.from(entities).sort(),
    fkCascades: fkCascades.slice(0, 20),
    machines: Array.from(machines).sort(),
    endpoints: endpoints.slice(0, 30),
    envNames: Array.from(envNames).sort(),
    testsToRun: Array.from(testsToRun).sort(),
    ciWorkflows: Array.from(ciWorkflows).sort(),
    activeViolations,
    docDrift,
    symbolSlice,
    changeRisk,
    refusals,
  };
}

export { buildContractionReport } from "./intelligence.ts";
export { buildPrecedentsReport, formatImpactAsGithubMarkdown } from "./reports.ts";
