-- @id: sql:iac-unlinked-compute
-- @name: Cloud Compute Service Not Linked to Any App or Deploy Pipeline
-- @rung: R4
-- @severity: info
-- @statement: A Terraform/OpenTofu compute service (like a Cloud Run service, Lambda, or Container App) has no matching app unit or deployment workflow in this repository.
-- @why: Unlinked cloud services are often forgotten leftovers still burning cloud spend, or production workloads whose deployment path is undocumented and risky to touch.
-- @fix: Connect the Terraform resource to its owning app and CI deploy workflow, or decommission it if the service is no longer used.
-- @benefit: Keeps your cloud footprint accurate, reduces wasted infrastructure spend, and makes every service's deploy path transparent.
-- @source: Morris (2020) — Infrastructure as Code (Traceable Service Ownership) | https://www.oreilly.com/library/view/infrastructure-as-code/9781098114664/
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
