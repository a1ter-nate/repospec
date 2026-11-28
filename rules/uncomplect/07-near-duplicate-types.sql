-- @id: sql:near-duplicate-types
-- @name: DECKARD Near-Duplicate Exported Types & Compensating Adapters
-- @rung: R1
-- @severity: warn
-- @statement: Distinct modules should avoid maintaining near-identical exported record/interface shapes (field Jaccard >= 0.80) connected by trivial field-copy adapters.
-- @why: Near-duplicate DTOs and field-for-field mappers are compensating accidental complexity that drift silently whenever one schema evolves.
-- @fix: Consolidate onto one canonical domain type or derive projections structurally (Pick/Omit) instead of duplicating schemas.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  key AS subject,
  CASE
    WHEN kind = 'near_duplicate_type' THEN
      'Near-duplicate types ' || COALESCE(json_extract(payload_json, '$.typeA'), '') || ' (' || COALESCE(json_extract(payload_json, '$.fileA'), '') || ') and ' || COALESCE(json_extract(payload_json, '$.typeB'), '') || ' (' || COALESCE(json_extract(payload_json, '$.fileB'), '') || ') have field Jaccard=' || COALESCE(json_extract(payload_json, '$.jaccard'), '')
    ELSE
      'Trivial field-copying adapter ' || COALESCE(symbol, '') || ' copies ' || COALESCE(json_extract(payload_json, '$.fieldCopies'), '') || ' fields without logic.'
  END AS detail,
  file,
  line
FROM facts
WHERE kind IN ('near_duplicate_type', 'format_adapter_glue')
ORDER BY file ASC, line ASC;
