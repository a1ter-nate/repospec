# RepoSpec — Unified Canonical IR (Option 2) → SCIP + DuckDB Substrate (Option 3)

## Vision

**OpenAPI for everything else in a codebase.**  
Instead of maintaining prose docs, hand-drawn C4 diagrams, or scattered wiki pages that rot on the next PR, `repospec` deterministically extracts one strict, schema-validated **Canonical IR** (`repospec.json`) directly from source code, tests, CI workflows, IaC, and quality/boundary rules — and regenerates it on every commit.

From that single deterministic spec, downstream consumers compile zero-drift outputs:
1. **Visual-first interactive diagrams** (deterministic layered layouts — never force-directed hairballs).
2. **Structural PR diffs** (`repospec diff base.json head.json` — new cross-boundary dependencies, added/removed IaC resources, CI DAG shifts, test rung regressions).
3. **Typed TypeScript / Zod SDK & JSON Schema** (just like OpenAPI → client SDKs).
4. **Agent MCP / query tools** (verified facts instead of stale prose `AGENTS.md`).

---

## Core Design Principles

1. **Deterministic commit-time IR vs. volatile runtime telemetry:**  
   `repospec.json` contains **zero wall-clock timestamps, zero random IDs, and zero runtime timings**. Running `repospec generate` twice on the same commit produces byte-identical JSON (identical SHA-256). Volatile telemetry (CI p50/p95 durations from `ci-viz`, coverage %, flake rates) joins as an optional sidecar keyed by the same deterministic node IDs.
2. **One Unified Graph with Provenance:**  
   Every entity across all 5 domains (`arch`, `ci`, `test`, `iac`, `rules`) is a typed node with a stable, deterministic ID and `{ file, line }` provenance. Cross-domain edges (`verifies`, `deploys`, `governs`, `enforces_in_ci`, `builds_image`) live in the same graph so blast radius spans code → test → CI → cloud infra.
3. **Configurable Storage Mode (`--mode artifact | commit`):**  
   Teams choose whether to commit `.repospec/spec.json` in Git (maximum PR diff visibility + drift CI gate) or generate it ephemerally in CI artifacts (zero repo diff noise). Both modes emit the exact same validated schema.
4. **Domain-Segregated Views, Deterministic Layout:**  
   Never dump 200 raw nodes into a force-directed graph. Render clean layered swimlanes and domain-split views (e.g. IaC split into *Network / Compute / Data / Security / Observability / CI Infra*, Architecture by workspace/layer, CI by workflow/job DAG, Testing by verification rung `R0`–`R8`).

---

## Architecture: Option 2 (v1) → Option 3 (Phase 2 Upgrade)

```text
PHASE 1 (Option 2 — v1, shipped now)
  Fast static extractors (TS/package.json, .github/workflows, .tf/Docker/Firebase, tests, gates/boundaries)
        │  each emits GraphFragment { nodes, edges, rules }
        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Canonical RepoSpec IR  (Zod Schema + JSON Schema, sorted, hashed) │
  └─────────────────────────────────────────────────────────────────────┘
        │
        ├──▶ Visual-First HTML Studio (T3 inline + standalone)
        ├──▶ Structural PR Diff Engine (repospec diff)
        ├──▶ JSON Schema / Typed TS+Zod SDK (repospec schema)
        └──▶ Future: Agent MCP Server / CI Ratchet Gate

PHASE 2 (Option 3 — SCIP + Tree-sitter + DuckDB Upgrade, drop-in underneath)
  SCIP indexers (scip-typescript, rust-analyzer, scip-dotnet)
  + Tree-sitter body facts + terraform show -json + CTRF/SARIF + vstack/ci-viz
        │
        ▼
  Local/CI DuckDB Relational Graph DB (symbols, edges, body_facts, ci_jobs, iac_resources, rules)
        │  flat SQL views + invariant queries (Pattern Atlas / Code Shape Lab)
        ▼
  Materializes the EXACT SAME Canonical RepoSpec IR (zero breaking changes to consumers!)
```

