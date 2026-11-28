-- @id: sql:unwired-quality-gates
-- @name: Registered Quality Check Is Not Running in CI
-- @rung: R0
-- @severity: error
-- @statement: A verification check or quality gate is defined in the repo, but no CI workflow actually executes it on pull requests.
-- @why: Checks that only run manually on a developer's laptop get forgotten under deadline pressure, giving a false sense of safety while regressions slip into main.
-- @fix: Add a step to your PR-blocking CI workflow to run this check automatically, or delete the gate if it is genuinely obsolete.
-- @benefit: Ensures every pull request is verified automatically and consistently without relying on memory.
-- @source: Humble & Farley (2010) — Continuous Delivery (Automated Deployment Pipeline Gates) | https://continuousdelivery.com/
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM nodes WHERE kind = 'quality_gate') = 0 THEN 'No quality gates registered' ELSE NULL END
SELECT
  n.label AS subject,
  'Quality gate "' || n.label || '" is registered in ' || n.file || ' but has no CI enforces_in_ci edge' AS detail,
  n.file AS file,
  COALESCE(n.line, 1) AS line,
  n.id AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM nodes n
LEFT JOIN edges e ON e.to_id = n.id AND e.kind = 'enforces_in_ci'
WHERE n.kind = 'quality_gate'
  AND e.from_id IS NULL
ORDER BY n.label ASC;
