-- @id: sql:crossing-hub
-- @name: Overloaded Central Hub File
-- @rung: R2
-- @severity: warn
-- @statement: One file sits in the middle of too many connections — imported by 4+ files, importing 4+ files, and co-changing repeatedly with 3+ other files.
-- @why: Central "god" files become bottlenecks where multiple teams collide on the same lines, bugs propagate across unrelated features, and nobody feels safe refactoring.
-- @fix: Break this file into smaller responsibility-focused modules so each caller only depends on the exact slice it needs.
-- @benefit: Smaller, decoupled modules shrink blast radius, speed up code reviews, and let teams ship features in parallel without stepping on each other.
-- @source: Mo et al. (2015) — Hotspot Patterns: The Formal Definition and Automatic Detection of Architecture Smells | https://ieeexplore.ieee.org/document/7158495
-- @source: MacCormack, Rusnak & Baldwin (2006) — Exploring the Structure of Complex Software Designs | https://pubsonline.informs.org/doi/10.1287/mnsc.1060.0552
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM co_changes) = 0 THEN 'No git co-change history mined' ELSE NULL END

WITH partner_counts AS (
  SELECT file, COUNT(*) AS partners
  FROM (
    SELECT file_a AS file FROM co_changes WHERE co_commits >= 3 AND confidence >= 0.5
    UNION ALL
    SELECT file_b AS file FROM co_changes WHERE co_commits >= 3 AND confidence >= 0.5
  )
  GROUP BY file
)
SELECT
  vp.file AS subject,
  vp.file || ' is a central hub imported by ' || vp.prod_fan_in || ' files, importing ' || vp.fan_out || ' files, and repeatedly changing alongside ' || pc.partners || ' other files.' AS detail,
  vp.file AS file,
  1 AS line
FROM v_file_passport vp
JOIN partner_counts pc ON pc.file = vp.file
WHERE vp.is_test = 0
  AND vp.prod_fan_in >= 4
  AND vp.fan_out >= 4
  AND pc.partners >= 3
ORDER BY (vp.prod_fan_in + vp.fan_out + pc.partners) DESC, vp.file ASC;
