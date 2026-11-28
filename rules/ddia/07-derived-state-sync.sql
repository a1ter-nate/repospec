-- @id: ddia:derived-state-sync
-- @name: Summary or Cached Field Manually Kept in Sync Across Files
-- @rung: R2
-- @severity: warn
-- @statement: A derived field (like a count, total, cached value, or summary flag) is manually updated from multiple different files alongside the primary data.
-- @why: Manually syncing shadow fields across multiple code paths is a classic source of drift — one missed update path leaves counts and flags permanently out of sync with reality.
-- @fix: Calculate the value on read from the authoritative data, or maintain it in one single transactional projector/trigger.
-- @benefit: Eliminates an entire class of "why does this counter show the wrong number?" bugs and cuts out fragile sync boilerplate.
-- @source: Moseley & Marks (2006) — Out of the Tar Pit (Essential vs Accidental State) | https://curtclifton.net/papers/MoseleyMarks06a.pdf
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 11: Derived Data) | https://dataintensive.net/
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
