-- @id: ddia:serial-independent-awaits
-- @name: Consecutive Serial Awaits on Hot Path
-- @rung: R2
-- @severity: warn
-- @statement: Consecutive independent reads or notifications on the critical path should execute concurrently via Promise.all or Promise.allSettled.
-- @why: Serializing independent IO hops compounds tail latency across every request.
-- @fix: Group independent reads or notification pushes with Promise.all / Promise.allSettled or offload them to an async queue.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM facts WHERE kind = 'work_flow') = 0 THEN 'No work flows extracted.' ELSE '' END;

SELECT
  COALESCE(json_extract(payload_json, '$.subject'), key) AS subject,
  COALESCE(json_extract(payload_json, '$.summary'), key) AS detail,
  file,
  line
FROM facts
WHERE kind = 'ddia_hazard'
  AND json_extract(payload_json, '$.hazardKind') = 'serial_independent_awaits'
ORDER BY file, line;
