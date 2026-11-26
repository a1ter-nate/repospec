-- @id: ddia:notify-before-commit
-- @name: Side-Effect Notification Before Durable Commit
-- @rung: R2
-- @severity: warn
-- @statement: Notifications or async pushes should not fire before the durable datastore write commits in the same handler.
-- @why: Clients woken by a premature push can read stale state or receive notifications for writes that subsequently fail.
-- @fix: Reorder the handler so durable writes commit before sending push notifications or enqueuing downstream events.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'work_flow') = 0 THEN 'No work flows extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'notify_before_commit'
ORDER BY file, line;