### Why Option 2 First, Then Option 3?

- **Option 2 locks the contract and proves visual feedback immediately** (seconds to run on real polyglot monorepos, zero SCIP indexer setup friction).
- **Option 3 plugs in beneath the `ExtractorPlugin` boundary** when we need deep intra-file / cross-file symbol graphs (e.g. exact call paths from HTTP route → service → Firestore collection/Postgres table, explicit state-machine extraction, radius-2 GoF/anti-pattern motifs, and cross-domain SQL queries like *"every unguarded cron loop mutating a billing table covered only by R7 E2E tests"*).

---

## Roadmap

### Phase 1 — Absolute-Minimum v1 (Current)
- [x] Canonical `RepoSpecV1` Zod schema + JSON Schema exporter (`src/schema.ts`).
- [x] `ExtractorPlugin` interface + deterministic canonicalizer & SHA-256 digest (`src/canonicalize.ts`).
- [x] 4 v1 extractors + cross-domain linker (`src/extractors/`):
  1. **Architecture:** workspace apps/packages/test-packages, internal `workspace:*` dependency graph, turbo tags, OpenAPI/generated-client edges.
  2. **CI:** `.github/workflows/*.yml` triggers, jobs, `needs:` DAG edges, `workflow_run` chains, runner pools, matrix detection, cross-links to apps/packages/gates.
  3. **Testing & Rules:** test suites classified to Verification Stack rungs (`R2`–`R7`), Turbo boundary deny rules, gate registries, `CODEOWNERS`, lint/ratchet configs (`oxlint`, `knip`, `jscpd`), cross-linked to governed nodes.
  4. **IaC:** Terraform `.tf` resources & intra-TF references, Dockerfiles, cloud datastore rules/indexes — categorized into *Network / Compute / Data / Security / Observability / CI Infra* and cross-linked to apps & deploy workflows.
- [x] Structural diff engine (`repospec diff a.json b.json`).
- [x] Visual-first HTML renderer (T3 inline + standalone, deterministic layered SVG/HTML + Design Structure Matrix, cross-domain click inspection).
- [x] First proving runs (read-only, artifact mode) across TypeScript, Rust, and C#/.NET repositories.

### Phase 1.5 — Polish & Commit-Loop Integration
- [ ] Ingest `vstack scan --json` & `ci-viz --no-html` natively as optional enrichers (static findings + optional `telemetry.json` runtime overlay).
- [ ] Ingest `terraform show -json tfplan` when a plan file is present (exact evaluated module graph, zero HCL regex guesswork).
- [ ] Deep intra-app architecture layer extractor (promoting `Layered visual code inspection`'s 11-layer model: routes, state machines, loops/crons, DB tables/collections).
- [ ] `repospec check` CI drift gate (for `--mode commit`) + PR structural diff comment renderer.

### Phase 2 — Option 3 Upgrade (SCIP + Tree-sitter + DuckDB Substrate)
- [ ] `repospec index` builds `.repospec/graph.duckdb` from SCIP (`scip-typescript`, `rust-analyzer`, `scip-dotnet`) + Tree-sitter body facts + CI/IaC/CTRF/SARIF tables.
- [ ] Flat SQL invariant & motif rules (`rules/*.sql`, inspired by Pattern Atlas & Code Shape Lab) compiled into `RepoSpecV1.rules` + violations.
- [ ] Materialize `RepoSpecV1` JSON directly from DuckDB views so every downstream consumer (Visual Studio, PR Diff, TS/Zod SDK, MCP server) gains symbol-level precision with zero schema breakage.
- [ ] MCP server (`repospec mcp`) exposing deterministic graph queries (`blast_radius`, `trace_path`, `rules_for_path`, `unverified_surfaces`) to coding agents.
