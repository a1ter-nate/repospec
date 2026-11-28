-- @id: sql:invisible-coupling
-- @name: Gall / Mo Invisible Coupling — Co-Changing Files Without Static Edge
-- @rung: R2
-- @severity: warn
-- @statement: Production files that co-change frequently (confidence >= 0.60, co-commits >= 4) without any static import dependency indicate hidden coupling.
-- @why: Gall et al. (1998) and Mo et al. (2015) showed that evolutionary co-change without structural dependency reveals hidden wire contracts, duplicated schemas, or compensating glue.
-- @fix: Share a single authoritative contract/type between the two files or co-locate the coupled decision inside one module.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM co_changes) = 0 THEN 'No git co-change history mined' ELSE NULL END

SELECT
  cc.file_a || ' <-> ' || cc.file_b AS subject,
  'Co-changed in ' || cc.co_commits || ' commits (confidence=' || ROUND(cc.confidence * 100, 1) || '%) with zero static import edge.' AS detail,
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
