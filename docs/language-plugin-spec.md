# RepoSpec Language Plugin Specification

RepoSpec's flow and data-lifecycle engine (`@repospec/flows`) is **language-agnostic by design**. Any language — built-in (`TypeScript/JS`, `Rust`, `C#/.NET`) or community/repo-local (`.repospec/languages/*.ts`) — plugs into the exact same canonical IR, DDIA hazard detector, 6 SQL invariants, spatial SVG renderers, and interactive Studio `Flows` Workbench.

---

## 1. Quick Start: Add a Language Plugin in 60 Seconds

Scaffold a starter plugin in your repo:

```bash
repospec eject language
```

Or create `.repospec/languages/go.ts` directly. RepoSpec automatically discovers and loads every `.ts` / `.mjs` file in `.repospec/languages/` during `repospec scan`, `repospec generate`, `repospec check`, and `repospec flows`.

---

## 2. Plugin Interface Contract

Import `defineFlowLanguage` (and optionally `detectFlowHazards`) from `repospec/flows/languages`:

```ts
export interface FlowLanguageFileContext {
  readonly repoDir: string;
  readonly relFile: string;
  readonly unitSlug: string;
  readonly text: string;
  readonly anchors: readonly DeclarativeFlowAnchor[];
}

export interface FlowLanguagePlugin {
  readonly id: string;                           // unique lowercase slug, e.g. "go", "java", "python"
  readonly label: string;                        // human display name, e.g. "Go"
  readonly extensions: readonly string[];        // lowercase file extensions with leading dot, e.g. [".go"]
  readonly extractFlows?: (ctx: FlowLanguageFileContext) => WorkFlowRecord[];
  readonly extractFieldEvents?: (ctx: FlowLanguageFileContext) => RawFieldEvent[];
  readonly extractStateMachines?: (ctx: FlowLanguageFileContext) => ExtractedStateMachine[];
  readonly extractAsyncEndpoints?: (ctx: FlowLanguageFileContext) => RawAsyncEndpoint[];
}
```

All four extractor hooks are **optional** — implement only what makes sense for your language or framework, and everything else degrades cleanly.

---

## 3. What Each Hook Produces (Canonical IR)

### A. `extractFlows(ctx) -> WorkFlowRecord[]`
Extracts ordered execution steps from entrypoints (HTTP handlers, RPC methods, queue consumers, cron jobs, or `.repospec/flows.yaml` journey anchors).

Each step (`FlowStep`) records:
- `index`: zero-based order inside the handler
- `fn`: symbol/expression name (e.g. `repo.UpdateDevice`, `sqlx::query`)
- `op`: one of `"db_read" | "db_write" | "tx_commit" | "cache_read" | "cache_del" | "external_http" | "notify" | "async_enqueue" | "response_send" | "span" | "call"`
- `lane`: spatial swimlane (`"client" | "handler" | "cache" | "datastore" | "external" | "async_push"`)
- `file`, `line`: exact 1-based source location for Studio code preview & click-to-jump
- `parallelGroup?`: shared positive integer for steps running concurrently (`Promise.all`, `tokio::join!`, `Task.WhenAll`, `errgroup`)
- `afterResponse`: `true` if the step runs after a happy-path `2xx` `response_send`
- `bestEffort`: `true` if errors are caught/swallowed

Pass `(flowName, ctx.relFile, steps, responseStepIndex, commitStepIndex)` to `detectFlowHazards(...)` to get all 5 flow-level DDIA hazards automatically (`notify_before_commit`, `invalidate_before_write`, `serial_independent_awaits`, `blocking_noncritical_io`, `write_on_poll`).

### B. `extractFieldEvents(ctx) -> RawFieldEvent[]`
Extracts field-level mutations and pure read-time derivations on datastore entities:
- `entity`: normalized collection/table name (e.g. `"devices"`, `"orders"`)
- `field`: column/property name (e.g. `"status"`, `"internalHidden"`)
- `kind`: `"writer"` or `"reader"`
- `mode`: `"write" | "delete" | "tx"`
- `derived`: `true` for pure read-time projection functions (`Derive*`, `derive_*`, `compute_*`)

RepoSpec automatically aggregates all `RawFieldEvent` records across languages into **Entity Ownership Hubs** and flags `ddia:multi-writer-unowned-field` when 3+ distinct files mutate a field without a single transactional owner.

### C. `extractStateMachines(ctx) -> ExtractedStateMachine[]`
Extracts declared state enums/constants and their allowed transitions + guard predicates (`{ from, to, event, guard? }`). Records are emitted into both `facts` (`kind = "state_machine"`) and top-level `spec.stateMachines`, powering Studio's interactive guarded Statechart SVG.

### D. `extractAsyncEndpoints(ctx) -> RawAsyncEndpoint[]`
Extracts cross-process async producers and consumers:
- `role`: `"producer" | "consumer"`
- `channel`: normalized channel key (e.g. `"queue:order-created"`, `"pubsub:billing-events"`, `"fcm:status-update"`)
- `transport`: `"fcm" | "pubsub" | "cloud_task" | "firestore_trigger" | "cron" | "webhook" | "queue"`
- `delivery`: `"best-effort" | "at-least-once" | "scheduled"`
- `ref`: `{ fn, file, line, language }`

