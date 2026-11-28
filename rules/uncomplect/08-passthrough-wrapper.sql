-- @id: sql:passthrough-wrapper
-- @name: Empty Pass-Through Wrapper Class
-- @rung: R1
-- @severity: warn
-- @statement: An exported service or adapter class forwards every method directly to another object without adding validation, error handling, translation, or hidden state.
-- @why: Pass-through wrappers add extra files and layers of indirection without protecting callers from anything, slowing down navigation and refactoring.
-- @fix: Delete the empty wrapper and call the underlying module directly, or move genuine boundary logic (like retries, auth, or mapping) into it.
-- @benefit: Less ceremony, shorter stack traces, and a shallower codebase where every abstraction earns its keep.
-- @source: Ousterhout (2018) — A Philosophy of Software Design (Shallow Modules & Pass-Through Methods) | https://web.stanford.edu/~ouster/cgi-bin/book.php
-- @source: Joel Hooks — Uncomplect Skill (Zero-Value Indirection) | https://github.com/joelhooks/skills
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Class "' || COALESCE(symbol, key) || '" forwards ' || COALESCE(json_extract(payload_json, '$.delegateCalls'), '') || ' of ' || COALESCE(json_extract(payload_json, '$.methods'), '') || ' methods directly to an inner object with no added logic.' AS detail,
  file,
  line
FROM facts
WHERE kind = 'passthrough_wrapper'
ORDER BY file ASC, line ASC;
