-- @id: sql:multi-domain-entity-ownership
-- @name: Database Table Accessed Directly by 3+ Different Domains
-- @rung: R1
-- @severity: warn
-- @statement: Three or more business domains directly query or modify the same database table/collection without an explicitly declared shared ownership contract.
-- @why: When multiple teams directly read and write the same raw table, changing a column or status field becomes dangerous because no one knows every consumer's assumptions.
-- @fix: Give one domain ownership of all writes to this table (exposing a narrow service API to others), or explicitly declare it as an authorized shared contract.
-- @benefit: Makes schema evolution safe and prevents silent data corruption across teams.
-- @source: Evans (2003) — Domain-Driven Design (Bounded Context Data Ownership) | https://www.domainlanguage.com/ddd/
-- @source: Newman (2021) — Building Microservices (Avoid Shared Databases) | https://samnewman.io/books/building_microservices_2nd_edition/
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