RepoSpec stitches producers and consumers across **all** languages in O(N) time (for example, a Rust producer publishing `"queue:device-sync"` automatically links to a C# `[ServiceBusTrigger("device-sync")]` consumer!).

---

## 4. Complete Example: Go Language Plugin (`.repospec/languages/go.ts`)

```ts
import { defineFlowLanguage, detectFlowHazards } from "repospec/flows/languages";

export default defineFlowLanguage({
  id: "go",
  label: "Go",
  extensions: [".go"],
  extractFlows(ctx) {
    if (ctx.relFile.endsWith("_test.go")) return [];
    const flows = [];
    for (const m of ctx.text.matchAll(/func\s+(?:\([^)]*\)\s+)?([A-Z][A-Za-z0-9_]*)\s*\([^)]*http\.ResponseWriter[^)]*\)\s*\{/g)) {
      const fnName = m[1];
      if (!fnName || m.index === undefined) continue;
      const startLine = ctx.text.slice(0, m.index).split("\n").length;
      const snippet = ctx.text.slice(m.index, m.index + 3000);
      const steps = [];
      for (const [offset, line] of snippet.split("\n").entries()) {
        const ln = startLine + offset;
        if (/\.Query(?:Row)?Context\(/.test(line)) {
          steps.push({ index: steps.length, fn: "db.Query", op: "db_read" as const, lane: "datastore" as const, file: ctx.relFile, line: ln, afterResponse: false, bestEffort: false });
        } else if (/\.ExecContext\(|\.Commit\(/.test(line)) {
          steps.push({ index: steps.length, fn: "db.Exec", op: "tx_commit" as const, lane: "datastore" as const, file: ctx.relFile, line: ln, afterResponse: false, bestEffort: false });
        } else if (/cache\.Del\(/.test(line)) {
          steps.push({ index: steps.length, fn: "cache.Del", op: "cache_del" as const, lane: "cache" as const, file: ctx.relFile, line: ln, afterResponse: false, bestEffort: false });
        } else if (/json\.NewEncoder\(w\)\.Encode/.test(line)) {
          steps.push({ index: steps.length, fn: "w.Encode", op: "response_send" as const, lane: "client" as const, file: ctx.relFile, line: ln, afterResponse: false, bestEffort: false });
        }
      }
      if (steps.length < 2) continue;
      const resIdx = steps.findLastIndex((s) => s.op === "response_send");
      const commitIdx = steps.findLastIndex((s) => s.op === "tx_commit" || s.op === "db_write");
      const hazards = detectFlowHazards(fnName, ctx.relFile, steps, resIdx >= 0 ? resIdx : null, commitIdx >= 0 ? commitIdx : null);
      flows.push({
        id: `flow:${ctx.unitSlug}:${ctx.relFile}:${fnName}`,
        name: fnName,
        entryFn: fnName,
        triggerKind: "http" as const,
        file: ctx.relFile,
        line: startLine,
        unit: ctx.unitSlug,
        steps,
        responseStepIndex: resIdx >= 0 ? resIdx : null,
        commitStepIndex: commitIdx >= 0 ? commitIdx : null,
        serialAwaitCount: steps.filter((s) => s.op !== "response_send").length,
        hazards,
      });
    }
    return flows;
  },
});
```

---

## 5. Built-In Language Matrix

| Language | Plugin ID | Extensions | Flows & Parallelism | Data Lifecycles | Statecharts | Async Stitching |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript / JS** | `typescript` | `.ts`, `.tsx`, `.mts`, `.js`, `.mjs` | AST `await`, `Promise.all/allSettled`, 2xx wall, `runBusinessSpan` | Object patch writes, `FieldValue.delete()`, `derive*` readers | `ALLOWED_TRANSITIONS` + `GUARDS`, `switch (event.type)` reducers | FCM, Pub/Sub, Firestore triggers |
| **Rust** | `rust` | `.rs` | `async fn`, `.await`, `tokio::join!`/`try_join!`, `Ok(Json)` wall | SQL `UPDATE ... SET`, `derive_*`/`compute_*` projections | `enum *State/Stage/Phase/Status` + `match` arms with `if` guards | `publish`/`send_record`/`enqueue` ↔ `subscribe`/`consume` |
| **C# / .NET** | `csharp` | `.cs` | `async Task`, `await`, `Task.WhenAll`, `Ok()`/`Results.Ok()` wall | EF Core `.SetProperty`, entity mutations + `SaveChangesAsync`, `Derive*` | `enum *State/Stage/Phase/Status` + `switch` expressions with `when` guards | MassTransit `Publish<T>` ↔ `IConsumer<T>`, ServiceBus/Queue triggers |

---

## 6. Determinism & Quality Checklist for Plugin Authors

1. **Zero wall-clock timestamps or random IDs** — emit deterministic IDs (`flow:<unit>:<file>:<fn>`, `sm:<unit>:<name>`) and stable sort order so `repospec generate` stays byte-identical on the same commit.
2. **Skip test files** (`_test.go`, `*_test.rs`, `*Test.cs`, `*.test.ts`) so mock setups don't pollute production critical paths or writer counts.
3. **Only mark happy-path `2xx` responses as `response_send`** — ignore `4xx`/`5xx` early-return guard clauses so critical-path counts stay accurate.
4. **Emit exact 1-based `line` numbers** — Studio uses `file:line` for syntax-highlighted code snippets and click-to-jump navigation.
5. **Linear-time per file** — avoid nested `O(N^2)` scans so large monorepos stay within RepoSpec's sub-linear Big-O budget.
