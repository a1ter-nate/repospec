-- @id: ddia:cloud-resilience-hazards
-- @name: Retries Without Duplicate Protection or Unbounded List Queries
-- @rung: R2
-- @severity: warn
-- @statement: A write operation is retried without an idempotency/dedupe key, or a list query fetches all rows without a limit or page size.
-- @why: Retrying a payment, email, or insert without duplicate protection can double-charge or double-create records on network timeouts; unbounded queries can exhaust server memory as tables grow.
-- @fix: Pass a stable idempotency key or UPSERT check into retried writes, and add an explicit page size, cursor, or LIMIT to every list query.
-- @benefit: Makes retries safe under real-world network blips and keeps memory and database load bounded no matter how large customer tables grow.
-- @source: Gunawi et al. (2014) — What Bugs Live in the Cloud? (ACM SoCC) | https://dl.acm.org/doi/10.1145/2670979.2670986
-- @source: Brandur Leach — Implementing Stripe-Like Idempotency Keys in Postgres | https://brandur.org/idempotency-keys
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
