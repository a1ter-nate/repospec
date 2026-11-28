-- @id: sql:vendor-leak-outside-client
-- @name: Third-Party Vendor SDK Used Outside Adapter Layer
-- @rung: R1
-- @severity: warn
-- @statement: Business or endpoint code directly imports a third-party vendor SDK instead of calling through this service's dedicated integration/client adapter layer.
-- @why: Calling vendor SDKs directly from business logic spreads API keys, retry policies, timeouts, and vendor-specific error handling across the codebase, making tests slow and migrations painful.
-- @fix: Wrap the vendor SDK call behind a small adapter in the integration/clients layer and import that adapter from business code.
-- @benefit: Keeps timeouts, retries, auth headers, and test mocks in one clean place and makes swapping or upgrading vendors safe.
-- @source: Cockburn (2005) — Hexagonal Architecture (Ports and Adapters) | https://alistair.cockburn.us/hexagonal-architecture/
-- @source: Parnas (1972) — On the Criteria To Be Used in Decomposing Systems into Modules | https://dl.acm.org/doi/10.1145/361598.361623
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
