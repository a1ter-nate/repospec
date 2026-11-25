import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRepoSpec } from "../src/cli.ts";
import { buildFilePassport, buildPrecedentsReport } from "../src/passport.ts";
import { renderVisualHtml } from "../src/render.ts";
import { buildCommitArchDiff } from "../src/studio/commitDiff.ts";
import { canonicalizeGitRemote } from "../src/taxonomy.ts";

function makeFixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-v4-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

describe("RepoSpec v5 polyglot suite [REQ-HYGIENE-01]", () => {
  test("TypeScript monorepo: domains.json object shapes, scripts ops_script, OpenAPI, slim SDK, determinism", async () => {
    const dir = makeFixture({
      "package.json": JSON.stringify({ name: "@demo/repo", workspaces: ["apps/*", "packages/*"] }),
      "AGENTS.md": "# Repo Guide\nSee `apps/api/functions/dao/orders.ts` and `missing/stale.ts`.\n",
      ".env.example": "PAY_API_KEY=\n",
      "tools/domains.json": JSON.stringify({
        domains: [{ id: "orders", ownedPaths: ["apps/api/functions/dao/orders.ts", "apps/api/functions/service/orders.ts"] }],
        sharedFiles: { leaseHours: 1, paths: ["apps/api/functions/shared.ts"] },
        sharedCollections: [{ collection: "orders", writers: ["orders"] }],
      }),
      "apps/api/package.json": JSON.stringify({
        name: "@demo/api",
        dependencies: { "@demo/shared": "workspace:*", express: "^4.0.0" },
      }),
      "apps/api/openapi.json": JSON.stringify({
        openapi: "3.0.0",
        paths: {
          "/orders": {
            get: { operationId: "listOrders", security: [{ bearerAuth: [] }] },
            post: { operationId: "createOrder", security: [] },
          },
        },
      }),
      "apps/api/functions/routes/orders.ts": `
        import express from "express";
        import axios from "axios";
        import { getOrder } from "../service/orders";
        const router = express.Router();
        router.get("/", (_req: any, res: any) => res.json({ ok: Boolean(axios), getOrder }));
        export default router;
      `,
      "apps/api/functions/dao/orders.ts": `
        export function loadOrder(db: any) {
          const k = process.env.PAY_API_KEY;
          const u = process.env.UNDOCUMENTED_FLAG;
          return db.collection("orders").doc(k || u);
        }
      `,
      "apps/api/functions/service/orders.ts": `
        import { loadOrder } from "../dao/orders";
        export function getOrder(db: any) { return loadOrder(db); }
      `,
      "apps/api/functions/client/auth.ts": `
        import { loadOrder } from "../dao/orders";
        export const broken = loadOrder;
      `,
      "apps/api/scripts/backfill.ts": `
        export function run(db: any) { return db.collection("orders").get(); }
      `,
      "apps/api/functions/__tests__/orders.test.ts": `
        import { getOrder } from "../service/orders";
        export const ok = getOrder;
      `,
      "packages/shared/package.json": JSON.stringify({ name: "@demo/shared" }),
      "packages/shared/src/index.ts": `export const v = 1;`,
    });

    const dbPath = path.join(dir, "out.sqlite");
    const run1 = await generateRepoSpec(dir, "artifact", dbPath);
    const run2 = await generateRepoSpec(dir, "artifact", path.join(dir, "out2.sqlite"));

    expect(run1.spec.schemaVersion).toBe("5.0.0");
    expect(run1.digest).toBe(run2.digest);
    expect(run1.spec.diagnostics.filter((d) => d.severity === "error").length).toBe(0);
    expect(run1.spec.modules.length).toBeGreaterThanOrEqual(3);
    expect(run1.spec.diagrams.some((d) => d.category === "modules")).toBe(true);

    const bypass = run1.spec.invariants.find((i) => i.id === "sql:layer-bypass-datastore");
    expect(bypass?.status).toBe("pass");
    expect(bypass?.violationCount).toBe(0);

    const inv = run1.spec.invariants.find((i) => i.id === "sql:layer-inversion");
    expect(inv?.status).toBe("fail");
    expect(inv?.violationCount).toBe(1);
    expect(inv?.evidence[0]?.anchors?.length).toBeGreaterThan(0);

    const drift = run1.spec.invariants.find((i) => i.id === "sql:doc-path-drift");
    expect(drift?.violationCount).toBe(1);

    expect(run1.spec.summary.httpEndpoints).toBe(2);
    expect(run1.spec.surfaces.endpoints.every((ep) => ep.path !== "/")).toBe(true);
    expect(run1.spec.nodes.some((n) => n.kind === "external_service" && n.label.toLowerCase() === "axios")).toBe(false);
    const daoNode = run1.spec.nodes.find((n) => n.kind === "code_layer" && n.label === "dao");
    expect(daoNode?.meta.layerAxis).toBe("pipeline");
    expect(daoNode?.meta.layerRank).toBe(3);
    expect(run1.idsModule).toContain("export type AppId =");
    expect(run1.sdkModule).toContain("openRepoSpec");
    expect(run1.sdkModule).not.toContain("REPOSPEC_MODEL");

    const db = new Database(dbPath, { readonly: true });
    try {
      const passport = buildFilePassport(db, "apps/api/functions/dao/orders.ts");
      expect("found" in passport).toBe(false);
      if (!("found" in passport)) {
        expect(passport.signal.advisory).toBe("observed");
        expect(passport.facts.envNames).toContain("PAY_API_KEY");
      }
      const prec = buildPrecedentsReport(db, { path: "apps/api/functions/new-area/foo.ts" });
      expect(prec.destination).toBeNull();
    } finally {
      db.close();
    }

    const inlineHtml = renderVisualHtml(run1.spec, run1.digest, { inline: true, drilldown: run1.drilldown });
    expect(inlineHtml).not.toContain("100vh");
    expect(inlineHtml).toContain("RepoSpec v5.0.0");
    expect(inlineHtml).toContain("Matrix (DSM)");
    expect(inlineHtml).toContain("renderModuleInspector");
    expect(inlineHtml).toContain("buildFolderContextDiagram");
    expect(run1.drilldown.files.length).toBeGreaterThanOrEqual(4);
    expect(run1.drilldown.edges.length).toBeGreaterThanOrEqual(2);
    const scriptMatch = inlineHtml.match(/<script>\n([\s\S]*?)<\/script>/);
    expect(scriptMatch?.[1]).toBeTruthy();
    expect(() => new Function(scriptMatch?.[1] ?? "")).not.toThrow();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("Rust Cargo workspace: SQL DROP/RENAME/VIEW + FKs, trailing-comma Machine, no .route(model) FP", async () => {
    const dir = makeFixture({
      "Cargo.toml": `[workspace]\nmembers = ["crates/*"]\n[workspace.lints.rust]\nunsafe_code = "forbid"\n`,
      "clippy.toml": `disallowed-methods = [{ path = "std::process::Command::new", reason = "Use scrubbed command wrapper" }]\n`,
      "migrations/001_init.sql": `
        CREATE TABLE workspaces (id uuid PRIMARY KEY);
        CREATE TABLE old_members (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE);
        CREATE TABLE temp_scratch (id uuid PRIMARY KEY);
      `,
      "migrations/002_evolve.sql": `
        DROP TABLE temp_scratch;
        ALTER TABLE old_members RENAME TO members;
        CREATE VIEW active_members AS SELECT id, workspace_id FROM members;
      `,
      "crates/core/Cargo.toml": `[package]\nname = "demo-core"\nversion = "0.1.0"\n`,
      "crates/core/src/lib.rs": `pub mod billing;\npub mod router_like;\n`,
      "crates/core/src/router_like.rs": `
        pub fn choose(c: &Conn, m: &str) { let _ = c.route(m); }
        pub async fn load() { let _ = sqlx::query!("SELECT id FROM members"); }
      `,
      "crates/core/src/billing.rs": `
        use crate::router_like;
        pub enum SubState { Draft, Active, Closed }
        impl Machine for SubState {
          const NAME: &'static str = "subscription";
          const TRANSITIONS: &'static [(Self, &'static str, Self)] = &[
            (
              Self::Draft,
              "activate",
              Self::Active,
            ),
            (Self::Active, "close", Self::Closed),
          ];
        }
        pub async fn fetch_view() {
          let _ = std::env::var("BILLING_URL");
          let _ = sqlx::query!("SELECT * FROM active_members");
        }
      `,
      "crates/server/Cargo.toml": `[package]\nname = "demo-server"\nversion = "0.1.0"\n[dependencies]\ndemo-core = { path = "../core" }\naxum = "0.7"\n`,
      "crates/server/src/main.rs": `
        use demo_core::billing;
        pub fn app() { let _ = Router::new().route("/health", get(ok)); }
      `,
    });

    const run = await generateRepoSpec(dir, "artifact");
    expect(run.spec.repo.ecosystem).toBe("rust");
    expect(run.spec.diagnostics.filter((d) => d.severity === "error").length).toBe(0);

    const entities = run.spec.entities.map((e) => e.entity);
    expect(entities).toContain("members");
    expect(entities).toContain("active_members");
    expect(entities).not.toContain("temp_scratch");
    expect(entities).not.toContain("old_members");

    expect(run.spec.summary.foreignKeys).toBe(1);
    expect(run.spec.stateMachines.length).toBe(1);
    expect(run.spec.stateMachines[0]?.transitions.length).toBe(2);

    const inv = run.spec.invariants.find((i) => i.id === "sql:layer-inversion");
    expect(inv?.violationCount).toBe(0);

    const multiDom = run.spec.invariants.find((i) => i.id === "sql:multi-domain-entity-ownership");
    expect(multiDom?.status).toBe("na");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("C# .slnx solution: pattern-guarded OrderState, Roslyn VSTACK diagnostics, verifies propagation, R8 formal", async () => {
    const dir = makeFixture({
      "Demo.slnx": `<Solution>\n  <Project Path="Demo.Domain/Demo.Domain.csproj" />\n  <Project Path="Demo.Tests/Demo.Tests.csproj" />\n</Solution>`,
      "Directory.Build.props": `<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup></Project>`,
      "Demo.Domain/Demo.Domain.csproj": `<Project Sdk="Microsoft.NET.Sdk"></Project>`,
      "Demo.Domain/OrderState.cs": `
        namespace Demo.Domain;
        public abstract record OrderState {
          public sealed record Pending(int Amount) : OrderState;
          public sealed record Authorized(int Amount, string Code) : OrderState;
          public sealed record Shipped(int Amount) : OrderState;
          public static TransitionOutcome Apply(OrderState s, OrderEvent e) => (s, e) switch {
            (OrderState.Pending p, OrderEvent.Authorize a) when !string.IsNullOrWhiteSpace(a.Code) =>
              new TransitionOutcome.Accepted(new OrderState.Authorized(p.Amount, a.Code)),
            (OrderState.Authorized a, OrderEvent.Ship _) =>
              new TransitionOutcome.Accepted(new OrderState.Shipped(a.Amount)),
            _ => new TransitionOutcome.Rejected("NO"),
          };
        }
      `,
      "Demo.Tests/Demo.Tests.csproj": `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><ProjectReference Include="../Demo.Domain/Demo.Domain.csproj" /></ItemGroup></Project>`,
      "Demo.Tests/OrderFormalProofTests.cs": `
        using Demo.Domain;
        public class OrderFormalProofTests { [Fact] public void Proves() { var x = typeof(OrderState); } }
      `,
      "formal/Order.dfy": `module Order { predicate Valid() { true } }`,
    });

    const run = await generateRepoSpec(dir, "artifact");
    expect(run.spec.repo.ecosystem).toBe("csharp");
    expect(run.spec.stateMachines.length).toBe(1);
    expect(run.spec.stateMachines[0]?.transitions.length).toBe(2);
    expect(run.spec.stateMachines[0]?.transitions[0]?.guard).toContain("IsNullOrWhiteSpace");
    expect(run.spec.diagrams.some((d) => d.category === "behavior")).toBe(true);
    expect(run.spec.edges.some((e) => e.kind === "verifies" && e.to === "arch:pkg:Demo.Domain")).toBe(true);
    expect(run.spec.summary.testFilesByRung.R8).toBe(2);
    expect(canonicalizeGitRemote("https://x-access-token:secret@github.com/org/repo.git")).toBe("https://github.com/org/repo");
    expect(canonicalizeGitRemote("git@github.com-work:org/repo.git")).toBe("https://github.com/org/repo");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("Python + JavaScript polyglot project: pyproject.toml, single-root peeling, FastAPI routes, capabilities, module levels", async () => {
    const dir = makeFixture({
      "pyproject.toml": `[project]\nname = "soundlab"\nversion = "0.2.0"\ndependencies = ["fastapi", "uvicorn"]\n`,
      "soundlab/__init__.py": `from .server import create_app\n`,
      "soundlab/server.py": `
import os
from fastapi import FastAPI
from .engine.synth import render_tone
from .storage.store import save_preset

app = FastAPI()

@app.get("/api/presets")
def list_presets():
    key = os.getenv("AUDIO_API_KEY")
    return save_preset(render_tone(440), key)
`,
      "soundlab/engine/__init__.py": `from .synth import render_tone\n`,
      "soundlab/engine/synth.py": `
from ..core.math_ops import normalize_wave

def render_tone(freq: float) -> list[float]:
    return normalize_wave([freq, freq * 2])
`,
      "soundlab/storage/store.py": `
import sqlite3
from ..core.math_ops import normalize_wave

def save_preset(samples, key):
    conn = sqlite3.connect(":memory:")
    return len(normalize_wave(samples)), bool(conn), bool(key)
`,
      "soundlab/core/math_ops.py": `
def normalize_wave(vals: list[float]) -> list[float]:
    return [v / 2.0 for v in vals]
`,
      "web/player.mjs": `
import { formatHz } from "./format.mjs";
export function playTone(hz) {
  return fetch("https://audio.example.net/v1/play?hz=" + formatHz(hz));
}
`,
      "web/format.mjs": `
export function formatHz(hz) {
  return String(Math.round(hz)) + "Hz";
}
`,
      "tests/test_synth.py": `
from soundlab.engine.synth import render_tone
def test_tone():
    assert render_tone(440)
`,
    });

    const run = await generateRepoSpec(dir, "artifact");
    expect(run.spec.diagnostics.filter((d) => d.severity === "error").length).toBe(0);
    expect(run.spec.repo.languages).toContain("python");
    expect(run.spec.repo.languages).toContain("javascript");
    expect(run.spec.summary.httpEndpoints).toBe(1);
    expect(run.spec.surfaces.envBindings.some((e) => e.name === "AUDIO_API_KEY")).toBe(true);

    const modNames = run.spec.modules.map((m) => m.name);
    expect(modNames).toContain("server");
    expect(modNames).toContain("engine");
    expect(modNames).toContain("storage");
    expect(modNames).toContain("core");

    const serverMod = run.spec.modules.find((m) => m.name === "server");
    const coreMod = run.spec.modules.find((m) => m.name === "core");
    const storageMod = run.spec.modules.find((m) => m.name === "storage");
    expect(serverMod).toBeTruthy();
    expect(coreMod).toBeTruthy();
    expect((serverMod?.level ?? 99) < (coreMod?.level ?? 0)).toBe(true);
    expect(serverMod?.capabilities).toContain("HTTP");
    expect(storageMod?.capabilities).toContain("DB");
    expect(coreMod?.capabilities).toEqual(["PURE"]);
    expect(serverMod?.topExports.some((s) => s.name === "list_presets")).toBe(true);

    const modDiag = run.spec.diagrams.find((d) => d.category === "modules");
    expect(modDiag).toBeTruthy();
    expect((modDiag?.edges.length ?? 0)).toBeGreaterThanOrEqual(3);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("Commit architecture diff computes added/removed nodes, verdict, and renders valid Diff Studio HTML", async () => {
    const baseDir = makeFixture({
      "package.json": JSON.stringify({ name: "diff-demo", private: true }),
      "src/index.ts": `import { run } from "./core.ts";\nexport function main() { return run(); }\n`,
      "src/core.ts": `export function run() { return 1; }\n`,
    });
    const headDir = makeFixture({
      "package.json": JSON.stringify({ name: "diff-demo", private: true }),
      "src/index.ts": `import { run } from "./core.ts";\nimport { report } from "./reporter.ts";\nexport function main() { return report(run()); }\n`,
      "src/core.ts": `export function run() { return 2; }\n`,
      "src/reporter.ts": `export function report(n: number) { return String(n); }\n`,
    });
    const baseRun = await generateRepoSpec(baseDir, "artifact");
    const headRun = await generateRepoSpec(headDir, "artifact");

    const commitDiff = buildCommitArchDiff({
      git: {
        range: "HEAD~1..HEAD",
        baseRef: "HEAD~1",
        headRef: "HEAD",
        baseSha: "1111111",
        headSha: "2222222",
        commitSubject: "feat: add reporter module",
        author: "tester",
        date: "2026-11-25",
        commitCount: 1,
        fileStats: [
          { path: "src/index.ts", status: "modified", insertions: 2, deletions: 1 },
          { path: "src/reporter.ts", status: "added", insertions: 1, deletions: 0 },
        ],
      },
      baseSpec: baseRun.spec,
      headSpec: headRun.spec,
    });

    expect(commitDiff.verdict).toBe("safe");
    expect(commitDiff.kpis.files.added).toBe(1);
    expect(commitDiff.diagrams.length).toBeGreaterThanOrEqual(1);
    const modBundle = commitDiff.diagrams.find((d) => d.id.includes("modules:"));
    expect(modBundle?.overlay.nodes.some((n) => n.diffStatus === "added" && n.label === "reporter")).toBe(true);

    const diffHtml = renderVisualHtml(headRun.spec, headRun.digest, {
      inline: true,
      drilldown: headRun.drilldown,
      commitDiff,
    });
    expect(diffHtml).toContain("Commit Architecture Diff");
    expect(diffHtml).toContain("renderInfoPopoverHtml");
    const scriptMatch = diffHtml.match(/<script>\n([\s\S]*?)<\/script>/);
    expect(() => new Function(scriptMatch?.[1] ?? "")).not.toThrow();

    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(headDir, { recursive: true, force: true });
  });
});
