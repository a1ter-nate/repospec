-- @id: ddia:invalidate-before-write
-- @name: Cache Invalidation Before Datastore Write
-- @rung: R2
-- @severity: warn
-- @statement: Cache entries should be invalidated after the datastore write commits, not before.
-- @why: Deleting a cache key before committing lets concurrent readers repopulate the cache with pre-update data.
-- @fix: Move cache invalidation immediately after the datastore write succeeds (or use write-through / CDC).
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'work_flow') = 0 THEN 'No work flows extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'invalidate_before_write'
ORDER BY file, line;
