-- @id: plugin:hotspot-radar-detected
-- @name: Hotspot Radar File Complexity Watch
-- @rung: R1
-- @severity: warn
-- @statement: Track source files indexed by the Hotspot Radar reference plugin.
-- @why: Demonstrates composable plugin-contributed SQL invariants over custom plugin facts.
-- @fix: Toggle the Hotspot Radar plugin off or refactor flagged hotspots into smaller modules.

SELECT
  key AS subject,
  'Hotspot radar indexed ' || file AS detail,
  file,
  line
FROM facts
WHERE kind = 'hotspot_radar';
