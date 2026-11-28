-- @id: ddia:derived-state-sync
-- @name: Moseley-Marks Derived-State Imperative Sync Smell
-- @rung: R2
-- @severity: warn
-- @statement: Derived or shadow fields (count, total, cached_*, summary_*) should be computed on read or maintained by a single transactional projector rather than imperatively synced across multiple files.
-- @why: Moseley & Marks (2006) showed mutable derived state is a primary root cause of accidental complexity and silent inconsistency bugs.
-- @fix: Compute the derived field at query/read time or funnel updates through a single transactional projection owner.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'data_lifecycle') = 0 THEN 'No data lifecycles extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'derived_state_sync'
ORDER BY file ASC, line ASC;
