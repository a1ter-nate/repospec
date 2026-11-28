-- @id: sql:layer-inversion
-- @name: Lower Layer Imports Higher Layer (Wrong Dependency Direction)
-- @rung: R1
-- @severity: error
-- @statement: A lower foundation or data-layer file imports code from an upper layer (like an HTTP controller or orchestration service), reversing the intended one-way architecture.
-- @why: Upward imports create hidden circular dependencies between layers, breaking isolated testing, slowing incremental builds, and letting HTTP/UI details leak into core logic.
-- @fix: Move the shared type or helper down into a shared domain/support module, or pass a small callback/interface from the upper layer down.
-- @benefit: Keeps dependencies flowing cleanly in one direction so core logic can be tested and reused without pulling in HTTP routes or frameworks.
-- @source: Martin (2012) — The Clean Architecture (The Dependency Rule) | https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
-- @source: Lakos (1996) — Large-Scale C++ Software Design (Levelization & Acyclic Dependencies) | https://en.wikipedia.org/wiki/Large-Scale_C%2B%2B_Software_Design
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM units WHERE layer_policy IN ('layered_backend', 'layered_clean_arch')) = 0 THEN 'No units declare an explicit layer policy (layered_backend or layered_clean_arch); Studio L0-L4 lanes are inferred topological tiers, not enforced layer boundaries' ELSE NULL END
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
