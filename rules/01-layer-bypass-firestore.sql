-- @id: sql:layer-bypass-datastore
-- @name: No Direct Datastore Access Outside Persistence Layer
-- @rung: R1
-- @severity: error
-- @statement: Production layers must not bypass a unit's dedicated persistence layer to read or write datastore entities directly.
-- @why: Direct datastore calls outside the persistence layer scatter schema assumptions, tenancy checks, and transaction boundaries.
-- @fix: Route datastore reads and writes through the unit's persistence layer.
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
