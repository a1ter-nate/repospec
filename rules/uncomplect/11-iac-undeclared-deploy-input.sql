-- @id: sql:iac-undeclared-deploy-input
-- @name: IaC Undeclared Conditional Deploy Input
-- @rung: R4
-- @severity: warn
-- @statement: Terraform/OpenTofu resources conditionally gated by var.* or TF_VAR_* inputs should be declared in .env.schema or .env.example.
-- @why: Undeclared conditional IaC flags silently omit or destroy cloud resources when deploy environments miss an undocumented input.
-- @fix: Declare the deploy input in .env.schema/.env.example or make the resource unconditionally provisioned.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM nodes WHERE kind = 'iac_resource') = 0 THEN 'No Terraform/OpenTofu resources indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Conditional IaC resource ' || COALESCE(json_extract(payload_json, '$.address'), '') || ' depends on undeclared deploy input ' || COALESCE(json_extract(payload_json, '$.inputName'), '') || '.' AS detail,
  file,
  line
FROM facts
WHERE kind = 'iac_undeclared_deploy_input'
ORDER BY file ASC, line ASC;
