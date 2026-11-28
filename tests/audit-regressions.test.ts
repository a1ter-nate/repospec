import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverRepo, scanRepo } from "@repospec/core";
import { discoverRealCoverageReport, isSecretEnvName } from "@repospec/plugin";

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

describe("OSS Audit P0/P1/P2 regression suite", () => {
  test("isSecretEnvName rejects non-secret port/service/url suffixes while keeping real secrets", () => {
    expect(isSecretEnvName("APP_SECRETS_PORT")).toBe(false);
    expect(isSecretEnvName("APP_SECRETS_SERVICE")).toBe(false);
    expect(isSecretEnvName("KEY_VAULT_URL")).toBe(false);
    expect(isSecretEnvName("TOKEN_EXPIRY_SECONDS")).toBe(false);
    expect(isSecretEnvName("STRIPE_API_KEY")).toBe(true);
    expect(isSecretEnvName("JWT_SECRET")).toBe(true);
    expect(isSecretEnvName("DATABASE_URL")).toBe(true);
    expect(isSecretEnvName("SQL_CONNECTION_STRING")).toBe(true);
  });

  test("discoverCoverageReport picks newest Cobertura file by mtime instead of alphabetical order", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-cov-mtime-"));
    try {
      const olderRel = "TestResults/cov0/coverage.cobertura.xml";
      const newerRel = "TestResults/coverage/coverage.cobertura.xml";
      writeFile(
        tmp,
        olderRel,
        `<?xml version="1.0"?><coverage line-rate="0.618" branch-rate="0.618" lines-covered="618" lines-valid="1000" branches-covered="618" branches-valid="1000"></coverage>`,
      );
      writeFile(
        tmp,
        newerRel,
        `<?xml version="1.0"?><coverage line-rate="0.9079" branch-rate="0.9079" lines-covered="908" lines-valid="1000" branches-covered="908" branches-valid="1000"></coverage>`,
      );
      const olderAbs = path.join(tmp, olderRel);
      const newerAbs = path.join(tmp, newerRel);
      const tOld = new Date("2025-01-01T00:00:00Z");
      const tNew = new Date("2026-11-27T12:00:00Z");
      fs.utimesSync(olderAbs, tOld, tOld);
      fs.utimesSync(newerAbs, tNew, tNew);

      const report = discoverRealCoverageReport(tmp);
      expect(report).not.toBeNull();
      expect(report?.reportFile).toBe(newerRel);
      expect(report?.branchPct).toBeCloseTo(90.8, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("handles rungs.json + Azure template gates, bracket/Bun.env reads, nested AGENTS.md, Bun.serve auth, and SQL language gating", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-audit-ts-"));
    const outDir = path.join(tmp, ".out");
    try {
      writeFile(
        tmp,
        "package.json",
        JSON.stringify(
          {
            name: "audit-ts-fixture",
            version: "1.0.0",
            scripts: {
              "verify:r0": "bun run lint",
              "verify:r2": "bun test ./tests/",
            },
          },
          null,
          2,
        ),
      );
      writeFile(
        tmp,
        ".verification/rungs.json",
        JSON.stringify(
          {
            schemaVersion: 1,
            rungs: {
              R0: { command: "bun run verify:r0", required: true },
              R4: { command: "bun test ./tests/api-smoke/", required: true },
            },
          },
          null,
          2,
        ),
      );
      writeFile(
        tmp,
        "ci/azure-pipelines.yml",
        `trigger:
  - main
stages:
  - stage: Verify
    jobs:
      - job: Gates
        steps:
          - template: templates/verify.yml
`,
      );
      writeFile(
        tmp,
        "ci/templates/verify.yml",
        `steps:
  - script: bun run verify:r0
  - script: bun run verify:r2
  - script: bun test ./tests/api-smoke/
`,
      );
      writeFile(tmp, "features/registry.sql", "CREATE TABLE features (id TEXT PRIMARY KEY);\n");
      writeFile(tmp, ".env.example", "BRACKET_VAR=\nBUN_VAR=\nDESTRUCTURED_VAR=\nAPP_SECRETS_PORT=8080\n");
      writeFile(
        tmp,
        "subpkg/AGENTS.md",
        "# Subpackage Guide\n\nSee `src/registry.ts` for definitions.\n",
      );
      writeFile(tmp, "subpkg/src/registry.ts", "export const REGISTRY_VERSION = 1;\n");
      writeFile(
        tmp,
        "src/server.ts",
        `import { timingSafeEqual } from "node:crypto";
export function startServer() {
  const a = process.env["BRACKET_VAR"];
  const b = Bun.env["BUN_VAR"];
  const { DESTRUCTURED_VAR } = process.env;
  const port = process.env["APP_SECRETS_PORT"];
  return Bun.serve({
    port: Number(port ?? 3000),
    fetch(req) {
      const auth = req.headers.get("authorization");
      if (!auth || !timingSafeEqual(Buffer.from(auth), Buffer.from(a ?? ""))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const url = new URL(req.url);
      if (url.pathname === "/api/orders" && req.method === "POST") {
        return Response.json({ ok: Boolean(b && DESTRUCTURED_VAR) });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
}
`,
      );
      writeFile(
        tmp,
        "src/client/app.tsx",
        `export async function handleSubmit(res: { json: (x: unknown) => void }) {
  await fetch("/api/orders");
  res.json({ ok: true });
}
`,
      );
      writeFile(
        tmp,
        "src/controller/orderHandler.ts",
        `export async function createOrder(request: Request, res: { status: (c: number) => { json: (x: unknown) => void } }) {
  const body = await readJson(request);
  if (!body) {
    return res.status(400).json({ error: "bad" });
  }
  const order = await orderRepo.findOrder(body.id);
  res.status(200).json(order);
}
`,
      );
      writeFile(
        tmp,
        "tests/api-smoke/smoke.test.ts",
        `import { expect, test } from "bun:test";
test("smoke", () => { expect(1).toBe(1); });
`,
      );
      writeFile(
        tmp,
        ".github/CODEOWNERS",
        `/src/ @team-a\n/src/ @team-b\n/does-not-exist/ @ghost\n`,
      );

      const ctx = discoverRepo(tmp, "artifact");
      expect(ctx.languages.includes("sql")).toBe(false);

      const res = await scanRepo(tmp, { dbPath: path.join(outDir, "spec.sqlite") });
      expect(res.spec.verification.registeredGates).toBeGreaterThanOrEqual(2);
      expect(res.spec.verification.unwiredGateNames).toEqual([]);

      const envInv = res.spec.invariants.find((i) => i.id === "sql:env-contract-drift");
      expect(envInv?.status).toBe("pass");

      const docInv = res.spec.invariants.find((i) => i.id === "sql:doc-path-drift");
      expect(docInv?.status).toBe("pass");

      const blockingInv = res.spec.invariants.find((i) => i.id === "ddia:blocking-noncritical-io");
      expect(blockingInv?.evidence?.some((e) => e.file === "src/client/app.tsx") ?? false).toBe(false);

      const serialInv = res.spec.invariants.find((i) => i.id === "ddia:serial-independent-awaits");
      expect(serialInv?.evidence?.some((e) => e.file === "src/controller/orderHandler.ts") ?? false).toBe(false);

      const smokeSuite = res.spec.nodes.find((n) => n.kind === "test_suite" && String(n.meta.sampleFiles).includes("smoke.test.ts"));
      expect(smokeSuite?.meta.rung).toBe("R4");

      const db = new Database(res.dbPath, { readonly: true });
      try {
        const epRow = db
          .query("SELECT auth_guard FROM http_endpoints WHERE path = '/api/orders'")
          .get() as { auth_guard: string | null } | null;
        expect(epRow?.auth_guard).toBe("authorization");

        const ownerRows = db
          .query("SELECT scope_prefix, symbol, rationale FROM gov_rules WHERE kind = 'owner'")
          .all() as Array<{ scope_prefix: string; symbol: string; rationale: string | null }>;
        expect(ownerRows.some((r) => r.scope_prefix.includes("does-not-exist"))).toBe(false);
        const srcOwner = ownerRows.find((r) => r.scope_prefix === "src/");
        expect(srcOwner?.symbol).toBe("@team-b");
        expect(srcOwner?.rationale).toContain("Azure DevOps");
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("resolves Rust outbox/shared-tx/poll-setter/doc-comments/ops-scripts and C# same-namespace fan-in + ProjectReference verifies", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-audit-poly-"));
    const outDir = path.join(tmp, ".out");
    try {
      writeFile(tmp, "Cargo.toml", `[workspace]\nmembers = ["crates/core"]\n`);
      writeFile(tmp, "crates/core/Cargo.toml", `[package]\nname = "core"\nversion = "0.1.0"\n`);
      writeFile(tmp, "crates/core/migrations/001_init.sql", `CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT);\n`);
      writeFile(
        tmp,
        "crates/core/src/store/sqlite.rs",
        `pub async fn save_status(tx: &mut Tx) { let _ = sqlx::query("UPDATE orders SET status = 'done'").execute(&mut *tx).await; }\n`,
      );
      writeFile(
        tmp,
        "crates/core/src/store/postgres.rs",
        `pub async fn save_status(tx: &mut Tx) { let _ = sqlx::query("UPDATE orders SET status = 'done'").execute(&mut *tx).await; }\n`,
      );
      writeFile(
        tmp,
        "crates/core/src/handler.rs",
        `//! Mentions orders in doc comment only
pub async fn set_packet_poll(tx: &mut Tx) {
  let _ = get_one(&mut *tx).await;
  let _ = get_two(&mut *tx).await;
  let _ = tx.enqueue_slack("msg").await;
  let _ = tx.commit().await;
}
`,
      );
      writeFile(tmp, "hosted/tools/rehearsal/seed.mjs", `export const seed = 1;\n`);

      writeFile(
        tmp,
        "src/Domain/Domain.csproj",
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>\n`,
      );
      writeFile(tmp, "src/Domain/Order.cs", `namespace MyApp.Domain;\npublic record Order(string Id);\n`);
      writeFile(tmp, "src/Domain/OrderService.cs", `namespace MyApp.Domain;\npublic class OrderService { public Order Create() => new("1"); }\n`);
      writeFile(
        tmp,
        "src/Domain.Tests/Domain.Tests.csproj",
        `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><ProjectReference Include="../Domain/Domain.csproj" /></ItemGroup></Project>\n`,
      );
      writeFile(
        tmp,
        "src/Domain.Tests/OrderTests.cs",
        `using MyApp.Domain;\nnamespace MyApp.Domain.Tests;\npublic class OrderTests { [Fact] public void Works() { var o = new Order("1"); } }\n`,
      );

      const res = await scanRepo(tmp, { dbPath: path.join(outDir, "spec.sqlite") });

      const notifyInv = res.spec.invariants.find((i) => i.id === "ddia:notify-before-commit");
      expect(notifyInv?.evidence?.length ?? 0).toBe(0);

      const pollInv = res.spec.invariants.find((i) => i.id === "ddia:write-on-poll");
      expect(pollInv?.evidence?.length ?? 0).toBe(0);

      const serialInv = res.spec.invariants.find((i) => i.id === "ddia:serial-independent-awaits");
      expect(serialInv?.evidence?.some((e) => e.file === "crates/core/src/handler.rs") ?? false).toBe(false);

      const multiWriterInv = res.spec.invariants.find((i) => i.id === "ddia:multi-writer-unowned-field");
      expect(multiWriterInv?.evidence?.some((e) => e.subject.includes("orders.status")) ?? false).toBe(false);

      const csDomainNode = res.spec.nodes.find((n) => n.label === "Domain");
      expect(csDomainNode).toBeDefined();
      const verifiesDomain = res.spec.edges.some((e) => e.kind === "verifies" && e.to === csDomainNode?.id);
      expect(verifiesDomain).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
