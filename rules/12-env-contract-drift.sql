-- @id: sql:env-contract-drift
-- @name: Runtime Environment Variable Contract Visibility
-- @rung: R4
-- @severity: info
-- @statement: Environment variables read in runtime code should be documented in .env.example or provisioned in IaC/CI configuration.
-- @why: Undocumented environment variables cause silent boot failures for new developers and staging environments.
-- @fix: Document the variable key (without secret values) in .env.example or verify its IaC secret/env binding.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM env_bindings WHERE source_kind = 'code_read') = 0 THEN 'No runtime environment variable reads indexed' WHEN (SELECT COUNT(*) FROM env_bindings WHERE source_kind != 'code_read') = 0 THEN 'No .env.example or IaC env declarations indexed' ELSE NULL END
WITH declared AS (
  SELECT DISTINCT env_name FROM env_bindings WHERE source_kind != 'code_read'
),
reads AS (
  SELECT env_name, MIN(file) AS sample_file, MIN(line) AS sample_line, GROUP_CONCAT(DISTINCT unit) AS units
  FROM env_bindings
  WHERE source_kind = 'code_read'
    AND env_name NOT IN ('NODE_ENV', 'CI', 'PORT', 'HOST', 'HOME', 'PATH', 'PWD', 'TERM', 'USER', 'DEBUG', 'TZ', 'RUST_LOG', 'RUST_BACKTRACE')
  GROUP BY env_name
)
SELECT
  r.env_name AS subject,
  'Env var "' || r.env_name || '" is read in code (' || r.units || ') but absent from .env.example / IaC declarations' AS detail,
  r.sample_file AS file,
  r.sample_line AS line,
  NULL AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM reads r
LEFT JOIN declared d ON d.env_name = r.env_name
WHERE d.env_name IS NULL
ORDER BY r.env_name ASC;
