import type { Database } from "bun:sqlite";
import type {
  EntityOwnership,
  EnvBindingSummary,
  ForeignKeySummary,
  GovRuleSummary,
  HttpEndpointSummary,
  SqlInvariantResult,
  VerificationCoverage,
} from "../../schema.ts";
import type { RealCoverageReport } from "../coverage.ts";

export function queryEntityOwnership(db: Database): EntityOwnership[] {
  const declaredRows = db
    .query("SELECT datastore, entity, declared_at, authorized_shared, has_tenancy_key FROM declared_entities")
    .all() as Array<{
    datastore: string;
    entity: string;
    declared_at: string;
    authorized_shared: number;
    has_tenancy_key: number;
  }>;
  const declaredMap = new Map<string, { authorizedShared: boolean; hasTenancyKey: boolean }>();
  for (const r of declaredRows) {
    declaredMap.set(`${r.datastore}::${r.entity}`, {
      authorizedShared: r.authorized_shared === 1,
      hasTenancyKey: r.has_tenancy_key === 1,
    });
  }

  const fkCountRows = db
    .query(
      `SELECT datastore, from_table AS tbl, COUNT(*) AS cnt FROM db_foreign_keys GROUP BY datastore, from_table
       UNION ALL
       SELECT datastore, to_table AS tbl, COUNT(*) AS cnt FROM db_foreign_keys GROUP BY datastore, to_table`,
    )
    .all() as Array<{ datastore: string; tbl: string; cnt: number }>;
  const fkCounts = new Map<string, number>();
  for (const r of fkCountRows) {
    const k = `${r.datastore}::${r.tbl}`;
    fkCounts.set(k, (fkCounts.get(k) ?? 0) + r.cnt);
  }

  const accessRows = db
    .query(
      `SELECT ea.datastore, ea.entity, ea.layer, ea.canonical_layer, ea.domain_area, ea.file,
              COALESCE(u.has_persistence_layer, 0) AS has_pers
       FROM entity_access ea
       JOIN files f ON f.file = ea.file AND f.is_test = 0 AND f.canonical_layer != 'ops_script'
       LEFT JOIN units u ON u.name = ea.unit`,
    )
    .all() as Array<{
    datastore: string;
    entity: string;
    layer: string;
    canonical_layer: string;
    domain_area: string | null;
    file: string;
    has_pers: number;
  }>;

  const grouped = new Map<
    string,
    {
      datastore: string;
      entity: string;
      totalRefs: number;
      layers: Set<string>;
      domains: Set<string>;
      hasBypass: boolean;
      files: Set<string>;
    }
  >();

  for (const r of declaredRows) {
    const k = `${r.datastore}::${r.entity}`;
    grouped.set(k, {
      datastore: r.datastore,
      entity: r.entity,
      totalRefs: 0,
      layers: new Set(),
      domains: new Set(),
      hasBypass: false,
      files: new Set(),
    });
  }

  for (const row of accessRows) {
    const k = `${row.datastore}::${row.entity}`;
    let entry = grouped.get(k);
    if (!entry) {
      entry = {
        datastore: row.datastore,
        entity: row.entity,
        totalRefs: 0,
        layers: new Set(),
        domains: new Set(),
        hasBypass: false,
        files: new Set(),
      };
      grouped.set(k, entry);
    }
    entry.totalRefs += 1;
    entry.layers.add(row.layer);
    if (row.domain_area) entry.domains.add(row.domain_area);
    if (row.has_pers === 1 && row.canonical_layer !== "persistence" && row.layer !== "root") {
      entry.hasBypass = true;
    }
    entry.files.add(row.file);
  }

  return Array.from(grouped.values())
    .map((e) => {
      const k = `${e.datastore}::${e.entity}`;
      const decl = declaredMap.get(k);
      return {
        datastore: e.datastore,
        entity: e.entity,
        declared: decl !== undefined,
        authorizedShared: decl?.authorizedShared ?? false,
        totalRefs: e.totalRefs,
        layers: Array.from(e.layers).sort(),
        domains: Array.from(e.domains).sort(),
        hasBypass: e.hasBypass,
        fkCount: fkCounts.get(k) ?? 0,
        hasTenancyKey: decl?.hasTenancyKey ?? false,
        sampleFiles: Array.from(e.files).sort().slice(0, 6),
      };
    })
    .sort((a, b) => b.totalRefs - a.totalRefs || a.entity.localeCompare(b.entity));
}

