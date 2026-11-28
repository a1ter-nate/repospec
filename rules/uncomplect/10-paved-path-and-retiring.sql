-- @id: sql:paved-path-and-retiring
-- @name: One Paved Path & Retiring-Interface Lock
-- @rung: R1
-- @severity: warn
-- @statement: Each unit should standardize on one library per cross-cutting concern and forbid new imports of interfaces declared in .repospec/retiring.json.
-- @why: Competing libraries for the same concern and backsliding onto deprecated interfaces multiply surface area and prevent migrations from ever finishing.
-- @fix: Consolidate onto the single paved-path library or migrate the import to the replacement specified in .repospec/retiring.json.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  key AS subject,
  CASE
    WHEN kind = 'retiring_interface_violation' THEN
      'Imports retiring interface "' || COALESCE(json_extract(payload_json, '$.retiredPath'), '') || '" — migrate to ' || COALESCE(json_extract(payload_json, '$.replacement'), 'paved path') || '.'
    ELSE
      'Unit "' || unit || '" mixes competing ' || COALESCE(json_extract(payload_json, '$.concern'), '') || ' libraries: ' || COALESCE(json_extract(payload_json, '$.libraries'), '') || '.'
  END AS detail,
  file,
  line
FROM facts
WHERE kind IN ('competing_library', 'retiring_interface_violation')
ORDER BY kind DESC, file ASC, line ASC;
