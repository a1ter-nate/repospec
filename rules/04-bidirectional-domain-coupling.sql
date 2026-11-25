-- @id: sql:bidirectional-domain-coupling
-- @name: Acyclic Domain-to-Domain Dependencies
-- @rung: R1
-- @severity: warn
-- @statement: Two business domains should not mutually import each other at runtime (>= 2 imports in each direction).
-- @why: Mutual runtime imports blur bounded-context ownership and turn local changes into cross-domain ripple effects.
-- @fix: Promote shared contracts to a shared kernel or introduce a one-way service interface between domains.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(DISTINCT domain_area) FROM v_prod_files WHERE domain_area IS NOT NULL) < 2 THEN 'Fewer than 2 business domains indexed' ELSE NULL END
WITH pairs AS (
  SELECT from_domain, to_domain, COUNT(*) AS cnt, MIN(from_file) AS sample_file, MIN(line) AS sample_line
  FROM v_prod_imports
  WHERE from_domain IS NOT NULL
    AND to_domain IS NOT NULL
    AND from_domain != to_domain
  GROUP BY from_domain, to_domain
)
SELECT
  a.from_domain || ' <-> ' || a.to_domain AS subject,
  a.from_domain || ' <-> ' || a.to_domain || ' mutually import each other (' || a.cnt || ' / ' || b.cnt || ' runtime imports)' AS detail,
  a.sample_file AS file,
  a.sample_line AS line,
  'arch:domain:' || a.from_domain AS target_node_id,
  'arch:domain:' || a.from_domain AS edge_from_id,
  'arch:domain:' || a.to_domain AS edge_to_id,
  'imports_domain' AS edge_kind
FROM pairs a
JOIN pairs b ON a.from_domain = b.to_domain AND a.to_domain = b.from_domain
WHERE a.from_domain < a.to_domain
  AND a.cnt >= 2
  AND b.cnt >= 2
ORDER BY (a.cnt + b.cnt) DESC, subject ASC;
