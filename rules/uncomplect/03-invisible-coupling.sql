-- @id: sql:invisible-coupling
-- @name: Files That Always Change Together Without an Explicit Link
-- @rung: R2
-- @severity: warn
-- @statement: Two production files repeatedly change in the same git commits (at least 4 times, >= 60% of the time), yet neither file imports the other.
-- @why: Hidden co-changes usually mean both files duplicate the same business rule, payload shape, or protocol assumption — so someone editing one file can easily forget to update the other and ship a silent bug.
-- @fix: Extract the shared contract, schema, or rule into one shared module that both files import, or merge the tightly coupled logic into a single file.
-- @benefit: The compiler and tests will enforce consistency automatically instead of relying on developers to remember invisible pairs of files.
-- @source: Gall, Hajek & Jazayeri (1998) — Detection of Logical Coupling Based on Product Release History | https://ieeexplore.ieee.org/document/738508
-- @source: Mo et al. (2015) — Hotspot Patterns: The Formal Definition and Automatic Detection of Architecture Smells | https://ieeexplore.ieee.org/document/7158495
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM co_changes) = 0 THEN 'No git co-change history mined' ELSE NULL END

SELECT
  cc.file_a || ' <-> ' || cc.file_b AS subject,
  cc.file_a || ' and ' || cc.file_b || ' were edited together in ' || cc.co_commits || ' commits (' || ROUND(cc.confidence * 100, 0) || '% of edits) even though neither imports the other.' AS detail,
  cc.file_a AS file,
  1 AS line
FROM co_changes cc
JOIN files fa ON fa.file = cc.file_a AND fa.is_test = 0
JOIN files fb ON fb.file = cc.file_b AND fb.is_test = 0
WHERE cc.co_commits >= 4
  AND cc.confidence >= 0.6
  AND NOT EXISTS (
    SELECT 1 FROM file_imports fi
    WHERE (fi.from_file = cc.file_a AND fi.to_file = cc.file_b)
       OR (fi.from_file = cc.file_b AND fi.to_file = cc.file_a)
  )
ORDER BY cc.confidence DESC, cc.co_commits DESC, cc.file_a ASC, cc.file_b ASC;
