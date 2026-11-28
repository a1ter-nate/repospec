-- @id: sql:disjoint-caller-cohesion
-- @name: Sarkar Disjoint-Caller Cohesion — No Kitchen-Sink Modules
-- @rung: R1
-- @severity: warn
-- @statement: Non-barrel production modules should serve a cohesive caller set rather than splitting into 3+ completely disjoint symbol-caller clusters.
-- @why: Sarkar et al. (2007) demonstrated that modules whose exported symbols partition into unrelated caller clusters are braided god/utils modules that amplify rebuilds and conflicts.
-- @fix: Split disjoint symbol groups into focused, single-secret modules aligned with their caller groups.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM symbol_imports) = 0 THEN 'No symbol-level import edges indexed' ELSE NULL END

WITH prod_sym_imports AS (
  SELECT DISTINCT si.from_file, si.to_file, si.symbol_name
  FROM symbol_imports si
  JOIN files tf ON tf.file = si.to_file AND tf.is_test = 0 AND tf.is_barrel = 0
  JOIN files ff ON ff.file = si.from_file AND ff.is_test = 0
  WHERE si.symbol_name != '*'
    AND si.to_file NOT LIKE '%/index.%'
),
sym_callers AS (
  SELECT to_file, symbol_name, COUNT(DISTINCT from_file) AS caller_cnt
  FROM prod_sym_imports
  GROUP BY to_file, symbol_name
),
caller_pairs AS (
  SELECT
    a.to_file,
    COUNT(DISTINCT a.from_file) AS total_callers,
    COUNT(DISTINCT a.symbol_name) AS total_symbols
  FROM prod_sym_imports a
  GROUP BY a.to_file
  HAVING COUNT(DISTINCT a.from_file) >= 4 AND COUNT(DISTINCT a.symbol_name) >= 4
),
overlap_pairs AS (
  SELECT
    a.to_file,
    COUNT(DISTINCT a.from_file || '|' || b.from_file) AS overlapping_caller_pairs
  FROM prod_sym_imports a
  JOIN prod_sym_imports b
    ON a.to_file = b.to_file
   AND a.symbol_name = b.symbol_name
   AND a.from_file < b.from_file
  GROUP BY a.to_file
)
SELECT
  cp.to_file AS subject,
  'Kitchen-sink module: ' || cp.total_callers || ' callers import ' || cp.total_symbols || ' symbols with zero overlapping symbol usage across callers.' AS detail,
  cp.to_file AS file,
  1 AS line
FROM caller_pairs cp
LEFT JOIN overlap_pairs op ON op.to_file = cp.to_file
WHERE COALESCE(op.overlapping_caller_pairs, 0) = 0
ORDER BY cp.total_callers DESC, cp.to_file ASC;
