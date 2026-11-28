-- @id: ddia:io-inside-transaction
-- @name: Slow External API Call Inside an Open Database Transaction
-- @rung: R2
-- @severity: warn
-- @statement: Code makes an external HTTP request or third-party vendor call (like Stripe, email, or SMS) while holding an open database transaction.
-- @why: Slow network calls inside a database transaction hold row locks and tie up connection-pool slots — and if the transaction later rolls back, the external payment or email cannot be undone.
-- @fix: Commit the database transaction first (recording an outbox/pending row if needed), then run the external API call outside the transaction.
-- @benefit: Prevents database connection-pool exhaustion during vendor slowdowns and stops partial failures from leaving external side effects out of sync with your database.
-- @source: Gunawi et al. (2014) — What Bugs Live in the Cloud? (ACM SoCC) | https://dl.acm.org/doi/10.1145/2670979.2670986
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 7 & 9: Transactions & Distributed Consistency) | https://dataintensive.net/
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
