-- @id: sql:unstable-interface
-- @name: Mo ICSE Hotspot — Unstable High-Fan-In Interface
-- @rung: R2
-- @severity: warn
-- @statement: High-fan-in production interfaces (prod_fan_in >= 5) should remain stable rather than exhibiting high relative churn (>= 0.5 across >= 3 commits).
-- @why: Mo et al. (2015) identified Unstable Interfaces as a top bug-prone architectural hotspot because frequent edits ripple across every dependent.
-- @fix: Stabilize the public contract by separating volatile implementation details from stable exported interfaces.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM file_churn) = 0 THEN 'No git churn history mined' ELSE NULL END

SELECT
  vp.file AS subject,
  'Unstable interface: prod_fan_in=' || vp.prod_fan_in || ', relative_churn=' || ROUND(fc.relative_churn, 2) || ' across ' || fc.commits || ' commits (' || fc.bug_fix_commits || ' bug fixes).' AS detail,
  vp.file AS file,
  1 AS line
FROM v_file_passport vp
JOIN file_churn fc ON fc.file = vp.file
WHERE vp.is_test = 0
  AND vp.prod_fan_in >= 5
  AND fc.commits >= 3
  AND fc.relative_churn >= 0.5
ORDER BY (vp.prod_fan_in * fc.relative_churn) DESC, vp.file ASC;
