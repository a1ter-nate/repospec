-- @id: ddia:cloud-resilience-hazards
-- @name: Gunawi Cloud Resilience — Idempotent Retries & Bounded Pagination
-- @rung: R2
-- @severity: warn
-- @statement: Retried write operations must carry an idempotency/dedupe guard, and collection queries should specify an explicit pagination or LIMIT bound.
-- @why: Gunawi et al. (2014) found non-idempotent retries and unbounded list queries are leading causes of duplicate side effects and OOM/latency cascades in cloud systems.
-- @fix: Pass a stable idempotency key or UPSERT guard into retried writes, and add an explicit LIMIT/pageSize/cursor to collection queries.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') IN ('non_idempotent_retry', 'unbounded_pagination')
ORDER BY file ASC, line ASC;
