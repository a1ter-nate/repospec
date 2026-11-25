# RepoSpec

**OpenAPI for everything else in a codebase.**

RepoSpec is a deterministic, zero-AI, polyglot **Canonical Architecture Compiler (`v4.1.0`)** for **TypeScript, Rust, and C# / .NET**. It extracts a strict, schema-validated architectural IR (`repospec.json`) and relational SQLite graph index (`repospec.sqlite`) directly from source code, tests, CI workflows, IaC, OpenAPI specs, SQL migrations, and governance files — and compiles zero-drift downstream artifacts on every commit.

---

## What RepoSpec Produces

From a single deterministic scan (`repospec generate <repoDir>`):

- **Canonical IR & JSON Schema** (`repospec.json`, `repospec.schema.json`) — byte-identical SHA-256 across runs on the same commit (zero wall-clock timestamps, zero random IDs).
- **Relational Graph Index** (`repospec.sqlite`) — indexed files, imports, layers (`pipeline` / `integration` / `foundation` with canonical rank), domains, datastores, Postgres foreign keys, reconciled HTTP endpoints, environment bindings, state machines, loops, governance rules, and doc-path drift.
- **13 Polyglot SQL Architectural Invariants** (`rules/*.sql`) — executable checks for layer inversions, datastore bypasses, vendor SDK leaks, bidirectional domain coupling, workspace cycles, untested high-fan-in modules, env contract drift, and doc-path drift.
- **Interactive Architecture Studio** (`repospec.html` + `--inline` embed) — fixed-rank swimlanes with spine + violations at rest, instant 1-hop hover ego-graph, a native zero-crossing **Design Structure Matrix (DSM)** view, Bow-Tie Focus (`F`), and a Findings-first expandable Inspector.
- **Slim SQLite-Backed TypeScript SDK** (`repospec.ids.ts` + `repospec.sdk.ts`) — compile-time closed union IDs + typed query helpers backed by `bun:sqlite`.
- **Active Developer & Agent Shepherding CLI** (`explain`, `impact`, `precedents`, `query`, `check`, `diff`).

---

## 30-Second Quick Start

Requires [Bun](https://bun.sh) `>= 1.2.0`.

```bash
git clone https://github.com/a1ter-nate/repospec.git
cd repospec
bun install

# Generate canonical IR, SQLite graph DB, slim SDK/IDs, JSON Schema & interactive HTML studio
bun src/cli.ts generate /path/to/repo --out ./out/my-repo --mode artifact --inline

# Explain any file or workspace unit (layer, domain, blast radius, tests, entities, FK cascades, scoped rules)
bun src/cli.ts explain apps/api/src/client/payments.ts --db ./out/my-repo/repospec.sqlite

# PR architecture impact brief from a git diff range
bun src/cli.ts impact HEAD~5..HEAD --db ./out/my-repo/repospec.sqlite --repo /path/to/repo --format github

# Precedent & prohibition check before adding new code (refuses when ungrounded)
bun src/cli.ts precedents --path src/Domain/NewService.cs --db ./out/my-repo/repospec.sqlite

# Run named or ad-hoc SQL queries against the indexed codebase graph
bun src/cli.ts query ./out/my-repo/repospec.sqlite --named violations
bun src/cli.ts query ./out/my-repo/repospec.sqlite --named http_endpoints
bun src/cli.ts query ./out/my-repo/repospec.sqlite --named fk_cascades

# CI gate check (exits non-zero on failing invariants, error diagnostics, or digest drift)
bun src/cli.ts check /path/to/repo --spec ./out/my-repo/repospec.json

# Validate an existing spec or structurally diff two commits
bun src/cli.ts validate ./out/my-repo/repospec.json
bun src/cli.ts diff ./out/base/repospec.json ./out/head/repospec.json
```

---

## Verification

RepoSpec self-verifies with strict TypeScript, declarative Tests-as-Data tables, `fast-check` Property-Based Tests, Stateful Model-Based Tests, `oxlint`, and [Veristack](https://github.com/a1ter-nate/veristack) (`vstack`):

```bash
bun run check
```

---

## License

MIT — see [LICENSE](LICENSE).
