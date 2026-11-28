-- @id: ddia:write-on-poll
-- @name: Polling Endpoint Writes to the Database on Every Check-In
-- @rung: R2
-- @severity: warn
-- @statement: A high-frequency polling or status-check endpoint performs a synchronous database write every time a client or device checks in.
-- @why: As the fleet of clients or devices grows, constant writes on every poll create hot-row lock contention, drive up database costs, and can take down the database during reconnect storms.
-- @fix: Only write when values actually change, debounce heartbeats in memory/cache, or batch status updates asynchronously.
-- @benefit: Dramatically lowers database write load and cost while protecting the platform during traffic spikes or fleet-wide reconnects.
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 1 & 6: Load, Hot Keys & Write Amplification) | https://dataintensive.net/
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
