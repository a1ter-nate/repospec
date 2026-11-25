---
name: repospec
description: "Deterministic polyglot architecture compiler and SQLite codebase graph. Use when orienting in an unfamiliar codebase, checking blast radius or PR impact, placing a new file with precedent checks, authoring SQL architectural invariants, or generating interactive architecture maps."
---

# RepoSpec

Compile any **TypeScript, JavaScript, Rust, Python, or C# / .NET** repository into a deterministic architectural **Index** (`repospec.sqlite` + `repospec.json`), levelized **Module Atlas**, SQL **Invariants**, and grounded **Passports**, **Precedents**, and interactive **Spine** / **DSM** maps.

> **Prime Directive:** Query the compiled SQLite **Index** for structural truth before editing code or reviewing boundaries. Never guess module placement, layer rules, or blast radius from memory or stale prose docs.

## Shared Vocabulary (Leading Words)

Use these exact terms across plans, reviews, and SQL rules:

- **Index**: the deterministic commit-time graph (`repospec.sqlite` + `repospec.json` + SHA-256 digest) compiled by `repospec generate`.
- **Passport**: a grounded file or unit fact sheet from `repospec explain` (layer **Axis**/**Rank**, domain, fan-in/fan-out, direct tests, entities, FK cascades, scoped rules, active violations).
- **Precedent**: verified sibling placement from `repospec precedents`; returns `destination: null` when ungrounded so agents stop and ask instead of guessing.
- **Axis**: canonical layer role (`pipeline` | `integration` | `foundation`) paired with a numeric **Rank** shared identically by extractors, SQL rules, and diagram lanes.
- **Invariant**: a declarative SQL rule under `rules/*.sql` evaluated against `repospec.sqlite` and projected onto graph nodes and edges with `file:line` evidence.
- **Contract**: an authoritative interface spec (such as OpenAPI) reconciled ahead of unmounted AST sub-router fragments.
- **Spine**: adjacent-rank forward flow plus violations drawn at rest; full dense meshes sit behind 1-hop hover ego-graphs and the zero-crossing **Matrix (DSM)** view.
- **Module Atlas**: Tarjan-condensed, topologically levelized (`L0 Entry → Ln Foundation`) module map with per-module public API symbols, IO capabilities (`DB`/`HTTP`/`FS`/`PROC`/`ENV`/`PURE`), Ousterhout depth, and cyclic tangle flags (`module_cards` + `file_symbols`).

## Workflow (Execute in Order)

### Phase 0: Build or Locate the Index

Run `bun src/cli.ts generate <repoDir> --out <dir> --mode artifact` (see `bun src/cli.ts --help` for subcommand flags) or locate an existing `repospec.sqlite` matching `HEAD`.

- **Done when:** `repospec.sqlite` exists for the target commit, `diagnostics` reports `0` errors, and the spec digest is recorded.

### Phase 1: Orient Before Editing (Passport & Precedents)

1. Run `explain <file-or-unit> --db <repospec.sqlite>` for every file or unit you plan to modify.
2. Before creating a new file, run `precedents --path <relpath> --db <repospec.sqlite>` (or `--intent "<goal>"`). Treat `destination: null` as a hard stop: ask the user where the module belongs instead of inventing a new folder.

- **Done when:** every touched file's layer **Axis**/**Rank**, blast radius, governing rules, and active violations are in hand, and every new file path matches a verified **Precedent** or user decision.

### Phase 2: Inspect Architecture & Invariants

1. Query `repospec.sqlite` for structural risks in scope (`query <db> --named violations`, `http_endpoints`, `fk_cascades`, `doc_drift`, or ad-hoc SQL).
2. For dense layer or domain refactors, open `repospec.html`, trace the **Spine**, hover nodes for 1-hop ego-graphs, and press `M` to inspect cycles and layer inversions in the **Matrix (DSM)** view.
3. Read [references/invariants-and-sql.md](references/invariants-and-sql.md) when authoring or debugging `rules/*.sql` invariants.

- **Done when:** every active `fail` or `warn` **Invariant** touching the scope is anchored to exact `file:line` evidence and accounted for in the plan.

### Phase 3: Verify Impact & Drift

1. Run `impact <base..head> --db <repospec.sqlite> --repo <repoDir> --format github` to produce a grounded PR blast-radius brief.
2. Run `check <repoDir> --spec <repospec.json>` to enforce zero digest drift, zero error diagnostics, and zero failing invariants.
3. For independent architectural audits on high-risk boundary changes, dispatch a subagent and **start every subagent with a fresh context window**.
4. When tightening test rungs or static checks alongside architectural fixes, Call the Skill tool with `"veristack"`.

- **Done when:** `repospec check` exits `0` (or every remaining warning is explicitly documented with rationale) and the impact brief lists every affected unit, entity, and invariant delta.

## Hard Guardrails

- Query `repospec.sqlite` instead of trusting prose `AGENTS.md` or wiki diagrams; fix or report any `v_doc_drift` hit you uncover.
- Treat `Static Paths` in the studio as static import wiring, never observed runtime telemetry.
- Keep `repospec.json` pure commit-time static facts (zero wall-clock timestamps, zero random IDs, zero repo-specific hardcoding inside `src/` or `rules/`).

## Disclosed References (Load Only the Active Branch)

| Branch / Need | Reference |
| :--- | :--- |
| Authoring `rules/*.sql` invariants, SQLite views, and graph anchor columns | [references/invariants-and-sql.md](references/invariants-and-sql.md) |
| Polyglot layer **Axis**/**Rank** model, external vendor config, **Contract** reconciliation, and Studio **Spine** / **DSM** | [references/taxonomy-and-studio.md](references/taxonomy-and-studio.md) |
