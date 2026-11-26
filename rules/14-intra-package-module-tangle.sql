-- @id: sql:intra-package-module-tangle
-- @name: No Intra-Package Circular Module Tangles
-- @rung: R1
-- @severity: warn
-- @statement: Top-level modules inside a unit must form an acyclic dependency DAG without strongly connected circular tangles.
-- @why: Circular module tangles make changes ripple unpredictably across peers and prevent isolated testing or layered extraction.
-- @fix: Extract shared contracts or types into a lower-level foundation module to break the cycle shown in Studio's Matrix (DSM) view.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM module_cards) = 0 THEN 'No module topology cards indexed' ELSE NULL END
SELECT
  mc.unit_slug || ':' || mc.tangle_id AS subject,
  'Circular dependency tangle (' || mc.tangle_id || ') across ' || COUNT(*) || ' modules in ' || mc.unit_slug || ': ' || GROUP_CONCAT(mc.name, ', ') AS detail,
  MIN(mc.rel_path) AS file,
  1 AS line,
  MIN(mc.unit_id) AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM module_cards mc
WHERE mc.in_tangle = 1
  AND mc.tangle_id IS NOT NULL
GROUP BY mc.unit_id, mc.unit_slug, mc.tangle_id
ORDER BY COUNT(*) DESC, mc.unit_slug ASC, mc.tangle_id ASC;
