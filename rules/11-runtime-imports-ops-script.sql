-- @id: sql:runtime-imports-ops-script
-- @name: Production Runtime Code Must Not Import Operational Scripts
-- @rung: R1
-- @severity: error
-- @statement: Runtime production modules must not import files from scripts/, tools/, bin/, or examples/ operational directories.
-- @why: Operational scripts bypass runtime guards and pull CLI-only dependencies into production bundles.
-- @fix: Move shared logic into a production library or domain module and import it from both runtime and scripts.
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
ORDER BY fi.from_file ASC, fi.line ASC;
