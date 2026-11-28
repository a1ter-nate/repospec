-- @id: sql:doc-path-drift
-- @name: Guidance Docs Point to Files That No Longer Exist
-- @rung: R0
-- @severity: info
-- @statement: An AGENTS.md, CLAUDE.md, or README guidance file mentions a file path that has been renamed, moved, or deleted.
-- @why: Outdated file paths in guidance docs send new developers and AI coding agents down dead ends and cause edits to land in the wrong places.
-- @fix: Update the path to its current location or remove the obsolete reference from the doc.
-- @benefit: Keeps onboarding docs trustworthy and prevents developers and agents from wasting time hunting for missing files.
-- @source: Winters, Manshreck & Wright (2020) — Software Engineering at Google (Ch. 10: Documentation Decay) | https://abseil.io/resources/swe-book/html/ch10.html
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
