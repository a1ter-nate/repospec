-- @id: ddia:io-inside-transaction
-- @name: Gunawi Durability — No External/Provider IO Inside DB Transaction
-- @rung: R2
-- @severity: warn
-- @statement: External HTTP calls and third-party provider SDKs must not execute inside an open database transaction scope.
-- @why: External network stalls inside DB transactions hold locks, exhaust connection pools, and create non-atomic partial side effects when transactions roll back.
-- @fix: Commit the DB transaction first (using a transactional outbox row if durability is required) and execute external provider IO asynchronously outside the transaction.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'io_inside_transaction'
ORDER BY file ASC, line ASC;
