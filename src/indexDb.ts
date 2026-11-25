import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AstIndexData,
  CatalogArtifact,
  EntityOwnership,
  EnvBindingSummary,
  ForeignKeySummary,
  GovRuleSummary,
  HttpEndpointSummary,
  InvariantEvidence,
  LoopRecord,
  ModuleCard,
  Rung,
  SpecDiagnostic,
  SpecEdge,
  SpecNode,
  SpecRule,
  SqlInvariantResult,
  StateMachineRecord,
  UnitDescriptor,
  VerificationCoverage,
} from "./schema.ts";
import { resolveLayerSemantics } from "./taxonomy.ts";

interface SqlRuleFrontMatter {
  id: string;
  name: string;
  rung: Rung;
  severity: "error" | "warn" | "info";
  statement: string;
  why: string;
  fix: string;
  applicabilitySql: string | null;
}

function parseSqlFrontMatter(sqlText: string, fileName: string): SqlRuleFrontMatter | null {
  const fields: Record<string, string> = {};
  for (const line of sqlText.split("\n")) {
    const m = line.match(/^--\s*@([a-zA-Z_]+):\s*(.+)$/);
    if (m?.[1] && m[2]) {
      fields[m[1].toLowerCase()] = m[2].trim();
    } else if (line.trim() && !line.trim().startsWith("--")) {
      break;
    }
  }
  const rung = fields.rung as Rung | undefined;
  const severity = fields.severity as "error" | "warn" | "info" | undefined;
  if (!fields.id || !fields.name || !rung || !severity || !fields.statement) {
    return null;
  }
  return {
    id: fields.id,
    name: fields.name,
    rung,
    severity,
    statement: fields.statement,
    why: fields.why ?? `Architectural invariant defined in rules/${fileName}`,
    fix: fields.fix ?? "Resolve the reported structural violation.",
    applicabilitySql: fields.applicability ?? null,
  };
}

