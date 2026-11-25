-- @id: sql:duplicate-state-enums
-- @name: Single Source of Truth for Lifecycle State Enums
-- @rung: R1
-- @severity: warn
-- @statement: The same lifecycle state value set (>= 3 states) should not be redefined independently across unrelated source files.
-- @why: Duplicated state enums silently diverge during feature evolution, causing invalid transitions or dropped states.
-- @fix: Export one canonical state union/schema and derive DTO/UI types from it.
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
