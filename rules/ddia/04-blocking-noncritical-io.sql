-- @id: ddia:blocking-noncritical-io
-- @name: Non-Critical External or Logging Call Blocks the User Response
-- @rung: R2
-- @severity: warn
-- @statement: An API handler waits for a third-party call or diagnostic/analytics write to finish before sending the HTTP response back to the caller.
-- @why: If the external service slows down or goes offline, your own user-facing endpoint hangs or fails even though the core request already succeeded.
-- @fix: Return the HTTP response as soon as the core work completes, and move analytics, diagnostics, or third-party syncs to a background job or queue.
-- @benefit: Keeps user-facing APIs fast and resilient even when third-party vendors or telemetry pipelines have hiccups.
-- @source: Dean & Barroso (2013) — The Tail at Scale (Communications of the ACM) | https://research.google/pubs/the-tail-at-scale/
-- @source: Nygard (2018) — Release It! (Stability Patterns & Bulkheads) | https://pragprog.com/titles/mnee2/release-it-second-edition/
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
