-- @id: sql:env-contract-drift
-- @name: Environment Variables Read in Code Are Not Documented
-- @rung: R4
-- @severity: info
-- @statement: Production code reads an environment variable that is missing from .env.example, CI pipelines, and infrastructure configs.
-- @why: Undocumented environment variables cause confusing startup crashes for new teammates, staging deploys, and fresh CI environments.
-- @fix: Add the variable name (with a safe placeholder, never real secrets) to .env.example or bind it explicitly in your IaC/CI configuration.
-- @benefit: Makes local setup and new environment deployments work on the first try without tribal knowledge.
-- @source: The Twelve-Factor App — III. Config | https://12factor.net/config
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM env_bindings WHERE source_kind = 'code_read') = 0 THEN 'No runtime environment variable reads indexed' WHEN (SELECT COUNT(*) FROM env_bindings WHERE source_kind != 'code_read') = 0 THEN 'No .env.example or IaC env declarations indexed' ELSE NULL END
WITH declared AS (
  SELECT DISTINCT env_name FROM env_bindings WHERE source_kind != 'code_read'
),
reads AS (
  SELECT env_name, MIN(file) AS sample_file, MIN(line) AS sample_line, GROUP_CONCAT(DISTINCT unit) AS units
  FROM env_bindings
  WHERE source_kind = 'code_read'
    AND env_name NOT IN (
      'NODE_ENV', 'CI', 'PORT', 'HOST', 'HOME', 'PATH', 'PWD', 'TERM', 'USER', 'DEBUG', 'TZ',
      'RUST_LOG', 'RUST_BACKTRACE', 'OUT_DIR', 'TARGET', 'PROFILE', 'OPT_LEVEL', 'NUM_JOBS',
      'RUSTC', 'RUSTDOC', 'MANIFEST_DIR', 'K_SERVICE', 'K_REVISION', 'K_CONFIGURATION',
      'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'TEMP', 'TMP',
      'HOSTNAME', 'SHELL', 'LANG', 'LC_ALL', 'NO_COLOR', 'FORCE_COLOR', 'COLORTERM'
    )
    AND env_name NOT LIKE 'CARGO_%'
    AND env_name NOT LIKE 'GITHUB_%'
    AND env_name NOT LIKE 'RUNNER_%'
    AND env_name NOT LIKE 'SYSTEM_%'
    AND env_name NOT LIKE 'BUILD_%'
    AND env_name NOT LIKE 'AGENT_%'
    AND env_name NOT LIKE 'AZURE_%'
    AND env_name NOT LIKE 'CLOUD_RUN_%'
    AND env_name NOT LIKE 'WEBSITE_%'
    AND env_name NOT LIKE 'FLY_%'
    AND env_name NOT LIKE 'VERCEL_%'
    AND env_name NOT LIKE 'RAILWAY_%'
    AND env_name NOT LIKE 'NPM_%'
    AND env_name NOT LIKE 'BUN_%'
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
