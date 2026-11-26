-- @id: ddia:multi-writer-unowned-field
-- @name: Multi-Writer Entity Field Without Single Owner
-- @rung: R2
-- @severity: warn
-- @statement: Persisted entity fields mutated across three or more separate files should funnel through one transactional owner or be derived on read.
-- @why: Scattered non-transactional writers on the same field create dual-write SSOT divergence and stale derived state.
-- @fix: Consolidate writes into a single DAO/commit helper or compute the field at read time.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'data_lifecycle') = 0 THEN 'No data lifecycles extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'multi_writer_unowned_field'
ORDER BY file, line;
