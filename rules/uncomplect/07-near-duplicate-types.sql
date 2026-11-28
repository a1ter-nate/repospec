-- @id: sql:near-duplicate-types
-- @name: Duplicate Data Shapes & Boilerplate Field-Copying Mappers
-- @rung: R1
-- @severity: warn
-- @statement: Two separate files define nearly identical data shapes (80%+ matching fields) or a mapper function simply copies fields one-by-one without real transformation.
-- @why: Maintaining parallel copies of the same record creates extra boilerplate and causes subtle bugs whenever a new field is added to one copy and forgotten in the other.
-- @fix: Keep one canonical type definition and derive narrower views from it (e.g. Pick/Omit), deleting pure field-for-field copy adapters.
-- @benefit: Fewer files to edit for every schema change, less boilerplate to read, and zero drift between duplicate models.
-- @source: Jiang et al. (2007) — DECKARD: Scalable and Accurate Tree-Based Detection of Code Clones | https://ieeexplore.ieee.org/document/4222572
-- @source: Joel Hooks — Uncomplect Skill (Eliminating Compensating Glue) | https://github.com/joelhooks/skills
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  key AS subject,
  CASE
    WHEN kind = 'near_duplicate_type' THEN
      'Type "' || COALESCE(json_extract(payload_json, '$.typeA'), '') || '" in ' || COALESCE(json_extract(payload_json, '$.fileA'), '') || ' and "' || COALESCE(json_extract(payload_json, '$.typeB'), '') || '" in ' || COALESCE(json_extract(payload_json, '$.fileB'), '') || ' share ' || ROUND(COALESCE(json_extract(payload_json, '$.jaccard'), 0) * 100, 0) || '% of their fields — likely duplicate copies of the same concept.'
    ELSE
      'Function "' || COALESCE(symbol, '') || '" copies ' || COALESCE(json_extract(payload_json, '$.fieldCopies'), '') || ' fields straight across with no transformation logic.'
  END AS detail,
  file,
  line
FROM facts
WHERE kind IN ('near_duplicate_type', 'format_adapter_glue')
ORDER BY file ASC, line ASC;
