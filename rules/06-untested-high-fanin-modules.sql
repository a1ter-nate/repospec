-- @id: sql:untested-high-fanin-modules
-- @name: High Fan-In Runtime Modules Must Have Test Reachability or Line Coverage
-- @rung: R2
-- @severity: warn
-- @statement: Non-barrel runtime production modules imported by >= 8 production files (excluding type-only imports and type-only modules) should have recorded line coverage or static test reachability within 1 import hop.
-- @why: High fan-in runtime modules are blast-radius multipliers; untested hubs magnify regressions across dependent units.
-- @fix: Add direct unit tests or cover an immediate caller in the test suite.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM v_prod_files WHERE is_barrel = 0 AND runtime_exports_count > 0) = 0 THEN 'No non-barrel runtime production files indexed' ELSE NULL END
WITH prod_fanin AS (
  SELECT fi.to_file AS file, COUNT(DISTINCT fi.from_file) AS fanin
  FROM file_imports fi
  JOIN v_prod_files src ON src.file = fi.from_file
  WHERE fi.type_only = 0
  GROUP BY fi.to_file
),
direct_tested AS (
  SELECT DISTINCT fi.to_file AS file
  FROM file_imports fi
  JOIN files tf ON tf.file = fi.from_file AND tf.is_test = 1
),
one_hop_tested AS (
  SELECT file FROM direct_tested
  UNION
  SELECT DISTINCT fi.to_file AS file
  FROM file_imports fi
  JOIN direct_tested dt ON dt.file = fi.from_file
)
SELECT
  f.file AS subject,
  'Imported at runtime by ' || pf.fanin || ' prod files with 0 static 1-hop test reachability and no recorded line coverage' AS detail,
  f.file AS file,
  1 AS line,
  f.unit_id AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM v_prod_files f
JOIN prod_fanin pf ON pf.file = f.file
LEFT JOIN one_hop_tested ot ON ot.file = f.file
LEFT JOIN file_coverage fc ON fc.file = f.file
WHERE f.is_barrel = 0
  AND f.runtime_exports_count > 0
  AND f.canonical_layer NOT IN ('support', 'ops_script', 'tests')
  AND f.file NOT LIKE '%/types/%'
  AND f.file NOT LIKE '%/dto/%'
  AND f.file NOT LIKE '%/schema/%'
  AND f.file NOT LIKE '%/schemas/%'
  AND f.file NOT LIKE '%/errors/%'
  AND f.file NOT LIKE '%/generated/%'
  AND pf.fanin >= 8
  AND ot.file IS NULL
  AND (fc.line_pct IS NULL OR fc.line_pct <= 0)
ORDER BY pf.fanin DESC, f.file ASC;
