-- @id: sql:intra-package-module-tangle
-- @name: Modules Inside One Package Import Each Other in a Circle
-- @rung: R1
-- @severity: warn
-- @statement: Two or more folders or modules inside the same package mutually import each other, forming an internal dependency loop.
-- @why: Circular module loops cause subtle runtime initialization bugs, make it impossible to understand one module without reading the whole cycle, and block clean extraction later.
-- @fix: Pull the shared types or pure helper functions into a small leaf module that both sides import so arrows flow strictly one way.
-- @benefit: Turns a tangled knot into a clear top-to-bottom hierarchy that is easy to reason about, test, and split apart if needed.
-- @source: Lakos (1996) — Large-Scale C++ Software Design (Breaking Cyclic Dependencies) | https://en.wikipedia.org/wiki/Large-Scale_C%2B%2B_Software_Design
-- @source: Baldwin & Clark (2000) — Design Rules: The Power of Modularity (DSM Cycles) | https://mitpress.mit.edu/9780262024662/design-rules/
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
