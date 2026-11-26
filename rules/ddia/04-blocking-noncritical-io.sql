-- @id: ddia:blocking-noncritical-io
-- @name: Non-Critical or External IO Blocking HTTP Response
-- @rung: R2
-- @severity: warn
-- @statement: External API calls and diagnostic/capture writes should not block the synchronous HTTP response path.
-- @why: External network jitter and diagnostic persistence directly inflate caller p95 latency and failure rates.
-- @fix: Flush the HTTP response first or offload non-critical IO to a background task queue.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'work_flow') = 0 THEN 'No work flows extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'blocking_noncritical_io'
ORDER BY file, line;
