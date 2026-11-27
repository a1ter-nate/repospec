-- @id: perf:quadratic-hotspots
-- @name: Quadratic AST Performance Hotspots
-- @rung: R6
-- @severity: warn
-- @statement: Hot loops should avoid O(n^2) array scans, Array.shift/unshift, spread accumulators in reduce, and nested-loop joins.
-- @why: Quadratic patterns look harmless on unit fixtures but cause non-linear CPU and GC latency spikes under production dataset sizes.
-- @fix: Pre-index lookups with Map/Set or hashJoin(), use RingBufferDeque for queues, and mutate fresh accumulators in place.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM metrics WHERE extractor_id = 'perf.complexity.v1' AND name = 'perf_scanned_files' AND value_num > 0) = 0 THEN 'No TypeScript/JavaScript files scanned by performance plugin.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.symbol'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) || ' -> ' || COALESCE(json_extract(payload_json, '$.swapTo'), '') AS detail,
  file,
  line
FROM facts
WHERE kind = 'perf_antipattern'
  AND json_extract(payload_json, '$.severity') = 'high'
ORDER BY file, line;
