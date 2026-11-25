-- @id: sql:multi-domain-entity-ownership
-- @name: Undeclared Multi-Domain Datastore Entity Sharing
-- @rung: R1
-- @severity: warn
-- @statement: A datastore entity not declared as an authorized shared contract should not be accessed directly across 3+ domains.
-- @why: Shared datastore writes without an explicit ownership contract cause silent schema and lifecycle drift.
-- @fix: Consolidate writes into one owning domain or explicitly declare the entity in shared entity contracts.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM entity_access) = 0 THEN 'No datastore entity accesses indexed' WHEN (SELECT COUNT(DISTINCT domain_area) FROM v_prod_files WHERE domain_area IS NOT NULL) < 3 THEN 'Fewer than 3 business domains indexed' ELSE NULL END
WITH stats AS (
  SELECT
    ea.datastore,
    ea.entity,
    COUNT(DISTINCT ea.domain_area) AS dom_count,
    GROUP_CONCAT(DISTINCT ea.domain_area) AS doms,
    MIN(ea.file) AS sample_file,
    MIN(ea.line) AS sample_line
  FROM entity_access ea
  JOIN v_prod_files f ON f.file = ea.file
  LEFT JOIN declared_entities de
    ON de.datastore = ea.datastore AND de.entity = ea.entity
  WHERE ea.domain_area IS NOT NULL
    AND COALESCE(de.authorized_shared, 0) = 0
  GROUP BY ea.datastore, ea.entity
)
SELECT
  datastore || ':' || entity AS subject,
  datastore || ' entity "' || entity || '" touched across ' || dom_count || ' domains (' || doms || ')' AS detail,
  sample_file AS file,
  sample_line AS line,
  'arch:datastore:' || datastore AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM stats
WHERE dom_count >= 3
ORDER BY dom_count DESC, subject ASC;
