-- @id: sql:projection-authority-leak
-- @name: Uncomplect — Read-Model / Projection Authority Leak
-- @rung: R1
-- @severity: warn
-- @statement: Read-model projections, presenters, formatters, and view-model mappers (to-*.ts, presenter*, projection*) must remain read-only and never mutate authoritative datastore state.
-- @why: Mutating authoritative state inside projection/presentation glue complects read views with write authority and breaks predictable state transitions.
-- @fix: Keep projection/formatter modules pure and route all state mutations through the authoritative write owner.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  file AS subject,
  'Projection/read-model module invokes state mutation (' || COALESCE(json_extract(payload_json, '$.token'), '') || ').' AS detail,
  file,
  line
FROM facts
WHERE kind = 'projection_authority_leak'
ORDER BY file ASC, line ASC;
