# SQL Invariants & SQLite Graph Views

Consult this reference when authoring a new rule under `rules/*.sql`, querying `repospec.sqlite`, or debugging how invariant findings anchor onto graph nodes and edges.

## 1. Required SQL Rule Front-Matter

Every file in `rules/*.sql` starts with comment front-matter parsed by `src/indexDb.ts`:

```sql
-- @id: sql:my-invariant
-- @name: Human-Readable Rule Name
-- @rung: R1
-- @severity: error
-- @statement: One-sentence architectural rule statement.
-- @why: Why violating this rule hurts reliability or maintainability.
-- @fix: Concrete positive remediation step.
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM units WHERE layer_policy = 'layered_backend') = 0 THEN 'No layered backend units' ELSE NULL END
```

Rules:
- Return **zero rows** on pass; every returned row is one violation.
- Provide `@applicability` so non-applicable ecosystems report `na` with an explicit reason instead of false passes.
- Keep SQL rules generic across repositories; put vendor package patterns in `config/default-vendors.json`, never hardcoded in SQL.

## 2. Standard Result Columns & Graph Projection

Return these exact column names so `projectInvariantsToGraph()` and `resolveEvidenceAnchors()` automatically highlight nodes, edges, and Inspector disclosures:

| Column | Required | Purpose |
| :--- | :---: | :--- |
| `subject` | Yes | Stable grouping key (`unit:layer:detail`) |
| `detail` | Yes | Actionable 1-line finding shown in Inspector & Checks |
| `file` | Yes | Repo-relative source path for GitHub permalinks |
| `line` | Yes | 1-based line number |
| `target_node_id` | Recommended | Node ID receiving the finding badge (`arch:layer:...`, `arch:app:...`, `arch:datastore:...`) |
| `edge_from_id` | Optional | Source node ID when the violation belongs to a directed edge |
| `edge_to_id` | Optional | Target node ID; marks the matching diagram edge crimson (`violation: true`) |
| `edge_kind` | Optional | Edge kind hint (`imports_layer`, `bypasses_layer`, `imports_domain`) |

## 3. Core SQLite Views

Query these pre-built views instead of joining raw tables repeatedly:

- `v_prod_files`: production source files (excludes tests and `ops_script`) joined with `units` (`unit_id`, `unit_slug`, `unit_archetype`, `layer_policy`, `has_persistence_layer`, `has_integration_layer`, `layer_axis`, `layer_rank`).
- `v_prod_imports`: runtime (`type_only = 0`) imports between two `v_prod_files`, enriched with source/target unit and layer policy columns.
- `v_file_passport`: per-file `prod_fan_in`, `fan_out`, `direct_test_importers`, and `active_violation_count`.
- `v_unit_passport`: per-unit file/line totals, reconciled `endpoint_count`, and `violation_count`.
- `v_doc_drift`: broken backticked file path references found in `AGENTS.md` / `CLAUDE.md`.
