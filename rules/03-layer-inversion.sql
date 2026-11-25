-- @id: sql:layer-inversion
-- @name: Strict Architectural Layer Direction
-- @rung: R1
-- @severity: error
-- @statement: Lower architectural layers must not import upper layers (both intra-unit and cross-project Clean Architecture).
-- @why: Upward layer imports create cycles that break testability, isolate-build caching, and clean request boundaries.
-- @fix: Extract shared contracts into a domain/support module or invert the dependency via an interface.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM units WHERE layer_policy IN ('layered_backend', 'layered_clean_arch')) = 0 THEN 'No units with layered_backend or layered_clean_arch policy' ELSE NULL END
SELECT
  fi.from_unit || ':' || fi.from_layer || '->' || fi.to_unit || ':' || fi.to_layer AS subject,
  fi.from_layer || '/ (' || fi.from_canonical_layer || ') imports forbidden layer ' || fi.to_layer || '/ (' || fi.to_canonical_layer || ' in ' || fi.to_file || ')' AS detail,
  fi.from_file AS file,
  fi.line AS line,
  CASE WHEN fi.from_unit = fi.to_unit THEN 'arch:layer:' || fi.from_unit_slug || ':' || fi.from_layer ELSE fi.from_unit_id END AS target_node_id,
  CASE WHEN fi.from_unit = fi.to_unit THEN 'arch:layer:' || fi.from_unit_slug || ':' || fi.from_layer ELSE fi.from_unit_id END AS edge_from_id,
  CASE WHEN fi.from_unit = fi.to_unit THEN 'arch:layer:' || fi.to_unit_slug || ':' || fi.to_layer ELSE fi.to_unit_id END AS edge_to_id,
  'imports_layer' AS edge_kind
FROM v_prod_imports fi
WHERE (
  (fi.from_unit = fi.to_unit AND fi.from_layer_policy IN ('layered_backend', 'layered_clean_arch') AND (
    (fi.from_canonical_layer = 'persistence' AND fi.to_canonical_layer IN ('orchestration', 'transport', 'ui'))
    OR (fi.from_canonical_layer = 'domain' AND fi.to_canonical_layer IN ('persistence', 'integration', 'orchestration', 'transport', 'ui'))
    OR (fi.from_canonical_layer = 'orchestration' AND fi.to_canonical_layer IN ('transport', 'ui'))
    OR (fi.from_canonical_layer = 'integration' AND fi.to_canonical_layer IN ('orchestration', 'transport', 'persistence', 'ui'))
  ))
  OR (fi.from_unit != fi.to_unit AND fi.from_layer_policy = 'layered_clean_arch' AND fi.to_layer_policy = 'layered_clean_arch' AND (
    (fi.from_canonical_layer = 'domain' AND fi.to_canonical_layer IN ('orchestration', 'persistence', 'integration', 'transport', 'ui'))
    OR (fi.from_canonical_layer = 'orchestration' AND fi.to_canonical_layer IN ('persistence', 'integration', 'transport', 'ui'))
    OR (fi.from_canonical_layer IN ('persistence', 'integration') AND fi.to_canonical_layer IN ('transport', 'ui'))
  ))
)
ORDER BY subject ASC, fi.from_file ASC, fi.line ASC;
