-- @id: ddia:invalidate-before-write
-- @name: Cache Cleared Before Database Update Finishes
-- @rung: R2
-- @severity: warn
-- @statement: Code deletes or invalidates a cache entry before the underlying database write has committed.
-- @why: Between deleting the cache key and finishing the database save, another request can read the old value from the database and put stale data right back into the cache indefinitely.
-- @fix: Move cache deletion or refresh so it runs immediately after the database write succeeds (or update the cache from a post-commit change feed).
-- @benefit: Prevents sticky stale-cache bugs where users keep seeing outdated data even after saving a change.
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 7: Weak Isolation & Write Skew) | https://dataintensive.net/
-- @source: Nishtala et al. (2013) — Scaling Memcache at Facebook (NSDI) | https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala
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
