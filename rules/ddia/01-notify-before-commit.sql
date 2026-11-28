-- @id: ddia:notify-before-commit
-- @name: Alert or Notification Sent Before Data Is Saved
-- @rung: R2
-- @severity: warn
-- @statement: A handler sends a push notification, email, or downstream event before the database write has finished committing.
-- @why: If the notification arrives before the save finishes (or if the save fails and rolls back), users and downstream workers see stale data or act on changes that never actually happened.
-- @fix: Save and commit the database changes first, then trigger notifications or enqueue events after the commit succeeds (or write to a transactional outbox table).
-- @benefit: Guarantees every alert and background job reflects real, permanently saved data — eliminating ghost notifications and hard-to-reproduce race bugs.
-- @source: Kleppmann (2017) — Designing Data-Intensive Applications (Ch. 7 & 11: Transactions & Stream Processing) | https://dataintensive.net/
-- @source: Richardson — Transactional Outbox Pattern | https://microservices.io/patterns/data/transactional-outbox.html
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
