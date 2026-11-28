import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepo } from "@repospec/core";
import { analyzeRepoFlows } from "@repospec/flows";
import { buildContractionReport, buildFilePassport, buildImpactReport, type FilePassport } from "@repospec/plugin-passport";
import type { CommitArchDiff } from "@repospec/plugin-studio";
import { triageCommitDiff } from "../packages/show-me/src/internal/triage.ts";

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
}

function makeMinimalCommitDiff(paths: string[]): CommitArchDiff {
  return {
    range: "HEAD~1..HEAD",
    baseRef: "HEAD~1",
    headRef: "HEAD",
    baseSha: "aaaaaaa",
    headSha: "bbbbbbb",
    commitSubject: "test commit",
    author: "Alice",
    date: "2026-11-27",
    commitCount: 1,
    verdict: "safe",
    verdictSummary: "ok",
    changedFiles: paths.map((p) => ({
      path: p,
      status: "modified",
      insertions: 25,
      deletions: 5,
      unitSlug: "demo",
      moduleId: null,
      blastRadius: 0,
    })),
    kpis: {
      failures: { before: 0, after: 0, delta: 0 },
      warnings: { before: 0, after: 0, delta: 0 },
      coveragePct: { before: 0, after: 0, delta: 0 },
      files: { added: 0, modified: paths.length, deleted: 0, insertions: paths.length * 25, deletions: paths.length * 5 },
      nodes: { added: 0, modified: 0, removed: 0 },
      edges: { added: 0, removed: 0 },
    },
    findings: { introduced: [], resolved: [], persistentCount: 0 },
    edgeChanges: { added: [], removed: [] },
    surfaces: {
      endpointsAdded: [],
      endpointsRemoved: [],
      entitiesAdded: [],
      entitiesRemoved: [],
      envAdded: [],
      envRemoved: [],
      externalAdded: [],
      externalRemoved: [],
    },
    diagrams: [],
  };
}

