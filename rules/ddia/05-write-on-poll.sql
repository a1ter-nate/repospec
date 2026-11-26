-- @id: ddia:write-on-poll
-- @name: Unconditional Datastore Write on Polling Endpoint
-- @rung: R2
-- @severity: warn
-- @statement: High-frequency polling endpoints should avoid unconditional synchronous datastore writes on every poll.
-- @why: Fleet-wide polling with per-request writes causes hot-document contention and write amplification.
-- @fix: Debounce heartbeat writes, coalesce in memory/cache, or offload telemetry writes asynchronously.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'work_flow') = 0 THEN 'No work flows extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'write_on_poll'
ORDER BY file, line;
