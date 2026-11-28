-- @id: sql:unhealthy-hierarchy
-- @name: Mo ICSE Hotspot — Deep Inheritance Hierarchy
-- @rung: R1
-- @severity: warn
-- @statement: Class inheritance hierarchies should stay shallow (depth < 3) in favor of explicit composition.
-- @why: Mo et al. (2015) linked deep inheritance chains to fragile base-class bugs and tight evolutionary coupling across subclasses.
-- @fix: Flatten deep extends chains by replacing shared base classes with small composed collaborators or plain data interfaces.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Deep inheritance chain (depth=' || COALESCE(json_extract(payload_json, '$.depth'), 3) || ', parent=' || COALESCE(json_extract(payload_json, '$.parent'), '') || ').' AS detail,
  file,
  line
FROM facts
WHERE kind = 'inheritance_smell'
ORDER BY file ASC, line ASC;
