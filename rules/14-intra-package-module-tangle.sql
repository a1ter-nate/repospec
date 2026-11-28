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
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM module_cards) = 0 AND (SELECT COUNT(*) FROM file_imports WHERE type_only = 0) = 0 THEN 'No module topology cards or runtime file imports indexed' ELSE NULL END
WITH mod_tangles AS (
  SELECT
    mc.unit_slug || ':' || mc.tangle_id AS subject,
    'Circular dependency tangle (' || mc.tangle_id || ') across ' || COUNT(*) || ' modules in ' || mc.unit_slug || ': ' || GROUP_CONCAT(mc.name, ', ') AS detail,
    MIN(mc.rel_path) AS file,
    1 AS line,
    MIN(mc.unit_id) AS target_node_id,
    NULL AS edge_from_id,
    NULL AS edge_to_id,
    NULL AS edge_kind,
    COUNT(*) AS sort_weight
  FROM module_cards mc
  WHERE mc.in_tangle = 1
    AND mc.tangle_id IS NOT NULL
  GROUP BY mc.unit_id, mc.unit_slug, mc.tangle_id
),
rt_edges AS (
  SELECT DISTINCT fi.from_file, fi.to_file, fi.from_unit, MIN(fi.line) AS line
  FROM file_imports fi
  JOIN files f1 ON f1.file = fi.from_file AND f1.is_test = 0
  JOIN files f2 ON f2.file = fi.to_file AND f2.is_test = 0
  WHERE fi.type_only = 0
    AND fi.from_unit = fi.to_unit
    AND fi.from_file <> fi.to_file
  GROUP BY fi.from_file, fi.to_file, fi.from_unit
),
file_2cycles AS (
  SELECT
    e1.from_unit || ':file-cycle:' || e1.from_file || '<->' || e1.to_file AS subject,
    'Runtime file import cycle between ' || e1.from_file || ' and ' || e1.to_file || ' (mutual runtime import or re-export)' AS detail,
    e1.from_file AS file,
    e1.line AS line,
    NULL AS target_node_id,
    NULL AS edge_from_id,
    NULL AS edge_to_id,
    NULL AS edge_kind,
    2 AS sort_weight
  FROM rt_edges e1
  JOIN rt_edges e2 ON e2.from_file = e1.to_file AND e2.to_file = e1.from_file
  WHERE e1.from_file < e1.to_file
    AND NOT EXISTS (
      SELECT 1 FROM module_cards mc
      WHERE mc.in_tangle = 1
        AND (e1.from_file = mc.rel_path OR e1.from_file LIKE mc.rel_path || '/%')
    )
),
file_3cycles AS (
  SELECT
    e1.from_unit || ':file-cycle:' || e1.from_file || '->' || e2.from_file || '->' || e3.from_file AS subject,
    '3-file runtime import cycle: ' || e1.from_file || ' -> ' || e2.from_file || ' -> ' || e3.from_file || ' -> ' || e1.from_file AS detail,
    e1.from_file AS file,
    e1.line AS line,
    NULL AS target_node_id,
    NULL AS edge_from_id,
    NULL AS edge_to_id,
    NULL AS edge_kind,
    3 AS sort_weight
  FROM rt_edges e1
  JOIN rt_edges e2 ON e2.from_file = e1.to_file AND e2.to_file <> e1.from_file
  JOIN rt_edges e3 ON e3.from_file = e2.to_file AND e3.to_file = e1.from_file
  WHERE e1.from_file < e2.from_file AND e1.from_file < e3.from_file
    AND NOT EXISTS (SELECT 1 FROM rt_edges r WHERE r.from_file = e2.from_file AND r.to_file = e1.from_file)
    AND NOT EXISTS (
      SELECT 1 FROM module_cards mc
      WHERE mc.in_tangle = 1
        AND (e1.from_file = mc.rel_path OR e1.from_file LIKE mc.rel_path || '/%')
    )
)
SELECT subject, detail, file, line, target_node_id, edge_from_id, edge_to_id, edge_kind
FROM (
  SELECT * FROM mod_tangles
  UNION ALL
  SELECT * FROM file_2cycles
  UNION ALL
  SELECT * FROM file_3cycles
)
ORDER BY sort_weight DESC, subject ASC;