export function querySurfaces(db: Database): {
  endpoints: HttpEndpointSummary[];
  foreignKeys: ForeignKeySummary[];
  envBindings: EnvBindingSummary[];
  govRules: GovRuleSummary[];
  docDriftCount: number;
} {
  const rawEpRows = db
    .query(
      `SELECT unit, method, path, auth_guard, source, resolution, handler_file, line
       FROM http_endpoints
       ORDER BY
         CASE resolution WHEN 'contract' THEN 0 WHEN 'mounted' THEN 1 ELSE 2 END,
         unit ASC,
         path ASC,
         method ASC`,
    )
    .all() as Array<{
    unit: string;
    method: string;
    path: string;
    auth_guard: string | null;
    source: "openapi" | "ast";
    resolution: "contract" | "mounted" | "fragment";
    handler_file: string;
    line: number;
  }>;

  const unitsWithCanonical = new Set<string>();
  for (const r of rawEpRows) {
    if (r.resolution === "contract" || r.resolution === "mounted") {
      unitsWithCanonical.add(r.unit);
    }
  }

  const reconciledEndpoints = new Map<string, HttpEndpointSummary>();
  for (const r of rawEpRows) {
    if (r.resolution === "fragment" && unitsWithCanonical.has(r.unit)) continue;
    const normPath = r.path.replace(/\{([^}]+)\}/g, ":$1").replace(/\/+$/, "") || "/";
    const key = `${r.unit}|${r.method}|${normPath}`;
    const existing = reconciledEndpoints.get(key);
    if (!existing) {
      reconciledEndpoints.set(key, {
        unit: r.unit,
        method: r.method,
        path: r.path,
        authGuard: r.auth_guard,
        source: r.source,
        resolution: r.resolution,
        file: r.handler_file,
        line: r.line > 0 ? r.line : undefined,
      });
    } else if (existing.source === "openapi" && r.source === "ast" && r.handler_file) {
      reconciledEndpoints.set(key, {
        ...existing,
        file: r.handler_file,
        line: r.line > 0 ? r.line : existing.line,
      });
    }
  }
  const epSummaries = Array.from(reconciledEndpoints.values())
    .sort((a, b) => {
      const ra = a.resolution === "contract" ? 0 : a.resolution === "mounted" ? 1 : 2;
      const rb = b.resolution === "contract" ? 0 : b.resolution === "mounted" ? 1 : 2;
      return ra - rb || a.unit.localeCompare(b.unit) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
    })
    .slice(0, 600);

  const fkRows = db
    .query(
      `SELECT from_table, from_column, to_table, to_column, on_delete, declared_at
       FROM db_foreign_keys
       ORDER BY on_delete DESC, from_table ASC, to_table ASC
       LIMIT 300`,
    )
    .all() as Array<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
    on_delete: string | null;
    declared_at: string;
  }>;

  const envRows = db
    .query(
      `SELECT env_name,
              GROUP_CONCAT(DISTINCT source_kind) AS sources,
              GROUP_CONCAT(DISTINCT unit) AS units,
              MAX(is_secret) AS is_secret,
              MIN(file) AS sample_file
       FROM env_bindings
       GROUP BY env_name
       ORDER BY is_secret DESC, env_name ASC
       LIMIT 250`,
    )
    .all() as Array<{
    env_name: string;
    sources: string;
    units: string;
    is_secret: number;
    sample_file: string;
  }>;

  const govRows = db
    .query(
      `SELECT id, kind, scope_prefix, symbol, text, rationale, file, line
       FROM gov_rules
       ORDER BY kind ASC, scope_prefix ASC, id ASC
       LIMIT 250`,
    )
    .all() as Array<{
    id: string;
    kind: "instruction" | "prohibition" | "owner" | "diagnostic" | "lint_ratchet";
    scope_prefix: string;
    symbol: string | null;
    text: string;
    rationale: string | null;
    file: string;
    line: number;
  }>;

  const driftRow = db.query("SELECT COUNT(*) AS cnt FROM v_doc_drift").get() as { cnt: number };

  return {
    endpoints: epSummaries,
    foreignKeys: fkRows.map((r) => ({
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toTable: r.to_table,
      toColumn: r.to_column,
      onDelete: r.on_delete,
      file: r.declared_at,
    })),
    envBindings: envRows.map((r) => ({
      name: r.env_name,
      sources: (r.sources ?? "").split(",").filter(Boolean).sort(),
      units: (r.units ?? "").split(",").filter(Boolean).sort(),
      isSecret: r.is_secret === 1,
      sampleFile: r.sample_file,
    })),
    govRules: govRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      scopePrefix: r.scope_prefix,
      symbol: r.symbol,
      text: r.text,
      rationale: r.rationale,
      file: r.file,
      line: r.line > 0 ? r.line : undefined,
    })),
    docDriftCount: driftRow.cnt,
  };
}

