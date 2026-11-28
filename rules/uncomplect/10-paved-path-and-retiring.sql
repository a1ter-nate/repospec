-- @id: sql:paved-path-and-retiring
-- @name: Competing Libraries or Retired Code Still Imported
-- @rung: R1
-- @severity: warn
-- @statement: One package mixes two competing libraries for the same job (e.g. two HTTP clients or two schema validators), or imports a legacy module marked for retirement in .repospec/retiring.json.
-- @why: Supporting multiple libraries for the same job doubles bundle size, splits team knowledge, and prevents half-finished migrations from ever completing.
-- @fix: Standardize on one chosen library per concern within this package, and migrate any retiring-interface imports to the replacement module.
-- @benefit: Smaller bundles, consistent error handling, faster onboarding, and migrations that actually finish instead of lingering forever.
-- @source: Winters, Manshreck & Wright (2020) — Software Engineering at Google (Ch. 15: Deprecation & One Version) | https://abseil.io/resources/swe-book/html/ch15.html
-- @source: Joel Hooks — Uncomplect Skill (One Paved Path) | https://github.com/joelhooks/skills
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  key AS subject,
  CASE
    WHEN kind = 'retiring_interface_violation' THEN
      'This file imports the retired module "' || COALESCE(json_extract(payload_json, '$.retiredPath'), '') || '" — switch it to "' || COALESCE(json_extract(payload_json, '$.replacement'), 'the replacement module') || '".'
    ELSE
      'Package "' || unit || '" uses multiple competing ' || REPLACE(COALESCE(json_extract(payload_json, '$.concern'), ''), '_', ' ') || ' libraries (' || COALESCE(json_extract(payload_json, '$.libraries'), '') || ') for the same job.'
  END AS detail,
  file,
  line
FROM facts
WHERE kind IN ('competing_library', 'retiring_interface_violation')
ORDER BY kind DESC, file ASC, line ASC;
