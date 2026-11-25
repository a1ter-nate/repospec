-- @id: sql:unwired-quality-gates
-- @name: Registered Quality Gates Must Be Enforced in CI
-- @rung: R0
-- @severity: error
-- @statement: Every registered quality gate must be invoked by at least one CI workflow or composite action.
-- @why: Unwired quality gates give false confidence because regressions only fail if developers remember to run them locally.
-- @fix: Wire the gate into a required CI workflow job or remove the obsolete gate definition.
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
