-- @id: sql:parnas-secret-leak
-- @name: Parnas Information Hiding — No Leaked Storage/ORM/SDK Secrets
-- @rung: R1
-- @severity: warn
-- @statement: Public exports of non-persistence/non-integration modules should not leak raw datastore, ORM, HTTP wire, or vendor SDK types across module boundaries.
-- @why: Parnas (1972) showed that leaking implementation secrets in public signatures couples callers to storage and vendor internals, multiplying change cost.
-- @fix: Wrap leaked storage/SDK types behind narrow domain types or interfaces inside the owning adapter/persistence module.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Public export leaks internal secret type ' || COALESCE(symbol, '') || ' across boundary: ' || COALESCE(json_extract(payload_json, '$.snippet'), '') AS detail,
  file,
  line
FROM facts
WHERE kind = 'secret_leak'
ORDER BY file ASC, line ASC;
