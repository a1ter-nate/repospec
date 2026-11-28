-- @id: perf:exponential-recursion
-- @name: Runaway Recursive Branching Without Caching
-- @rung: R6
-- @severity: warn
-- @statement: A function calls itself two or more times on the same path without caching previous results, causing work to double at every level of depth.
-- @why: Uncached branching recursion explodes in runtime even on small inputs (depth 30–40 can freeze a server or blow past request timeouts).
-- @fix: Cache computed sub-results in a Map/HashMap (memoization) or rewrite the calculation as an iterative bottom-up loop.
-- @benefit: Turns exponential worst-case hangs into fast linear or polynomial execution that stays safe on any user input.
-- @source: Cormen et al. — Introduction to Algorithms (Dynamic Programming & Memoization) | https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM metrics WHERE extractor_id = 'perf.complexity.v1' AND name = 'perf_scanned_files' AND value_num > 0) = 0 THEN 'No source files scanned by performance plugin.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.symbol'), key) AS subject,
  'Function "' || COALESCE(json_extract(payload_json, '$.symbol'), key) || '" branches recursively without caching (' || COALESCE(json_extract(payload_json, '$.timeComplexity'), 'O(2^n)') || ' time). ' || COALESCE(json_extract(payload_json, '$.recommendation'), '') AS detail,
  file,
  line
FROM facts
WHERE kind = 'complexity_profile'
  AND json_extract(payload_json, '$.timeComplexity') = 'O(2^n)'
ORDER BY file, line;
