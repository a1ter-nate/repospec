-- @id: sql:duplicate-state-enums
-- @name: Same Status List Copied Across Multiple Files
-- @rung: R1
-- @severity: warn
-- @statement: The same list of 3 or more lifecycle statuses (like order or device states) is redefined independently in separate files instead of being imported from one shared source.
-- @why: When a new status is added later, one copy inevitably gets missed — causing broken switch statements, rejected payloads, or stuck UI states.
-- @fix: Export one single canonical status union/enum from a shared domain file and import it everywhere else (including UI and API validators).
-- @benefit: Guarantees the whole stack agrees on every valid status, with the compiler catching any unhandled state immediately.
-- @source: Hunt & Thomas (1999) — The Pragmatic Programmer (DRY / Single Source of Truth) | https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/
-- @source: Wlaschin (2018) — Domain Modeling Made Functional (Making Illegal States Unrepresentable) | https://pragprog.com/titles/swdddf/domain-modeling-made-functional/
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM state_enums) < 2 THEN 'Fewer than 2 state enums indexed' ELSE NULL END
WITH normalized AS (
  SELECT
    file,
    name,
    REPLACE(name, 'Schema', '') AS base_name,
    values_signature,
    line
  FROM state_enums
  WHERE LENGTH(values_signature) - LENGTH(REPLACE(values_signature, '|', '')) >= 2
    AND name NOT LIKE '%Variant%'
    AND name NOT LIKE '%Severity%'
    AND name NOT LIKE '%Level%'
    AND name NOT LIKE '%Theme%'
    AND name NOT LIKE '%Tone%'
),
grouped AS (
  SELECT
    values_signature,
    COUNT(DISTINCT file) AS file_cnt,
    COUNT(DISTINCT base_name) AS base_cnt,
    GROUP_CONCAT(DISTINCT name) AS names,
    MIN(file) AS sample_file,
    MIN(line) AS sample_line
  FROM normalized
  GROUP BY values_signature
)
SELECT
  values_signature AS subject,
  'State value set {' || REPLACE(values_signature, '|', ', ') || '} duplicated across ' || file_cnt || ' files (' || names || ')' AS detail,
  sample_file AS file,
  sample_line AS line,
  NULL AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM grouped
WHERE file_cnt >= 2
  AND base_cnt >= 2
ORDER BY file_cnt DESC, subject ASC;
