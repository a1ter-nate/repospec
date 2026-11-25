-- @id: sql:iac-unlinked-compute
-- @name: IaC Compute Services Must Link to an App or Deployment Workflow
-- @rung: R4
-- @severity: info
-- @statement: Declared IaC compute resources should link to a deployed app unit or CI release workflow.
-- @why: Orphan IaC compute resources indicate stale infrastructure or unmapped deployment paths.
-- @fix: Link the compute resource to its owning unit/workflow or decommission unused IaC.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM nodes WHERE kind = 'iac_resource' AND grp = 'compute') = 0 THEN 'No cloud compute IaC resources indexed' ELSE NULL END
SELECT
  n.id AS subject,
  'IaC compute resource "' || n.label || '" (' || n.file || ') is not linked to any app or CI workflow' AS detail,
  n.file AS file,
  COALESCE(n.line, 1) AS line,
  n.id AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM nodes n
LEFT JOIN edges e ON (e.from_id = n.id OR e.to_id = n.id) AND e.kind IN ('deploys', 'builds_image', 'routes_to')
WHERE n.kind = 'iac_resource'
  AND n.grp = 'compute'
  AND e.from_id IS NULL
ORDER BY n.id ASC;
