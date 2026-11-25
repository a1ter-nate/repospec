# Taxonomy, Surface Reconciliation & Visual Studio

Consult this reference when extending polyglot extractors, configuring external vendors, reconciling HTTP endpoints, or tuning diagram layout and matrix rendering.

## 1. Canonical Layer Axis & Rank Model

`resolveLayerSemantics()` in `src/taxonomy.ts` is the single source of truth shared by TypeScript, JavaScript, Python, Rust, and C# extractors, SQLite `files`, and `src/layout.ts`:

| Axis | Rank | Lane ID | Typical Layers |
| :--- | :---: | :--- | :--- |
| `pipeline` | `0` | `entry` | `routes`, `middleware`, `routePolicy`, `pages`, `screens`, `views`, `graphql`, `grpc` |
| `pipeline` | `1` | `controllers` | `controller`, `handlers`, `components`, `hooks`, `state`, `context` |
| `pipeline` | `2` | `logic` | `service`, `application`, `usecases`, `orchestrator`, `loops`, `workers` |
| `pipeline` | `3` | `adapters` | `dao`, `repositories`, `persistence`, `prisma`, `drizzle` |
| `integration` | `3` | `adapters` | `client`, `adapters`, `gateway`, `provider`, `billing`, `sdk` |
| `integration` | `4` | `sinks` | Datastores (`Firestore`, `Postgres`, `EF Core`) and external API sinks |
| `foundation` | `5` | `lateral` | `domain`, `models`, `dto`, `errors`, `schema`, `types`, `util`, `shared` |

Keep `persistence` and `integration` at peer rank `3` so every clean hexagonal flow (`Entry → Controllers → Orchestration → Persistence & Integration → Stores & External`) travels strictly left-to-right across adjacent lanes, while `Shared Foundation` sits as a horizontal substrate below.

## 2. External Dependency Classification

`config/default-vendors.json` splits external packages into three semantic classes:

- **`sdks` (`kind: "service"`):** real external services emitted as topology nodes. Generic SDK suffixes (`-js`, `-ts`, `-node`, `-sdk`, `-client`, `-services`, `-rs`) and leading `client-` prefixes normalize automatically so multi-package SDK families collapse to one canonical node.
- **`transports` (`kind: "transport"`):** HTTP client libraries (`axios`, `node-fetch`, `undici`, `reqwest`, `restsharp`). Recorded in `pkg_imports` for SQL rules, excluded from topology service boxes.
- **`observability` (`kind: "observability"`):** ambient cross-cutting aspects (`sentry`, `opentelemetry`, `pino`, `tracing`). Rendered as compact unit badges (`◉ Sentry`) rather than star-topology noise.

## 3. Contract-First Surface Reconciliation

`http_endpoints` tracks `resolution: "contract" | "mounted" | "fragment"`:
- OpenAPI definitions emit `resolution: "contract"`.
- Root app mounts (`app.get("/health", ...)`) and versioned/top-level paths (`/v1/...`, `/webhooks/...`, `/.well-known/...`) emit `resolution: "mounted"`.
- Bare Express sub-router calls (`router.get("/")`, `router.get("/:id")`) emit `resolution: "fragment"`.
- `querySurfaces()` deduplicates by `(unit, method, normalizedPath)`, preferring `contract` first (attaching matched AST `handler_file:line` provenance) and suppressing `fragment` rows whenever canonical routes exist for that unit.

## 4. Studio Rendering Rules (`Flow` vs `Matrix (DSM)`)

- **Edge tiers (`tier`):** violations are always `"violation"`; dense graphs (`> 20` edges) and foundation links split into `"spine"` (drawn at rest) vs `"detail"` (revealed on 1-hop node hover, click, or `All wires` toggle).
- **Zero box-crossings:** primary lanes stay single-column; multi-lane skips and backward arcs route through rounded orthogonal top/bottom corridors.
- **Matrix (DSM):** press `M` or click `Matrix (DSM)` on dense `layers:*` or `domain_coupling` views to inspect every $N \times N$ import weight and red violation/cycle cell with zero overlapping arrows.
- **Inline T3 embeds (`--inline`):** omit `vh` units and `height: 100%` on `html`/`body`, keep transparent outer background, and stay under the 750 KB payload budget.