export function queryVerificationCoverage(
  db: Database,
  invariants: SqlInvariantResult[],
  realCoverage?: RealCoverageReport | null,
): VerificationCoverage {
  const totalRow = db
    .query("SELECT COUNT(*) AS cnt FROM v_prod_files WHERE is_barrel = 0")
    .get() as { cnt: number };
  const testedRow = db
    .query(
      `SELECT COUNT(DISTINCT fi.to_file) AS cnt
       FROM file_imports fi
       JOIN files tf ON tf.file = fi.from_file AND tf.is_test = 1
       JOIN v_prod_files pf ON pf.file = fi.to_file AND pf.is_barrel = 0
       WHERE fi.type_only = 0`,
    )
    .get() as { cnt: number };
  const gatesRow = db
    .query("SELECT COUNT(*) AS cnt FROM nodes WHERE kind = 'quality_gate'")
    .get() as { cnt: number };
  const unwiredRows = db
    .query(
      `SELECT n.label FROM nodes n
       LEFT JOIN edges e ON e.to_id = n.id AND e.kind = 'enforces_in_ci'
       WHERE n.kind = 'quality_gate' AND e.from_id IS NULL
       ORDER BY n.label ASC`,
    )
    .all() as Array<{ label: string }>;

  const total = totalRow.cnt;
  const tested = testedRow.cnt;
  const pct = total > 0 ? Math.round((tested / total) * 1000) / 10 : 0;

  return {
    totalSourceFiles: total,
    directlyTestedSourceFiles: tested,
    directTestCoveragePct: pct,
    coverageSource: realCoverage ? realCoverage.source : "static_reachability_1hop",
    realLineCoveragePct: realCoverage ? realCoverage.linePct : null,
    realBranchCoveragePct: realCoverage ? realCoverage.branchPct : null,
    coverageReportFile: realCoverage ? realCoverage.reportFile : null,
    registeredGates: gatesRow.cnt,
    ciWiredGates: gatesRow.cnt - unwiredRows.length,
    unwiredGateNames: unwiredRows.map((r) => r.label),
    invariantsPassed: invariants.filter((i) => i.status === "pass").length,
    invariantsWarned: invariants.filter((i) => i.status === "warn").length,
    invariantsFailed: invariants.filter((i) => i.status === "fail").length,
    invariantsNa: invariants.filter((i) => i.status === "na").length,
  };
}

export const NAMED_QUERIES: Record<string, string> = {
  entity_owners: `SELECT ea.datastore, ea.entity, COUNT(*) AS refs, GROUP_CONCAT(DISTINCT ea.layer) AS layers, GROUP_CONCAT(DISTINCT ea.domain_area) AS domains FROM entity_access ea JOIN v_prod_files f ON f.file = ea.file GROUP BY ea.datastore, ea.entity ORDER BY refs DESC LIMIT 40;`,
  state_machines: `SELECT id, name, language, unit, evidence, state_count, transition_count, file, line FROM state_machines ORDER BY transition_count DESC, name ASC;`,
  loops: `SELECT id, name, kind, schedule, unit, file, line FROM loops ORDER BY unit ASC, name ASC;`,
  violations: `SELECT rule_id, severity, subject, detail, file, line FROM invariant_evidence ORDER BY severity ASC, rule_id ASC, file ASC LIMIT 100;`,
  unverified_surfaces: `SELECT u.id, u.name, u.kind FROM units u LEFT JOIN edges e ON e.to_id = u.id AND e.kind = 'verifies' WHERE u.kind IN ('app', 'package') AND e.from_id IS NULL ORDER BY u.id ASC;`,
  http_endpoints: `SELECT unit, method, path, auth_guard, source, handler_file, line FROM http_endpoints ORDER BY unit ASC, path ASC LIMIT 100;`,
  fk_cascades: `SELECT from_table, from_column, to_table, to_column, on_delete, declared_at FROM db_foreign_keys WHERE on_delete = 'CASCADE' ORDER BY to_table ASC, from_table ASC LIMIT 100;`,
  env_bindings: `SELECT env_name, GROUP_CONCAT(DISTINCT source_kind) AS sources, GROUP_CONCAT(DISTINCT unit) AS units, MAX(is_secret) AS is_secret FROM env_bindings GROUP BY env_name ORDER BY is_secret DESC, env_name ASC LIMIT 100;`,
  gov_rules: `SELECT id, kind, scope_prefix, symbol, text, rationale, file, line FROM gov_rules ORDER BY kind ASC, scope_prefix ASC LIMIT 100;`,
  doc_drift: `SELECT doc_file, line, referenced_path FROM v_doc_drift ORDER BY doc_file ASC, line ASC;`,
  modules: `SELECT unit_slug, name, level, role, depth, file_count, lines, export_count, fan_in, fan_out, in_tangle, capabilities FROM module_cards ORDER BY unit_slug ASC, level ASC, name ASC LIMIT 200;`,
  tangles: `SELECT unit_slug, tangle_id, name, level, fan_in, fan_out, lines FROM module_cards WHERE in_tangle = 1 ORDER BY unit_slug ASC, tangle_id ASC, name ASC;`,
};
