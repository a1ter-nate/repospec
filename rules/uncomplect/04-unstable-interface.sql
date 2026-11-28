-- @id: sql:unstable-interface
-- @name: Widely Used Core File Changes Too Frequently
-- @rung: R2
-- @severity: warn
-- @statement: A file depended on by 5 or more other files is also experiencing heavy rewrite churn (50%+ of its lines changed across 3+ commits).
-- @why: When a heavily shared file keeps changing, every small tweak risks breaking downstream callers, causing repeated merge conflicts and surprise regressions.
-- @fix: Keep the public interface small and stable in this file, and move the fast-changing implementation details into internal helper files behind it.
-- @benefit: Everyday feature edits stop rippling across the rest of the codebase, dramatically cutting review risk and merge conflicts.
-- @source: Mo et al. (2015) — Hotspot Patterns: The Formal Definition and Automatic Detection of Architecture Smells | https://ieeexplore.ieee.org/document/7158495
-- @source: Nagappan & Ball (2005) — Use of Relative Code Churn Measures to Predict System Defect Density | https://dl.acm.org/doi/10.1145/1062455.1062514
-- @source: Tornhill & Borg (2022) — Code Red: The Business Impact of Code Quality | https://arxiv.org/abs/2203.04374
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM file_churn) = 0 THEN 'No git churn history mined' ELSE NULL END

SELECT
  vp.file AS subject,
  vp.file || ' is imported by ' || vp.prod_fan_in || ' other files, yet had ' || ROUND(fc.relative_churn * 100, 0) || '% of its lines churned across ' || fc.commits || ' commits (' || fc.bug_fix_commits || ' bug fixes).' AS detail,
  vp.file AS file,
  1 AS line
FROM v_file_passport vp
JOIN file_churn fc ON fc.file = vp.file
WHERE vp.is_test = 0
  AND vp.prod_fan_in >= 5
  AND fc.commits >= 3
  AND fc.relative_churn >= 0.5
ORDER BY (vp.prod_fan_in * fc.relative_churn) DESC, vp.file ASC;
