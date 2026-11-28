-- @id: sql:iac-undeclared-deploy-input
-- @name: Cloud Resource Controlled by Undocumented Deploy Flag
-- @rung: R4
-- @severity: warn
-- @statement: A Terraform or OpenTofu resource turns on or off based on a variable or TF_VAR_* input that is not documented in .env.example or .env.schema.
-- @why: When a conditional cloud resource depends on an undocumented deploy flag, a new environment or CI pipeline can silently skip creating critical infrastructure — or accidentally destroy it.
-- @fix: Document the flag in .env.example / .env.schema with a clear default, or remove the conditional toggle if the resource should always exist.
-- @benefit: Every deploy environment becomes reproducible and predictable with no hidden switches needed to bring up the stack.
-- @source: Humble & Farley (2010) — Continuous Delivery (Configuration Management) | https://continuousdelivery.com/
-- @source: The Twelve-Factor App — III. Config | https://12factor.net/config
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM nodes WHERE kind = 'iac_resource') = 0 THEN 'No Terraform/OpenTofu resources indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Cloud resource "' || COALESCE(json_extract(payload_json, '$.address'), '') || '" depends on deploy flag "' || COALESCE(json_extract(payload_json, '$.inputName'), '') || '", which is missing from .env.example / .env.schema.' AS detail,
  file,
  line
FROM facts
WHERE kind = 'iac_undeclared_deploy_input'
ORDER BY file ASC, line ASC;
