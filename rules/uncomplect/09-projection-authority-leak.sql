-- @id: sql:projection-authority-leak
-- @name: View Formatter or Projection Mutates Saved Data
-- @rung: R1
-- @severity: warn
-- @statement: A file named as a presenter, formatter, view model, or read projection (such as to-*.ts) directly writes to or modifies saved application state.
-- @why: People and tests expect view formatters and projections to be safe, read-only transforms; hidden database writes inside them cause surprising side effects and race conditions.
-- @fix: Remove the write call from the formatter/projection and trigger state changes exclusively through the owning command or service handler.
-- @benefit: Read views stay pure, predictable, and effortless to test, while all state mutations remain easy to audit in one place.
-- @source: Fowler (2011) — CQRS (Command Query Responsibility Segregation) | https://martinfowler.com/bliki/CQRS.html
-- @source: Joel Hooks — Uncomplect Skill (Read-Model Authority Boundaries) | https://github.com/joelhooks/skills
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  file AS subject,
  'Read-only presenter/projection file "' || file || '" performs a state write (' || COALESCE(json_extract(payload_json, '$.token'), '') || ').' AS detail,
  file,
  line
FROM facts
WHERE kind = 'projection_authority_leak'
ORDER BY file ASC, line ASC;
