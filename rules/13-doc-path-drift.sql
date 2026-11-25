-- @id: sql:doc-path-drift
-- @name: Scoped Guidance Docs Must Reference Existing Repo Paths
-- @rung: R0
-- @severity: info
-- @statement: Backticked file paths in AGENTS.md / CLAUDE.md guidance files should resolve to existing files in the repository.
-- @why: Stale paths in guidance documents mislead both new developers and coding agents during architecture onboarding.
-- @fix: Update or remove the stale file path reference in the guidance document.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM doc_path_refs) = 0 THEN 'No backticked repo path references in guidance docs' ELSE NULL END
SELECT
  doc_file || ':' || referenced_path AS subject,
  'Guidance doc ' || doc_file || ' references missing path `' || referenced_path || '`' AS detail,
  doc_file AS file,
  line AS line,
  NULL AS target_node_id,
  NULL AS edge_from_id,
  NULL AS edge_to_id,
  NULL AS edge_kind
FROM v_doc_drift
ORDER BY doc_file ASC, line ASC;
