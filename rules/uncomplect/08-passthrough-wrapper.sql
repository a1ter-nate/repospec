-- @id: sql:passthrough-wrapper
-- @name: Uncomplect — Zero-Value Pass-Through Wrapper
-- @rung: R1
-- @severity: warn
-- @statement: Exported service/adapter/wrapper classes should encapsulate a real decision, invariant, or boundary rather than purely forwarding every method call.
-- @why: Zero-value pass-through wrappers add indirection and boilerplate without hiding any secret or enabling real test substitution.
-- @fix: Delete the pass-through wrapper and call the underlying collaborator directly, or move real boundary logic into it.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Zero-value pass-through wrapper class forwards ' || COALESCE(json_extract(payload_json, '$.delegateCalls'), '') || '/' || COALESCE(json_extract(payload_json, '$.methods'), '') || ' methods with zero branching or boundary logic.' AS detail,
  file,
  line
FROM facts
WHERE kind = 'passthrough_wrapper'
ORDER BY file ASC, line ASC;
