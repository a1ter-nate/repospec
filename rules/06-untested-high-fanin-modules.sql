-- @id: sql:untested-high-fanin-modules
-- @name: Heavily Imported Core File Has No Test Coverage
-- @rung: R2
-- @severity: warn
-- @statement: A production runtime file imported by 8 or more other files has no recorded test coverage and is not imported by any test within one hop.
-- @why: Heavily shared files have the largest blast radius in the repo — a subtle bug here silently breaks dozens of features at once without CI catching it.
-- @fix: Add a focused unit test file covering this module's core behavior and edge cases.
-- @benefit: Protects the highest-leverage code in your system so refactoring stays fast and safe.
-- @source: Nagappan, Ball & Zeller (2006) — Mining Metrics to Predict Component Failures | https://dl.acm.org/doi/10.1145/1134285.1134349
-- @source: Martin (1994) — OO Design Quality Metrics (Stable Dependencies Principle) | https://fi.ort.edu.uy/innovaportal/file/2032/1/design_principles.pdf
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM v_prod_files WHERE is_barrel = 0 AND runtime_exports_count > 0) = 0 THEN 'No non-barrel runtime production files indexed' ELSE NULL END
WITH RECURSIVE prod_fanin AS (
  SELECT fi.to_file AS file, COUNT(DISTINCT fi.from_file) AS fanin
  FROM file_imports fi
  JOIN v_prod_files src ON src.file = fi.from_file
  WHERE fi.type_only = 0
  GROUP BY fi.to_file
),
direct_tested(file) AS (
  SELECT DISTINCT fi.to_file AS file
  FROM file_imports fi
  JOIN files tf ON tf.file = fi.from_file AND tf.is_test = 1
  WHERE fi.type_only = 0
  UNION
  SELECT fi.to_file AS file
  FROM file_imports fi
  JOIN direct_tested dt ON dt.file = fi.from_file
  JOIN files bf ON bf.file = dt.file AND bf.is_barrel = 1
  WHERE fi.type_only = 0
),
one_hop_tested(file) AS (
  SELECT file FROM direct_tested
  UNION
  SELECT DISTINCT fi.to_file AS file
  FROM file_imports fi
  JOIN direct_tested dt ON dt.file = fi.from_file
  WHERE fi.type_only = 0
  UNION
  SELECT fi.to_file AS file
  FROM file_imports fi
  JOIN one_hop_tested ot ON ot.file = fi.from_file
  JOIN files bf ON bf.file = ot.file AND bf.is_barrel = 1
  WHERE fi.type_only = 0
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
