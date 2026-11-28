-- @id: sql:layer-bypass-datastore
-- @name: Direct Database Access Bypassing the Data Layer
-- @rung: R1
-- @severity: error
-- @statement: A controller, service, or UI file reads or writes the database directly instead of going through this service's dedicated data/repository layer.
-- @why: Bypassing the data layer scatters raw database queries, tenant/permission checks, and transaction handling across unrelated files — making security bugs and schema breakage far more likely.
-- @fix: Move the database query into a function inside this service's data/persistence layer and call that helper instead.
-- @benefit: Centralizes authorization checks, query optimization, and schema migrations in one auditable boundary.
-- @source: Parnas (1972) — On the Criteria To Be Used in Decomposing Systems into Modules | https://dl.acm.org/doi/10.1145/361598.361623
-- @source: Fowler (2002) — Patterns of Enterprise Application Architecture (Repository Pattern) | https://martinfowler.com/eaaCatalog/repository.html
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM entity_access) = 0 THEN 'No datastore entity accesses indexed' WHEN (SELECT COUNT(*) FROM units WHERE has_persistence_layer = 1) = 0 THEN 'No units declare a dedicated persistence layer boundary' ELSE NULL END
SELECT
  ea.unit || ':' || ea.layer || ':' || ea.entity AS subject,
  ea.layer || '/ (' || ea.canonical_layer || ') accesses ' || ea.datastore || ' entity "' || ea.entity || '" directly (bypasses persistence layer)' AS detail,
  ea.file AS file,
  ea.line AS line,
  'arch:datastore:' || ea.datastore AS target_node_id,
  'arch:layer:' || u.slug || ':' || ea.layer AS edge_from_id,
  'arch:datastore:' || ea.datastore AS edge_to_id,
  'bypasses_layer' AS edge_kind
FROM entity_access ea
JOIN v_prod_files f ON f.file = ea.file
JOIN units u ON u.name = ea.unit
WHERE u.has_persistence_layer = 1
  AND ea.canonical_layer NOT IN ('persistence', 'ops_script', 'tests')
  AND ea.layer != 'root'
ORDER BY ea.unit ASC, ea.layer ASC, ea.entity ASC, ea.file ASC, ea.line ASC;
