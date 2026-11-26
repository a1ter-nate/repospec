import type { Database } from "bun:sqlite";

export function initIndexDbSchema(db: Database): void {
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
      exports_count INTEGER NOT NULL,
      runtime_exports_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE file_coverage (
      file TEXT PRIMARY KEY,
      line_pct REAL NOT NULL
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
}