export function createAndPopulateIndexDb(params: {
  dbPath: string;
  repoName: string;
  commitSha: string | null;
  scopeRootRel: string;
  units: UnitDescriptor[];
  nodes: SpecNode[];
  edges: SpecEdge[];
  rules: SpecRule[];
  ast: AstIndexData;
  stateMachines: StateMachineRecord[];
  loops: LoopRecord[];
  catalogArtifacts: CatalogArtifact[];
  modules?: ModuleCard[];
}): Database {
  const {
    dbPath,
    repoName,
    commitSha,
    scopeRootRel,
    units,
    nodes,
    edges,
    rules,
    ast,
    stateMachines,
    loops,
    catalogArtifacts,
    modules = [],
  } = params;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;

    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL,
      dir TEXT NOT NULL,
      ecosystem TEXT NOT NULL,
      kind TEXT NOT NULL,
      archetype TEXT NOT NULL,
      layer_policy TEXT NOT NULL,
      has_persistence_layer INTEGER NOT NULL DEFAULT 0,
      has_integration_layer INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      kind TEXT NOT NULL,
      role TEXT,
      label TEXT NOT NULL,
      grp TEXT,
      owner_id TEXT,
      file TEXT NOT NULL,
      line INTEGER
    );

    CREATE TABLE edges (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT,
      weight INTEGER DEFAULT 1,
      violation INTEGER DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'observed',
      file TEXT,
      line INTEGER
    );

    CREATE TABLE rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      enforcement TEXT NOT NULL,
      rung TEXT NOT NULL,
      statement TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER
    );

    CREATE TABLE rule_targets (
      rule_id TEXT NOT NULL,
      target TEXT NOT NULL
    );

    CREATE TABLE files (
      file TEXT PRIMARY KEY,
      unit TEXT NOT NULL,
      language TEXT NOT NULL,
      layer TEXT NOT NULL,
      canonical_layer TEXT NOT NULL,
      layer_axis TEXT NOT NULL DEFAULT 'foundation',
      layer_rank INTEGER NOT NULL DEFAULT 5,
      domain_area TEXT,
      layer_source TEXT NOT NULL,
      domain_source TEXT NOT NULL,
      is_test INTEGER NOT NULL,
      is_barrel INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      exports_count INTEGER NOT NULL
    );

    CREATE TABLE file_imports (
      from_file TEXT NOT NULL,
      to_file TEXT NOT NULL,
      from_unit TEXT NOT NULL,
      to_unit TEXT NOT NULL,
      from_layer TEXT NOT NULL,
      to_layer TEXT NOT NULL,
      from_canonical_layer TEXT NOT NULL,
      to_canonical_layer TEXT NOT NULL,
      from_domain TEXT,
      to_domain TEXT,
      line INTEGER NOT NULL,
      type_only INTEGER NOT NULL
    );

    CREATE TABLE pkg_imports (
      from_file TEXT NOT NULL,
      unit TEXT NOT NULL,
      layer TEXT NOT NULL,
      canonical_layer TEXT NOT NULL,
      pkg TEXT NOT NULL,
      vendor_category TEXT,
      line INTEGER NOT NULL,
      type_only INTEGER NOT NULL
    );

    CREATE TABLE declared_entities (
      datastore TEXT NOT NULL,
      entity TEXT NOT NULL,
      declared_at TEXT NOT NULL,
      authorized_shared INTEGER NOT NULL,
      has_tenancy_key INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (datastore, entity)
    );

    CREATE TABLE entity_access (
      datastore TEXT NOT NULL,
      entity TEXT NOT NULL,
      file TEXT NOT NULL,
      unit TEXT NOT NULL,
      layer TEXT NOT NULL,
      canonical_layer TEXT NOT NULL,
      domain_area TEXT,
      op TEXT NOT NULL,
      line INTEGER NOT NULL,
      confidence TEXT NOT NULL
    );

    CREATE TABLE external_hosts (
      file TEXT NOT NULL,
      unit TEXT NOT NULL,
      layer TEXT NOT NULL,
      canonical_layer TEXT NOT NULL,
      host TEXT NOT NULL,
      service_label TEXT NOT NULL,
      category TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE state_enums (
      file TEXT NOT NULL,
      unit TEXT NOT NULL,
      language TEXT NOT NULL,
      name TEXT NOT NULL,
      values_signature TEXT NOT NULL,
      line INTEGER NOT NULL,
      has_transitions INTEGER NOT NULL
    );

    CREATE TABLE state_machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      unit TEXT NOT NULL,
      evidence TEXT NOT NULL,
      state_count INTEGER NOT NULL,
      transition_count INTEGER NOT NULL,
      file TEXT NOT NULL,
      line INTEGER
    );

    CREATE TABLE loops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      schedule TEXT,
      unit TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER
    );

    CREATE TABLE http_endpoints (
      unit TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      auth_guard TEXT,
      source TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT 'mounted',
      handler_file TEXT NOT NULL,
      line INTEGER NOT NULL,
      operation_id TEXT
    );

    CREATE TABLE db_foreign_keys (
      datastore TEXT NOT NULL,
      from_table TEXT NOT NULL,
      from_column TEXT NOT NULL,
      to_table TEXT NOT NULL,
      to_column TEXT NOT NULL,
      on_delete TEXT,
      declared_at TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE env_bindings (
      env_name TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      unit TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      is_secret INTEGER NOT NULL
    );

    CREATE TABLE gov_rules (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope_prefix TEXT NOT NULL,
      symbol TEXT,
      text TEXT NOT NULL,
      rationale TEXT,
      file TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE doc_path_refs (
      doc_file TEXT NOT NULL,
      line INTEGER NOT NULL,
      referenced_path TEXT NOT NULL,
      exists_in_repo INTEGER NOT NULL
    );

    CREATE TABLE catalog_artifacts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      file TEXT NOT NULL,
      owner_unit_id TEXT
    );

    CREATE TABLE module_cards (
      id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL,
      unit_name TEXT NOT NULL,
      unit_slug TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      language TEXT NOT NULL,
      level INTEGER NOT NULL,
      role TEXT NOT NULL,
      depth TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      export_count INTEGER NOT NULL,
      fan_in INTEGER NOT NULL,
      fan_out INTEGER NOT NULL,
      in_tangle INTEGER NOT NULL,
      tangle_id TEXT,
      capabilities TEXT NOT NULL
    );

    CREATE TABLE file_symbols (
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE invariant_results (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rung TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      applicability_reason TEXT,
      statement TEXT NOT NULL,
      violation_count INTEGER NOT NULL
    );

    CREATE TABLE invariant_evidence (
      rule_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      subject TEXT NOT NULL,
      detail TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      target_node_id TEXT,
      edge_from_id TEXT,
      edge_to_id TEXT,
      edge_kind TEXT
    );

    CREATE INDEX idx_edges_from ON edges(from_id);
    CREATE INDEX idx_edges_to ON edges(to_id);
    CREATE INDEX idx_edges_kind ON edges(kind);
    CREATE INDEX idx_file_imports_to ON file_imports(to_file);
    CREATE INDEX idx_file_imports_from ON file_imports(from_file);
    CREATE INDEX idx_entity_access_entity ON entity_access(datastore, entity);
    CREATE INDEX idx_entity_access_file ON entity_access(file);
    CREATE INDEX idx_inv_evidence_file ON invariant_evidence(file);
    CREATE INDEX idx_http_endpoints_unit ON http_endpoints(unit);
    CREATE INDEX idx_env_bindings_name ON env_bindings(env_name);

    CREATE VIEW v_prod_files AS
    SELECT
      f.*,
      u.id AS unit_id,
      u.slug AS unit_slug,
      u.archetype AS unit_archetype,
      u.layer_policy,
      u.has_persistence_layer,
      u.has_integration_layer
    FROM files f
    LEFT JOIN units u ON u.name = f.unit
    WHERE f.is_test = 0
      AND f.canonical_layer NOT IN ('tests', 'ops_script');

    CREATE VIEW v_prod_imports AS
    SELECT
      fi.*,
      f1.unit_id AS from_unit_id,
      f1.unit_slug AS from_unit_slug,
      f1.unit_archetype AS from_archetype,
      f1.layer_policy AS from_layer_policy,
      f2.unit_id AS to_unit_id,
      f2.unit_slug AS to_unit_slug,
      f2.unit_archetype AS to_archetype,
      f2.layer_policy AS to_layer_policy
    FROM file_imports fi
    JOIN v_prod_files f1 ON f1.file = fi.from_file
    JOIN v_prod_files f2 ON f2.file = fi.to_file
    WHERE fi.type_only = 0;

    CREATE VIEW v_doc_drift AS
    SELECT doc_file, line, referenced_path
    FROM doc_path_refs
    WHERE exists_in_repo = 0;

    CREATE VIEW v_file_passport AS
    SELECT
      f.file,
      f.unit,
      COALESCE(u.id, 'arch:app:' || f.unit) AS unit_id,
      COALESCE(u.archetype, 'library_crate') AS unit_archetype,
      COALESCE(u.layer_policy, 'flat_library') AS layer_policy,
      f.language,
      f.layer AS raw_layer,
      f.canonical_layer,
      f.domain_area,
      f.layer_source,
      f.domain_source,
      f.is_test,
      f.is_barrel,
      f.lines,
      f.exports_count,
      (SELECT COUNT(DISTINCT fi.from_file) FROM file_imports fi JOIN files ff ON ff.file = fi.from_file AND ff.is_test = 0 WHERE fi.to_file = f.file AND fi.type_only = 0) AS prod_fan_in,
      (SELECT COUNT(DISTINCT fi.to_file) FROM file_imports fi WHERE fi.from_file = f.file AND fi.type_only = 0) AS fan_out,
      (SELECT COUNT(DISTINCT fi.from_file) FROM file_imports fi JOIN files tf ON tf.file = fi.from_file AND tf.is_test = 1 WHERE fi.to_file = f.file) AS direct_test_importers,
      (SELECT COUNT(*) FROM invariant_evidence ie WHERE ie.file = f.file) AS active_violation_count
    FROM files f
    LEFT JOIN units u ON u.name = f.unit;

    CREATE VIEW v_unit_passport AS
    SELECT
      u.id,
      u.name,
      u.slug,
      u.dir,
      u.ecosystem,
      u.kind,
      u.archetype,
      u.layer_policy,
      u.has_persistence_layer,
      u.has_integration_layer,
      COUNT(CASE WHEN f.is_test = 0 AND f.canonical_layer != 'ops_script' THEN 1 END) AS prod_files,
      COUNT(CASE WHEN f.is_test = 1 THEN 1 END) AS test_files,
      COALESCE(SUM(CASE WHEN f.is_test = 0 THEN f.lines ELSE 0 END), 0) AS prod_lines,
      (SELECT COUNT(*) FROM http_endpoints he WHERE he.unit = u.name) AS endpoint_count,
      (SELECT COUNT(*) FROM invariant_evidence ie JOIN files vf ON vf.file = ie.file WHERE vf.unit = u.name) AS violation_count
    FROM units u
    LEFT JOIN files f ON f.unit = u.name
    GROUP BY u.id, u.name, u.slug, u.dir, u.ecosystem, u.kind, u.archetype, u.layer_policy, u.has_persistence_layer, u.has_integration_layer;
  `);

  const unitsWithExplicitPersistence = new Set<string>();
  const unitsWithExplicitIntegration = new Set<string>();
  for (const f of ast.files) {
    if (f.isTest || f.layerSource === "token_heuristic") continue;
    if (f.canonicalLayer === "persistence") unitsWithExplicitPersistence.add(f.unit);
    if (f.canonicalLayer === "integration") unitsWithExplicitIntegration.add(f.unit);
  }

  const effectiveUnits: UnitDescriptor[] =
    units.length > 0
      ? units
      : [
          {
            id: `arch:app:${repoName}`,
            name: repoName,
            slug: repoName.replace(/^@[^/]+\//, ""),
            dir: ".",
            absDir: ".",
            manifestFile: ".",
            ecosystem: "typescript",
            kind: "app",
            archetype: "library_crate",
            layerPolicy: "flat_library",
            external: false,
            entryFile: null,
            targetFramework: null,
            bins: [],
          },
        ];

  const insertMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  const insertUnit = db.prepare(
    "INSERT OR IGNORE INTO units (id, name, slug, dir, ecosystem, kind, archetype, layer_policy, has_persistence_layer, has_integration_layer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertNode = db.prepare(
    "INSERT OR IGNORE INTO nodes (id, domain, kind, role, label, grp, owner_id, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEdge = db.prepare(
    "INSERT INTO edges (from_id, to_id, kind, label, weight, violation, confidence, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRule = db.prepare(
    "INSERT OR IGNORE INTO rules (id, name, category, enforcement, rung, statement, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRuleTarget = db.prepare("INSERT INTO rule_targets (rule_id, target) VALUES (?, ?)");
  const insertFile = db.prepare(
    "INSERT OR IGNORE INTO files (file, unit, language, layer, canonical_layer, layer_axis, layer_rank, domain_area, layer_source, domain_source, is_test, is_barrel, lines, exports_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFileImport = db.prepare(
    "INSERT INTO file_imports (from_file, to_file, from_unit, to_unit, from_layer, to_layer, from_canonical_layer, to_canonical_layer, from_domain, to_domain, line, type_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertPkgImport = db.prepare(
    "INSERT INTO pkg_imports (from_file, unit, layer, canonical_layer, pkg, vendor_category, line, type_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDeclaredEntity = db.prepare(
    "INSERT OR IGNORE INTO declared_entities (datastore, entity, declared_at, authorized_shared, has_tenancy_key) VALUES (?, ?, ?, ?, ?)",
  );
  const insertEntityAccess = db.prepare(
    "INSERT INTO entity_access (datastore, entity, file, unit, layer, canonical_layer, domain_area, op, line, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertHost = db.prepare(
    "INSERT INTO external_hosts (file, unit, layer, canonical_layer, host, service_label, category, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEnum = db.prepare(
    "INSERT INTO state_enums (file, unit, language, name, values_signature, line, has_transitions) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertSm = db.prepare(
    "INSERT OR IGNORE INTO state_machines (id, name, language, unit, evidence, state_count, transition_count, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertLoop = db.prepare(
    "INSERT OR IGNORE INTO loops (id, name, kind, schedule, unit, file, line) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEndpoint = db.prepare(
    "INSERT INTO http_endpoints (unit, method, path, auth_guard, source, resolution, handler_file, line, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFk = db.prepare(
    "INSERT INTO db_foreign_keys (datastore, from_table, from_column, to_table, to_column, on_delete, declared_at, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEnv = db.prepare(
    "INSERT INTO env_bindings (env_name, source_kind, unit, file, line, is_secret) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertGovRule = db.prepare(
    "INSERT OR IGNORE INTO gov_rules (id, kind, scope_prefix, symbol, text, rationale, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDocRef = db.prepare(
    "INSERT INTO doc_path_refs (doc_file, line, referenced_path, exists_in_repo) VALUES (?, ?, ?, ?)",
  );
  const insertCatalog = db.prepare(
    "INSERT OR IGNORE INTO catalog_artifacts (id, kind, file, owner_unit_id) VALUES (?, ?, ?, ?)",
  );
  const insertModuleCard = db.prepare(
    "INSERT OR REPLACE INTO module_cards (id, unit_id, unit_name, unit_slug, name, kind, rel_path, language, level, role, depth, file_count, lines, export_count, fan_in, fan_out, in_tangle, tangle_id, capabilities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFileSymbol = db.prepare(
    "INSERT INTO file_symbols (file, name, kind, line) VALUES (?, ?, ?, ?)",
  );

  db.transaction(() => {
    insertMeta.run("schemaVersion", "5.0.0");
    insertMeta.run("repoName", repoName);
    insertMeta.run("commitSha", commitSha ?? "");
    insertMeta.run("scopeRootRel", scopeRootRel);

    for (const u of effectiveUnits) {
      insertUnit.run(
        u.id,
        u.name,
        u.slug,
        u.dir,
        u.ecosystem,
        u.kind,
        u.archetype,
        u.layerPolicy,
        unitsWithExplicitPersistence.has(u.name) ? 1 : 0,
        unitsWithExplicitIntegration.has(u.name) ? 1 : 0,
      );
    }
    for (const n of nodes) {
      insertNode.run(
        n.id,
        n.domain,
        n.kind,
        n.role ?? null,
        n.label,
        n.group ?? null,
        n.ownerId ?? null,
        n.provenance.file,
        n.provenance.line ?? null,
      );
    }
    for (const e of edges) {
      insertEdge.run(
        e.from,
        e.to,
        e.kind,
        e.label ?? null,
        e.weight ?? 1,
        e.violation ? 1 : 0,
        e.confidence,
        e.provenance?.file ?? null,
        e.provenance?.line ?? null,
      );
    }
    for (const r of rules) {
      insertRule.run(r.id, r.name, r.category, r.enforcement, r.rung, r.statement, r.provenance.file, r.provenance.line ?? null);
      for (const t of r.targets) insertRuleTarget.run(r.id, t);
    }
    for (const f of ast.files) {
      const sem = resolveLayerSemantics(f.layer, f.canonicalLayer);
      insertFile.run(
        f.file,
        f.unit,
        f.language,
        f.layer,
        f.canonicalLayer,
        sem.axis,
        sem.rank,
        f.domainArea,
        f.layerSource,
        f.domainSource,
        f.isTest ? 1 : 0,
        f.isBarrel ? 1 : 0,
        f.lines,
        f.exportsCount,
      );
      for (const sym of f.exportedSymbols ?? []) {
        insertFileSymbol.run(f.file, sym.name, sym.kind, sym.line);
      }
    }
    for (const m of modules) {
      insertModuleCard.run(
        m.id,
        m.unitId,
        m.unitName,
        m.unitSlug,
        m.name,
        m.kind,
        m.relPath,
        m.language,
        m.level,
        m.role,
        m.depth,
        m.fileCount,
        m.lines,
        m.exportCount,
        m.fanIn,
        m.fanOut,
        m.inTangle ? 1 : 0,
        m.tangleId,
        m.capabilities.join(","),
      );
    }
    for (const fi of ast.fileImports) {
      insertFileImport.run(
        fi.fromFile,
        fi.toFile,
        fi.fromUnit,
        fi.toUnit,
        fi.fromLayer,
        fi.toLayer,
        fi.fromCanonicalLayer,
        fi.toCanonicalLayer,
        fi.fromDomain,
        fi.toDomain,
        fi.line,
        fi.typeOnly ? 1 : 0,
      );
    }
    for (const pi of ast.pkgImports) {
      insertPkgImport.run(
        pi.fromFile,
        pi.unit,
        pi.layer,
        pi.canonicalLayer,
        pi.pkg,
        pi.vendorCategory,
        pi.line,
        pi.typeOnly ? 1 : 0,
      );
    }
    for (const de of ast.declaredEntities) {
      insertDeclaredEntity.run(
        de.datastore,
        de.entity,
        de.declaredAt,
        de.authorizedShared ? 1 : 0,
        de.hasTenancyKey ? 1 : 0,
      );
    }
    for (const ea of ast.entityAccesses) {
      insertEntityAccess.run(
        ea.datastore,
        ea.entity,
        ea.file,
        ea.unit,
        ea.layer,
        ea.canonicalLayer,
        ea.domainArea,
        ea.op,
        ea.line,
        ea.confidence,
      );
    }
    for (const h of ast.externalHosts) {
      insertHost.run(h.file, h.unit, h.layer, h.canonicalLayer, h.host, h.serviceLabel, h.category, h.line);
    }
    for (const se of ast.stateEnums) {
      insertEnum.run(se.file, se.unit, se.language, se.name, se.valuesSignature, se.line, se.hasTransitions ? 1 : 0);
    }
    for (const sm of stateMachines) {
      insertSm.run(sm.id, sm.name, sm.language, sm.unit, sm.evidence, sm.states.length, sm.transitions.length, sm.provenance.file, sm.provenance.line ?? null);
    }
    for (const lp of loops) {
      insertLoop.run(lp.id, lp.name, lp.kind, lp.schedule, lp.unit, lp.provenance.file, lp.provenance.line ?? null);
    }
    for (const ep of ast.httpEndpoints) {
      const res = ep.resolution ?? (ep.source === "openapi" ? "contract" : "mounted");
      insertEndpoint.run(ep.unit, ep.method, ep.path, ep.authGuard, ep.source, res, ep.handlerFile, ep.line, ep.operationId);
    }
    for (const fk of ast.dbForeignKeys) {
      insertFk.run(fk.datastore, fk.fromTable, fk.fromColumn, fk.toTable, fk.toColumn, fk.onDelete, fk.declaredAt, fk.line);
    }
    for (const env of ast.envBindings) {
      insertEnv.run(env.envName, env.sourceKind, env.unit, env.file, env.line, env.isSecret ? 1 : 0);
    }
    for (const gr of ast.govRules) {
      insertGovRule.run(gr.id, gr.kind, gr.scopePrefix, gr.symbol, gr.text, gr.rationale, gr.file, gr.line);
    }
    for (const dr of ast.docPathRefs) {
      insertDocRef.run(dr.docFile, dr.line, dr.referencedPath, dr.existsInRepo ? 1 : 0);
    }
    for (const ca of catalogArtifacts) {
      insertCatalog.run(ca.id, ca.kind, ca.file, ca.ownerUnitId);
    }
  })();

  return db;
}

export function runSqlInvariants(
  db: Database,
  rulesDir: string,
  diagnostics: SpecDiagnostic[],
): SqlInvariantResult[] {
  const results: SqlInvariantResult[] = [];
  if (!fs.existsSync(rulesDir)) return results;

  const insertInvRes = db.prepare(
    "INSERT OR REPLACE INTO invariant_results (id, name, rung, severity, status, applicability_reason, statement, violation_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertInvEv = db.prepare(
    "INSERT INTO invariant_evidence (rule_id, severity, subject, detail, file, line, target_node_id, edge_from_id, edge_to_id, edge_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const sqlFiles = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of sqlFiles) {
    const absSql = path.join(rulesDir, file);
    const sqlText = fs.readFileSync(absSql, "utf8");
    const meta = parseSqlFrontMatter(sqlText, file);
    if (!meta) {
      diagnostics.push({
        code: "sql.invalid-frontmatter",
        severity: "warn",
        message: `Skipping rules/${file}: missing @id/@name/@rung/@severity/@statement front-matter.`,
      });
      continue;
    }

    if (meta.applicabilitySql) {
      try {
        const appRow = db.query(meta.applicabilitySql).get() as Record<string, unknown> | null;
        const firstVal = appRow ? Object.values(appRow)[0] : null;
        if (typeof firstVal === "string" && firstVal.trim().length > 0) {
          insertInvRes.run(meta.id, meta.name, meta.rung, meta.severity, "na", firstVal, meta.statement, 0);
          results.push({
            id: meta.id,
            name: meta.name,
            rung: meta.rung,
            severity: meta.severity,
            status: "na",
            applicabilityReason: firstVal,
            sqlFile: `rules/${file}`,
            statement: meta.statement,
            why: meta.why,
            fix: meta.fix,
            violationCount: 0,
            evidence: [],
          });
          continue;
        }
      } catch (err) {
        diagnostics.push({
          code: "sql.applicability-error",
          severity: "warn",
          message: `Applicability query failed in rules/${file}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = db.query(sqlText).all() as Array<Record<string, unknown>>;
    } catch (err) {
      diagnostics.push({
        code: "sql.rule-error",
        severity: "warn",
        message: `SQL invariant rules/${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const allEvidence: InvariantEvidence[] = rows.map((row) => {
      const targetNodeId = typeof row.target_node_id === "string" ? row.target_node_id : undefined;
      const edgeFromId = typeof row.edge_from_id === "string" ? row.edge_from_id : undefined;
      const edgeToId = typeof row.edge_to_id === "string" ? row.edge_to_id : undefined;
      const edgeKind = typeof row.edge_kind === "string" ? row.edge_kind : undefined;
      const line = typeof row.line === "number" && row.line > 0 ? Math.floor(row.line) : undefined;
      return {
        subject: String(row.subject ?? "unknown"),
        detail: String(row.detail ?? meta.statement),
        file: String(row.file ?? "."),
        ...(line ? { line } : {}),
        ...(targetNodeId ? { targetNodeId } : {}),
        ...(edgeFromId ? { edgeFromId } : {}),
        ...(edgeToId ? { edgeToId } : {}),
        ...(edgeKind ? { edgeKind } : {}),
      };
    });

    const status: "pass" | "warn" | "fail" =
      allEvidence.length === 0 ? "pass" : meta.severity === "error" ? "fail" : "warn";

    db.transaction(() => {
      insertInvRes.run(meta.id, meta.name, meta.rung, meta.severity, status, null, meta.statement, allEvidence.length);
      for (const ev of allEvidence) {
        insertInvEv.run(
          meta.id,
          meta.severity,
          ev.subject,
          ev.detail,
          ev.file,
          ev.line ?? 1,
          ev.targetNodeId ?? null,
          ev.edgeFromId ?? null,
          ev.edgeToId ?? null,
          ev.edgeKind ?? null,
        );
      }
    })();

    results.push({
      id: meta.id,
      name: meta.name,
      rung: meta.rung,
      severity: meta.severity,
      status,
      sqlFile: `rules/${file}`,
      statement: meta.statement,
      why: meta.why,
      fix: meta.fix,
      violationCount: allEvidence.length,
      evidence: allEvidence.slice(0, 30),
    });
  }

  return results;
}

export function projectInvariantsToGraph(
  nodes: SpecNode[],
  edges: SpecEdge[],
  invariants: SqlInvariantResult[],
): { nodes: SpecNode[]; edges: SpecEdge[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeFindingMap = new Map<string, Map<string, { severity: "error" | "warn" | "info"; count: number }>>();
  const edgeByPair = new Map<string, SpecEdge[]>();

  for (const e of edges) {
    const key = `${e.from}|${e.to}`;
    const list = edgeByPair.get(key) ?? [];
    list.push(e);
    edgeByPair.set(key, list);
  }

  const addNodeFinding = (nodeId: string, ruleId: string, severity: "error" | "warn" | "info"): void => {
    if (!nodeById.has(nodeId)) return;
    let map = nodeFindingMap.get(nodeId);
    if (!map) {
      map = new Map();
      nodeFindingMap.set(nodeId, map);
    }
    const cur = map.get(ruleId);
    if (cur) cur.count += 1;
    else map.set(ruleId, { severity, count: 1 });

    const ownerId = nodeById.get(nodeId)?.ownerId;
    if (ownerId && ownerId !== nodeId && nodeById.has(ownerId)) {
      let oMap = nodeFindingMap.get(ownerId);
      if (!oMap) {
        oMap = new Map();
        nodeFindingMap.set(ownerId, oMap);
      }
      const oCur = oMap.get(ruleId);
      if (oCur) oCur.count += 1;
      else oMap.set(ruleId, { severity, count: 1 });
    }
  };

  for (const inv of invariants) {
    if (inv.status === "pass" || inv.status === "na") continue;
    for (const ev of inv.evidence) {
      if (ev.targetNodeId && nodeById.has(ev.targetNodeId)) {
        addNodeFinding(ev.targetNodeId, inv.id, inv.severity);
      }

      if (ev.edgeFromId && ev.edgeToId) {
        const direct = edgeByPair.get(`${ev.edgeFromId}|${ev.edgeToId}`) ?? [];
        const reverse = inv.id === "sql:bidirectional-domain-coupling"
          ? (edgeByPair.get(`${ev.edgeToId}|${ev.edgeFromId}`) ?? [])
          : [];
        const matches = [...direct, ...reverse];
        for (const edge of matches) {
          if (inv.severity === "error" || inv.severity === "warn") {
            edge.violation = true;
          }
          const rulesSet = new Set(edge.ruleIds ?? []);
          rulesSet.add(inv.id);
          edge.ruleIds = Array.from(rulesSet).sort();
          const curEv = edge.evidence ?? [];
          if (!curEv.some((x) => x.file === ev.file && x.line === ev.line)) {
            edge.evidence = [...curEv, { file: ev.file, line: ev.line, detail: ev.detail }].slice(0, 15);
          }
        }
        if (matches.length === 0 && nodeById.has(ev.edgeFromId)) {
          addNodeFinding(ev.edgeFromId, inv.id, inv.severity);
        }
      }
    }
  }

  for (const node of nodes) {
    const map = nodeFindingMap.get(node.id);
    if (map && map.size > 0) {
      node.findings = Array.from(map.entries())
        .map(([ruleId, info]) => ({ ruleId, severity: info.severity, count: info.count }))
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.ruleId.localeCompare(b.ruleId)));
    }
  }

  return { nodes, edges };
}

export function storeDigestInDb(dbPath: string, digest: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('specDigest', ?)").run(digest);
  } finally {
    db.close();
  }
}

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
): VerificationCoverage {
  const totalRow = db
    .query("SELECT COUNT(*) AS cnt FROM v_prod_files WHERE is_barrel = 0")
    .get() as { cnt: number };
  const testedRow = db
    .query(
      `SELECT COUNT(DISTINCT fi.to_file) AS cnt
       FROM file_imports fi
       JOIN files tf ON tf.file = fi.from_file AND tf.is_test = 1
       JOIN v_prod_files pf ON pf.file = fi.to_file AND pf.is_barrel = 0`,
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
