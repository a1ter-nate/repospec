-- @id: ddia:multi-writer-unowned-field
-- @name: Same Database Field Updated From Too Many Unrelated Files
-- @rung: R2
-- @severity: warn
-- @statement: A stored database field is modified directly from three or more separate files without going through a single owning update function.
-- @why: When many files update the same field independently, validation rules, audit logs, and state invariants inevitably drift apart, leaving records in inconsistent states.
-- @fix: Route all updates to this field through one single-owner repository or domain transition helper (or compute the field on read if it is derived).
-- @benefit: Gives the field one single source of truth so invariants, auditing, and future schema changes only need to be maintained in one place.
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 12: Single Writer & Derived Data) | https://dataintensive.net/
-- @source: Evans (2003) — Domain-Driven Design (Aggregates & Invariant Ownership) | https://www.domainlanguage.com/ddd/
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
