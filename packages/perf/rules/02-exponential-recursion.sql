-- @id: perf:exponential-recursion
-- @name: Unmemoized Exponential Recursion
-- @rung: R6
-- @severity: warn
-- @statement: Functions with branching self-recursion (>= 2 self-calls) should use memoization or dynamic programming to avoid O(2^n) blowup.
-- @why: Unmemoized branching recursion grows exponentially with input depth and can exhaust CPU budgets or hang workers on moderate inputs.
-- @fix: Wrap with memoize() from @repospec/perf/algorithms or rewrite as an iterative bottom-up dynamic programming loop.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM metrics WHERE extractor_id = 'perf.complexity.v1' AND name = 'perf_scanned_files' AND value_num > 0) = 0 THEN 'No TypeScript/JavaScript files scanned by performance plugin.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.symbol'), key) AS subject,
  'Estimated ' || COALESCE(json_extract(payload_json, '$.timeComplexity'), 'O(2^n)') || ' time / ' || COALESCE(json_extract(payload_json, '$.spaceComplexity'), 'O(n)') || ' space: ' || COALESCE(json_extract(payload_json, '$.recommendation'), '') AS detail,
  file,
  line
FROM facts
WHERE kind = 'complexity_profile'
  AND json_extract(payload_json, '$.timeComplexity') = 'O(2^n)'
ORDER BY file, line;
