-- @id: sql:vendor-leak-outside-client
-- @name: Third-Party Runtime SDKs Isolated in Integration Layer
-- @rung: R1
-- @severity: warn
-- @statement: Third-party vendor SDKs and external HTTP calls must stay inside a unit's integration layer when that boundary exists.
-- @why: Isolating external vendor SDKs and HTTP calls keeps retries, auth headers, and mocks in one adapter boundary.
-- @fix: Wrap the vendor SDK or external HTTP call behind an adapter in the integration layer.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM units WHERE has_integration_layer = 1) = 0 THEN 'No units declare a dedicated integration layer boundary' ELSE NULL END
SELECT
  p.unit || ':' || p.layer || ':' || p.pkg AS subject,
  p.layer || '/ (' || p.canonical_layer || ') has runtime import of ' || p.vendor_category || ' SDK "' || p.pkg || '" outside integration layer' AS detail,
  p.from_file AS file,
  p.line AS line,
  'arch:layer:' || u.slug || ':' || p.layer AS target_node_id,
  'arch:layer:' || u.slug || ':' || p.layer AS edge_from_id,
  NULL AS edge_to_id,
  'bypasses_layer' AS edge_kind
FROM pkg_imports p
JOIN v_prod_files f ON f.file = p.from_file
JOIN units u ON u.name = p.unit
WHERE p.type_only = 0
  AND p.vendor_category IS NOT NULL
  AND p.vendor_category != 'observability'
  AND u.has_integration_layer = 1
  AND p.canonical_layer NOT IN ('integration', 'ops_script', 'tests')
  AND p.layer != 'root'
UNION ALL
SELECT
  h.unit || ':' || h.layer || ':' || h.service_label AS subject,
  h.layer || '/ (' || h.canonical_layer || ') calls external host "' || h.host || '" outside integration layer' AS detail,
  h.file AS file,
  h.line AS line,
  'arch:ext:' || LOWER(REPLACE(h.service_label, ' ', '-')) AS target_node_id,
  'arch:layer:' || u.slug || ':' || h.layer AS edge_from_id,
  'arch:ext:' || LOWER(REPLACE(h.service_label, ' ', '-')) AS edge_to_id,
  'bypasses_layer' AS edge_kind
FROM external_hosts h
JOIN v_prod_files f ON f.file = h.file
JOIN units u ON u.name = h.unit
WHERE u.has_integration_layer = 1
  AND h.canonical_layer NOT IN ('integration', 'ops_script', 'tests')
  AND h.layer != 'root'
ORDER BY subject ASC, file ASC, line ASC;
