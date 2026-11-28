-- @id: sql:runtime-imports-ops-script
-- @name: Production App Imports a Developer or Ops Script
-- @rung: R1
-- @severity: error
-- @statement: Production application code imports a file from a scripts/, tools/, bin/, or examples/ folder meant only for one-off developer or operational tasks.
-- @why: Dev/ops scripts skip production safety guards, often pull in dev-only packages, and can crash production builds or bundles unexpectedly.
-- @fix: Move the shared helper function into a proper production library module and import it from both the app and the script.
-- @benefit: Keeps production bundles lean, predictable, and free of fragile CLI or dev-only dependencies.
-- @source: Parnas (1972) — On the Criteria To Be Used in Decomposing Systems into Modules | https://dl.acm.org/doi/10.1145/361598.361623
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE canonical_layer = 'ops_script') = 0 THEN 'No operational script files indexed' ELSE NULL END
SELECT
  fi.from_file || ' -> ' || fi.to_file AS subject,
  'Runtime module ' || fi.from_file || ' imports ops_script ' || fi.to_file AS detail,
  fi.from_file AS file,
  fi.line AS line,
  f1.unit_id AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM file_imports fi
JOIN v_prod_files f1 ON f1.file = fi.from_file
JOIN files f2 ON f2.file = fi.to_file
WHERE fi.type_only = 0
  AND f2.canonical_layer = 'ops_script'
  AND fi.from_file NOT LIKE '.github/%'
  AND fi.from_file NOT LIKE '%.test.%'
  AND fi.from_file NOT LIKE '%.spec.%'
ORDER BY fi.from_file ASC, fi.line ASC;
