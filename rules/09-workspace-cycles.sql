-- @id: sql:workspace-cycles
-- @name: Acyclic Workspace Unit Dependency Graph
-- @rung: R1
-- @severity: error
-- @statement: Workspace apps, packages, crates, and .NET projects must form a strict DAG with zero dependency cycles of any length.
-- @why: Cyclic package dependencies break incremental builds, deterministic bundling, and clean modular boundaries.
-- @fix: Extract shared contracts into a lower-level library unit so dependency arrows point strictly one way.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM edges WHERE kind = 'depends_on') = 0 THEN 'No unit dependency edges indexed' ELSE NULL END
WITH RECURSIVE dep_edges AS (
  SELECT e.from_id, e.to_id, COALESCE(e.file, '.') AS file, COALESCE(e.line, 1) AS line
  FROM edges e
  JOIN nodes n1 ON n1.id = e.from_id AND n1.domain = 'arch'
  JOIN nodes n2 ON n2.id = e.to_id AND n2.domain = 'arch'
  WHERE e.kind = 'depends_on'
    AND COALESCE(e.label, '') NOT LIKE 'dev%'
),
walk(start_id, curr_id, path, min_id, depth, first_edge_to, first_file, first_line) AS (
  SELECT from_id, to_id, from_id || ' -> ' || to_id, MIN(from_id, to_id), 1, to_id, file, line
  FROM dep_edges
  UNION ALL
  SELECT w.start_id, d.to_id, w.path || ' -> ' || d.to_id, MIN(w.min_id, d.to_id), w.depth + 1, w.first_edge_to, w.first_file, w.first_line
  FROM walk w
  JOIN dep_edges d ON d.from_id = w.curr_id
  WHERE w.depth < 8
    AND (d.to_id = w.start_id OR INSTR(w.path, d.to_id) = 0)
)
SELECT
  path AS subject,
  'Unit dependency cycle (' || depth || ' hops): ' || path AS detail,
  first_file AS file,
  first_line AS line,
  start_id AS target_node_id,
  start_id AS edge_from_id,
  first_edge_to AS edge_to_id,
  'depends_on' AS edge_kind
FROM walk
WHERE curr_id = start_id
  AND start_id = min_id
ORDER BY depth ASC, subject ASC;
