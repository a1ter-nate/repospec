-- @id: sql:crossing-hub
-- @name: Mo ICSE Hotspot — Crossing Dependency & Co-Change Hub
-- @rung: R2
-- @severity: warn
-- @statement: Production files should not simultaneously have high fan-in (>= 4), high fan-out (>= 4), and >= 3 high-confidence co-change partners.
-- @why: Mo et al. (2015) showed Crossing hubs concentrate structural and evolutionary coupling, becoming chronic merge-conflict and regression magnets.
-- @fix: Decompose the hub into smaller cohesive modules with narrower fan-in/fan-out boundaries.
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
  'Crossing hub: fan_in=' || vp.prod_fan_in || ', fan_out=' || vp.fan_out || ', co_change_partners=' || pc.partners || '.' AS detail,
  vp.file AS file,
  1 AS line
FROM v_file_passport vp
JOIN partner_counts pc ON pc.file = vp.file
WHERE vp.is_test = 0
  AND vp.prod_fan_in >= 4
  AND vp.fan_out >= 4
  AND pc.partners >= 3
ORDER BY (vp.prod_fan_in + vp.fan_out + pc.partners) DESC, vp.file ASC;
