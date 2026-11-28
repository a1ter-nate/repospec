-- @id: sql:unhealthy-hierarchy
-- @name: Deep Class Inheritance Chain
-- @rung: R1
-- @severity: warn
-- @statement: A class inherits through 3 or more layers of parent classes instead of composing small collaborators.
-- @why: Deep inheritance chains hide behavior across multiple ancestor files — changing a base class can silently break distant subclasses in hard-to-spot ways.
-- @fix: Flatten the inheritance chain by passing shared behavior as small helper objects or plain functions (composition over inheritance).
-- @benefit: Behavior becomes explicit and local to each class, eliminating fragile base-class regressions and making the code far easier to follow.
-- @source: Mo et al. (2015) — Hotspot Patterns: The Formal Definition and Automatic Detection of Architecture Smells | https://ieeexplore.ieee.org/document/7158495
-- @source: Gamma et al. (1994) — Design Patterns (Favor Object Composition Over Class Inheritance) | https://en.wikipedia.org/wiki/Composition_over_inheritance
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'Class "' || COALESCE(symbol, key) || '" sits ' || COALESCE(json_extract(payload_json, '$.depth'), 3) || ' levels deep in an inheritance chain (extending "' || COALESCE(json_extract(payload_json, '$.parent'), '') || '").' AS detail,
  file,
  line
FROM facts
WHERE kind = 'inheritance_smell'
ORDER BY file ASC, line ASC;
