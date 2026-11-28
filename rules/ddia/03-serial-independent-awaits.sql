-- @id: ddia:serial-independent-awaits
-- @name: Independent Network or Database Calls Run One After Another
-- @rung: R2
-- @severity: warn
-- @statement: Two or more independent reads or notifications wait for each other one by one instead of running at the same time.
-- @why: Running independent waits sequentially adds their latencies together on every request, making pages and API endpoints noticeably slower for users.
-- @fix: Run independent calls concurrently using Promise.all / Promise.allSettled (JS/TS), tokio::join! (Rust), Task.WhenAll (C#), or asyncio.gather (Python).
-- @benefit: Cuts end-to-end request latency to the slowest single call instead of the sum of all of them, speeding up user-facing paths with minimal code change.
-- @source: Dean & Barroso (2013) — The Tail at Scale (Communications of the ACM) | https://research.google/pubs/the-tail-at-scale/
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 1: Latency & Tail Percentiles) | https://dataintensive.net/
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'work_flow') = 0 THEN 'No work flows extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'serial_independent_awaits'
ORDER BY file, line;