describe("CS Research & Uncomplect Full Workset (#1–#17)", () => {
  let gitTmp = "";
  let gitDbPath = "";

  beforeAll(() => {
    gitTmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-git-research-"));
    gitDbPath = path.join(gitTmp, ".out/spec.sqlite");
    git(gitTmp, ["init"]);
    git(gitTmp, ["config", "user.name", "Alice"]);
    git(gitTmp, ["config", "user.email", "alice@example.com"]);
    writeFile(gitTmp, "package.json", JSON.stringify({ name: "git-research", version: "1.0.0", type: "module" }));
    writeFile(
      gitTmp,
      "src/lib.ts",
      "export function alpha(x: number) {\n  return x + 1;\n}\n\nexport function beta(x: number) {\n  return x + 2;\n}\n",
    );
    writeFile(gitTmp, "src/useAlpha.ts", `import { alpha } from "./lib.ts";\nexport const a = alpha(1);\n`);
    writeFile(gitTmp, "src/useBeta.ts", `import { beta } from "./lib.ts";\nexport const b = beta(2);\n`);
    writeFile(gitTmp, "src/hiddenA.ts", "export const vA = 1;\n");
    writeFile(gitTmp, "src/hiddenB.ts", "export const vB = 1;\n");
    git(gitTmp, ["add", "."]);
    git(gitTmp, ["commit", "-m", "initial commit"]);

    for (let i = 2; i <= 5; i += 1) {
      writeFile(gitTmp, "src/hiddenA.ts", `export const vA = ${i};\n`);
      writeFile(gitTmp, "src/hiddenB.ts", `export const vB = ${i};\n`);
      git(gitTmp, ["add", "src/hiddenA.ts", "src/hiddenB.ts"]);
      git(gitTmp, ["commit", "-m", `fix: sync hidden pair ${i}`]);
    }

    writeFile(
      gitTmp,
      "src/lib.ts",
      "export function alpha(x: number) {\n  return x + 100;\n}\n\nexport function beta(x: number) {\n  return x + 2;\n}\n",
    );
    git(gitTmp, ["add", "src/lib.ts"]);
    git(gitTmp, ["commit", "-m", "fix: update alpha only"]);
  });

  afterAll(() => {
    if (gitTmp) fs.rmSync(gitTmp, { recursive: true, force: true });
  });

  test("computes structural economics (PC%, Core/Periphery, DL%, CCD/NCCD, Martin I/A/D, pure-core), Parnas secrets, contraction, DECKARD, uncomplect fences, IaC inputs, LDFI cut-sets, and soundiness", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-research-"));
    const dbPath = path.join(tmp, ".out/spec.sqlite");
    try {
      writeFile(tmp, "package.json", JSON.stringify({ name: "research-demo", version: "1.0.0", type: "module" }, null, 2));
      writeFile(tmp, ".env.example", "KNOWN_KEY=1\n");
      writeFile(
        tmp,
        ".repospec/retiring.json",
        JSON.stringify({ retiring: [{ path: "src/legacyAuth.ts", replacement: "src/core/auth.ts" }] }),
      );
      writeFile(tmp, "src/legacyAuth.ts", "export function oldAuth() { return true; }\n");
      writeFile(tmp, "src/core/types.ts", "export interface Order { id: string; sku: string; qty: number; total: number; status: string; }\n");
      writeFile(
        tmp,
        "src/api/dto.ts",
        "export interface OrderDto { id: string; sku: string; qty: number; total: number; status: string; }\nexport function toOrderDto(src: OrderDto) { return { id: src.id, sku: src.sku, qty: src.qty, total: src.total, status: src.status }; }\n",
      );
      writeFile(
        tmp,
        "src/core/utils.ts",
        "export function fnA() { return 1; }\nexport function fnB() { return 2; }\nexport function fnC() { return 3; }\nexport function fnD() { return 4; }\n",
      );
      writeFile(tmp, "src/consumers/c1.ts", `import { fnA } from "../core/utils.ts";\nexport const r1 = fnA();\n`);
      writeFile(tmp, "src/consumers/c2.ts", `import { fnB } from "../core/utils.ts";\nexport const r2 = fnB();\n`);
      writeFile(tmp, "src/consumers/c3.ts", `import { fnC } from "../core/utils.ts";\nexport const r3 = fnC();\n`);
      writeFile(tmp, "src/consumers/c4.ts", `import { fnD } from "../core/utils.ts";\nexport const r4 = fnD();\n`);

      writeFile(
        tmp,
        "src/domain/orderService.ts",
        `import axios from "axios";
import got from "got";
import { oldAuth } from "../legacyAuth.ts";
export function exposePool(pool: PgPool): PrismaClient {
  const dyn = import(String(pool));
  void axios; void got; void oldAuth; void dyn;
  return pool as unknown as PrismaClient;
}
export class OrderWrapperService {
  constructor(private inner: { a: () => number; b: () => number }) {}
  getA() { return this.inner.a(); }
  getB() { return this.inner.b(); }
}
`,
      );
      writeFile(
        tmp,
        "src/domain/to-order-view.ts",
        `export async function toOrderView(db: { update: (q: string) => Promise<void> }) {
  await db.update("orders");
  return { ok: true };
}
`,
      );
      writeFile(
        tmp,
        "src/domain/hierarchy.ts",
        `export class BaseA {}
export class MidB extends BaseA {}
export class SubC extends MidB {}
export class LeafD extends SubC {}
`,
      );
      writeFile(
        tmp,
        "src/controller/checkout.ts",
        `export async function checkout(db: { runTransaction: (fn: () => Promise<void>) => Promise<void>; findMany: () => Promise<unknown[]> }) {
  await db.runTransaction(async () => {
    await fetch("https://api.stripe.com/v1/charges");
  });
  await withRetry(() => createCharge());
  return await db.findMany();
}
`,
      );
      writeFile(tmp, "src/cartridge/standalone.ts", "export function pureCalc(x: number) { return x * 2; }\n");
      writeFile(
        tmp,
        "infra/main.tf",
        `resource "aws_lambda_function" "worker" {
  count = var.enable_hidden_worker != "" ? 1 : 0
  function_name = "worker"
}
`,
      );

      const res = await scanRepo(tmp, { dbPath });
      const metricsByName = new Map(
        res.spec.extensions.metrics.filter((m) => m.scopeKind === "repo").map((m) => [m.name, m.valueNum]),
      );
      expect(metricsByName.get("dsm_propagation_cost_pct")).toBeGreaterThan(0);
      expect(metricsByName.get("drh_decoupling_level_pct")).toBeGreaterThanOrEqual(0);
      expect(metricsByName.get("lakos_ccd")).toBeGreaterThan(0);
      expect(metricsByName.get("lakos_nccd")).toBeGreaterThan(0);
      expect(metricsByName.get("pure_core_ratio_pct")).toBeGreaterThanOrEqual(0);

      expect(res.spec.soundiness?.totalApproximations).toBeGreaterThanOrEqual(1);
      expect(res.spec.soundiness?.byCategory.dynamic_import).toBeGreaterThanOrEqual(1);

      const invCount = (id: string): number => res.spec.invariants.find((i) => i.id === id)?.violationCount ?? 0;
      expect(invCount("sql:parnas-secret-leak")).toBeGreaterThanOrEqual(1);
      expect(invCount("sql:disjoint-caller-cohesion")).toBeGreaterThanOrEqual(1);
      expect(invCount("sql:near-duplicate-types")).toBeGreaterThanOrEqual(1);
      expect(invCount("sql:passthrough-wrapper")).toBeGreaterThanOrEqual(1);
      expect(invCount("sql:projection-authority-leak")).toBeGreaterThanOrEqual(1);
      expect(invCount("sql:paved-path-and-retiring")).toBeGreaterThanOrEqual(2);
      expect(invCount("sql:unhealthy-hierarchy")).toBeGreaterThanOrEqual(1);
      expect(invCount("sql:iac-undeclared-deploy-input")).toBeGreaterThanOrEqual(1);
      expect(invCount("ddia:io-inside-transaction")).toBeGreaterThanOrEqual(1);
      expect(invCount("ddia:cloud-resilience-hazards")).toBeGreaterThanOrEqual(2);

      const db = new Database(res.dbPath, { readonly: true });
      try {
        const leakPassport = buildFilePassport(db, "src/domain/orderService.ts");
        expect("found" in leakPassport).toBe(false);
        const fp = leakPassport as FilePassport;
        expect(fp.secrets.exportedLeaks.length).toBeGreaterThanOrEqual(1);
        expect(fp.contraction.verdict).toBe("cartridge");
        const utilsContraction = buildContractionReport(db, "src/core/utils.ts");
        expect(utilsContraction.externalImportersBroken.length).toBe(4);
        expect(utilsContraction.deletabilityScore).toBeLessThan(80);
      } finally {
        db.close();
      }

      const flowBundle = analyzeRepoFlows(tmp);
      expect(flowBundle.ldfiCutSets).toBeDefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("mines git co_changes, invisible coupling, relative churn, symbol-level impact slicing, and Kamei entropy", async () => {
    const res = await scanRepo(gitTmp, { dbPath: gitDbPath });
    const invCoupling = res.spec.invariants.find((i) => i.id === "sql:invisible-coupling");
    expect(invCoupling?.violationCount).toBeGreaterThanOrEqual(1);

    const db = new Database(res.dbPath, { readonly: true });
    try {
      const impact = buildImpactReport(db, gitTmp, "HEAD~1..HEAD");
      expect(impact.symbolSlice.changedSymbols.some((s) => s.symbol === "alpha")).toBe(true);
      expect(impact.symbolSlice.impactedConsumers).toContain("src/useAlpha.ts");
      expect(impact.symbolSlice.impactedConsumers).not.toContain("src/useBeta.ts");
      expect(impact.symbolSlice.precisionGainPct).toBe(50);
      expect(impact.changeRisk.priorBugFixTouches).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }

    const triage = triageCommitDiff({
      commitDiff: makeMinimalCommitDiff(["a/1/x.ts", "b/2/y.ts", "c/3/z.ts", "d/4/w.ts"]),
      rankedDiagrams: [],
      rankedFiles: [],
    });
    expect(triage.kameiEntropy).toBe(1);
    expect(triage.subsystemSpread).toBe(4);
    expect(triage.attentionItems.some((a) => a.kind === "spread")).toBe(true);
  });
});
