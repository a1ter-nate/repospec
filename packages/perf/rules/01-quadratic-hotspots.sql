-- @id: perf:quadratic-hotspots
-- @name: Slow Nested Loop Work That Degrades at Scale
-- @rung: R6
-- @severity: warn
-- @statement: Code inside a loop repeatedly scans a whole list, shifts from the front of an array, copies an accumulator object on every step, or compiles a regex on every iteration.
-- @why: Work that runs in milliseconds on 20 test records slows down exponentially (100x–10,000x) when production data grows to thousands of items, spiking CPU and tail latency.
-- @fix: Build a Set or Map once before the loop for instant lookups, use a queue/index pointer instead of Array.shift(), and hoist regex/formatter creation outside the loop.
-- @benefit: Request latency stays flat and predictable as customer data grows, preventing surprise CPU spikes and timeouts in production.
-- @source: Cormen et al. — Introduction to Algorithms (Asymptotic Complexity & Hash Tables) | https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/
-- @source: Brendan Gregg — Systems Performance (CPU Flame Graphs & Algorithmic Hotspots) | https://www.brendangregg.com/systems-performance-2nd-edition-book.html
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM metrics WHERE extractor_id = 'perf.complexity.v1' AND name = 'perf_scanned_files' AND value_num > 0) = 0 THEN 'No source files scanned by performance plugin.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.symbol'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) || ' Fix: ' || COALESCE(json_extract(payload_json, '$.swapTo'), '') AS detail,
  file,
  line
FROM facts
WHERE kind = 'perf_antipattern'
  AND json_extract(payload_json, '$.severity') = 'high'
ORDER BY file, line;
