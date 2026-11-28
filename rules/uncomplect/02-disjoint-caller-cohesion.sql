-- @id: sql:disjoint-caller-cohesion
-- @name: Grab-Bag File Serving Unrelated Callers
-- @rung: R1
-- @severity: warn
-- @statement: This file exports multiple unrelated functions or constants to four or more different callers that never share a single imported symbol.
-- @why: Grab-bag "utils" files quietly become magnets for unrelated code, causing unnecessary merge conflicts, bloated bundles, and unclear ownership.
-- @fix: Split this file into smaller, focused modules where each file groups only the functions used by the same feature or caller group.
-- @benefit: Each module becomes easier to name, navigate, test, and delete safely without dragging unrelated features along.
-- @source: Sarkar, Rama & Kak (2007) — API-Based and Information-Theoretic Metrics for Measuring the Quality of Software Modularization | https://ieeexplore.ieee.org/document/4023978
-- @source: Rich Hickey (2011) — Simple Made Easy | https://www.infoq.com/presentations/Simple-Made-Easy/
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM symbol_imports) = 0 THEN 'No symbol-level import edges indexed' ELSE NULL END

WITH prod_sym_imports AS (
  SELECT DISTINCT si.from_file, si.to_file, si.symbol_name
  FROM symbol_imports si
  JOIN files tf ON tf.file = si.to_file AND tf.is_test = 0 AND tf.is_barrel = 0
  JOIN files ff ON ff.file = si.from_file AND ff.is_test = 0
  WHERE si.symbol_name != '*'
    AND si.to_file NOT LIKE '%/index.%'
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
  cp.total_callers || ' different callers each import completely separate exports (' || cp.total_symbols || ' total) from this file with zero overlap — a strong sign it bundles unrelated concerns.' AS detail,
  cp.to_file AS file,
  1 AS line
FROM caller_pairs cp
LEFT JOIN overlap_pairs op ON op.to_file = cp.to_file
WHERE COALESCE(op.overlapping_caller_pairs, 0) = 0
ORDER BY cp.total_callers DESC, cp.to_file ASC;
