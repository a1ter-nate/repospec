import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRepoSpec } from "../src/cli.ts";
import { classifyTerraformPlane, isDeployableComputeResource } from "../src/extractors/iac.ts";
import { renderVisualHtml } from "../src/render.ts";
import type { IacPlane } from "../src/schema.ts";

function makeTmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-sig-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

describe("RepoSpec v5.0.7 signal-quality & false-positive regressions", () => {
  test("Terraform plane taxonomy maps non-compute Azure resources accurately and restricts iac-unlinked-compute", async () => {
    const nonComputeCases: Array<[string, IacPlane]> = [
      ["azuread_application", "security"],
      ["azuread_service_principal", "security"],
      ["azuread_app_role_assignment", "security"],
      ["azurerm_role_assignment", "security"],
      ["azurerm_key_vault", "security"],
      ["azurerm_application_insights", "observability"],
      ["azurerm_application_insights_workbook", "observability"],
      ["azurerm_log_analytics_workspace", "observability"],
      ["azurerm_monitor_action_group", "observability"],
      ["azurerm_resource_group", "governance"],
      ["azurerm_consumption_budget_resource_group", "governance"],
      ["azurerm_eventhub", "messaging"],
      ["azurerm_eventhub_namespace", "messaging"],
      ["azurerm_iothub", "messaging"],
      ["azurerm_container_app_environment", "network"],
      ["azurerm_container_app_environment_storage", "data"],
      ["azurerm_container_app_custom_domain", "network"],
    ];

    for (const [resType, expectedPlane] of nonComputeCases) {
      expect(classifyTerraformPlane(resType, "main")).toBe(expectedPlane);
      expect(classifyTerraformPlane(resType, "main")).not.toBe("compute");
      expect(isDeployableComputeResource(resType)).toBe(false);
    }

    for (const computeType of [
      "azurerm_container_app",
      "azurerm_container_app_job",
      "azurerm_linux_web_app",
      "azurerm_linux_function_app",
      "aws_ecs_service",
      "aws_lambda_function",
      "google_cloud_run_v2_service",
    ]) {
      expect(classifyTerraformPlane(computeType, "main")).toBe("compute");
      expect(isDeployableComputeResource(computeType)).toBe(true);
    }

    const dir = makeTmpRepo({
      "package.json": JSON.stringify({ name: "@demo/iac-planes" }),
      "src/index.ts": "export const ready = true;\n",
      "infra/main.tf": [
        'resource "azurerm_resource_group" "rg" { name = "rg-prod" }',
        'resource "azuread_application" "app" { name = "aad-app" }',
        'resource "azurerm_key_vault" "kv" { name = "kv-prod" }',
        'resource "azurerm_application_insights" "ai" { name = "ai-prod" }',
        'resource "azurerm_consumption_budget_resource_group" "budget" { name = "monthly" }',
        'resource "azurerm_eventhub_namespace" "ehns" { name = "ehns-prod" }',
        'resource "azurerm_container_app_environment" "env" { name = "cae-prod" }',
        'resource "azurerm_container_app_environment_storage" "st" { name = "cae-st" }',
        'resource "azurerm_container_app_custom_domain" "dom" { name = "app.example.com" }',
        'resource "azurerm_container_app" "worker" { name = "worker-app" }',
      ].join("\n"),
    });
    try {
      const { spec } = await generateRepoSpec(dir, "artifact", path.join(dir, "out.sqlite"));
      expect(spec.summary.iacByPlane.compute).toBe(1);
      expect(spec.summary.iacByPlane.security).toBe(2);
      expect(spec.summary.iacByPlane.observability).toBe(1);
      expect(spec.summary.iacByPlane.governance).toBe(2);
      expect(spec.summary.iacByPlane.messaging).toBe(1);
      expect(spec.summary.iacByPlane.network).toBe(2);
      expect(spec.summary.iacByPlane.data).toBe(1);

      const unlinked = spec.invariants.find((i) => i.id === "sql:iac-unlinked-compute");
      expect(unlinked?.status).toBe("warn");
      expect(unlinked?.violationCount).toBe(1);
      expect(unlinked?.evidence[0]?.subject).toBe("iac:tf:azurerm_container_app.worker");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Azure DevOps Pipelines and env0.workflow.yaml index workflows/jobs and link azurerm_container_app compute", async () => {
    const dir = makeTmpRepo({
      "package.json": JSON.stringify({ name: "@demo/azure-env0" }),
      "src/index.ts": "export const ok = true;\n",
      "infra/main.tf": [
        'resource "azurerm_container_app" "api" { name = "demo-api" }',
        'resource "azurerm_container_app_job" "nightly" { name = "demo-nightly" }',
      ].join("\n"),
      "ci/azure-pipelines.yml": [
        "trigger:",
        "  branches:",
        "    include: [main]",
        "pool:",
        "  vmImage: ubuntu-latest",
        "stages:",
        "  - stage: Build",
        "    jobs:",
        "      - job: Test",
        "        steps:",
        "          - bash: bun test",
        "  - stage: Deploy",
        "    dependsOn: Build",
        "    jobs:",
        "      - deployment: DeployApi",
        "        environment: prod",
        "        strategy:",
        "          runOnce:",
        "            deploy:",
        "              steps:",
        "                - bash: az containerapp update --name demo-api",
      ].join("\n"),
      "env0.workflow.yaml": [
        "environments:",
        "  prod_infra:",
        "    name: prod-infra",
        "    directory: infra",
      ].join("\n"),
    });
    try {
      const { spec } = await generateRepoSpec(dir, "artifact", path.join(dir, "out.sqlite"));
      expect(spec.summary.workflowCount).toBe(2);
      expect(spec.summary.ciJobCount).toBe(3);

      const deploysEdges = spec.edges.filter((e) => e.kind === "deploys" && e.to.startsWith("iac:tf:azurerm_container_app"));
      expect(deploysEdges.length).toBeGreaterThanOrEqual(2);

      const unlinked = spec.invariants.find((i) => i.id === "sql:iac-unlinked-compute");
      expect(unlinked?.status).toBe("pass");
      expect(unlinked?.violationCount).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("src/cli.ts importing src/cli/helpers.ts does not trigger runtime-imports-ops-script, while scripts/ import does", async () => {
    const cleanDir = makeTmpRepo({
      "package.json": JSON.stringify({ name: "@demo/cli-clean", bin: { demo: "src/cli.ts" } }),
      "src/cli.ts": 'import { formatFlag } from "./cli/helpers.ts";\nexport function run() { return formatFlag("v"); }\n',
      "src/cli/helpers.ts": "export function formatFlag(x: string): string { return `--${x}`; }\n",
    });
    const dirtyDir = makeTmpRepo({
      "package.json": JSON.stringify({ name: "@demo/cli-dirty" }),
      "src/server.ts": 'import { runBackfill } from "../scripts/backfill.ts";\nexport function start() { return runBackfill(); }\n',
      "scripts/backfill.ts": "export function runBackfill(): number { return 1; }\n",
    });
    try {
      const cleanRes = await generateRepoSpec(cleanDir, "artifact", path.join(cleanDir, "out.sqlite"));
      const cleanInv = cleanRes.spec.invariants.find((i) => i.id === "sql:runtime-imports-ops-script");
      expect(cleanInv?.status).not.toBe("fail");
      expect(cleanInv?.violationCount).toBe(0);

      const dirtyRes = await generateRepoSpec(dirtyDir, "artifact", path.join(dirtyDir, "out.sqlite"));
      const dirtyInv = dirtyRes.spec.invariants.find((i) => i.id === "sql:runtime-imports-ops-script");
      expect(dirtyInv?.status).toBe("fail");
      expect(dirtyInv?.violationCount).toBe(1);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
      fs.rmSync(dirtyDir, { recursive: true, force: true });
    }
  });

  test("intra-package module cycles are flagged identically by sql:intra-package-module-tangle and Studio module cards", async () => {
    const dir = makeTmpRepo({
      "package.json": JSON.stringify({ name: "@demo/tangle-sync" }),
      "src/alpha/a.ts": 'import { bVal } from "../beta/b.ts";\nexport function aVal() { return bVal() + 1; }\n',
      "src/beta/b.ts": 'import { aVal } from "../alpha/a.ts";\nexport function bVal() { return aVal() - 1; }\n',
      "src/entry.ts": 'import { aVal } from "./alpha/a.ts";\nexport const start = () => aVal();\n',
    });
    try {
      const { spec } = await generateRepoSpec(dir, "artifact", path.join(dir, "out.sqlite"));
      const tangledMods = spec.modules.filter((m) => m.inTangle);
      expect(tangledMods.length).toBeGreaterThanOrEqual(2);

      const tangleInv = spec.invariants.find((i) => i.id === "sql:intra-package-module-tangle");
      expect(tangleInv?.status).toBe("warn");
      expect(tangleInv?.violationCount).toBe(1);
      expect(tangleInv?.evidence[0]?.detail).toContain("tangle-1");

      const layerInv = spec.invariants.find((i) => i.id === "sql:layer-inversion");
      expect(layerInv?.status).toBe("na");
      expect(layerInv?.applicabilityReason).toContain("inferred topological tiers");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("import type and type-only files are excluded from high-fanin warnings, and real coverage vs static reachability is surfaced honestly", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "@demo/type-fanin" }),
      "src/model.ts": "export interface Order { id: string }\nexport type OrderStatus = 'open' | 'closed';\n",
      "src/runtimeHub.ts": "export function computeTax(n: number): number { return n * 0.1; }\n",
    };
    for (let i = 1; i <= 9; i += 1) {
      files[`src/consumer${i}.ts`] = [
        'import type { Order } from "./model.ts";',
        'import { type OrderStatus } from "./model.ts";',
        'import { computeTax } from "./runtimeHub.ts";',
        `export function fn${i}(o: Order, s: OrderStatus): number { return s === "open" ? computeTax(o.id.length) : 0; }`,
      ].join("\n");
    }
    const dir = makeTmpRepo(files);
    try {
      const staticRes = await generateRepoSpec(dir, "artifact", path.join(dir, "static.sqlite"));
      const faninInv = staticRes.spec.invariants.find((i) => i.id === "sql:untested-high-fanin-modules");
      expect(faninInv?.evidence.some((e) => e.file === "src/model.ts")).toBe(false);
      expect(faninInv?.evidence.some((e) => e.file === "src/runtimeHub.ts")).toBe(true);
      expect(staticRes.spec.verification.coverageSource).toBe("static_reachability_1hop");
      expect(staticRes.spec.verification.realLineCoveragePct).toBeNull();

      const staticHtml = renderVisualHtml(staticRes.spec, staticRes.digest, { inline: false, drilldown: staticRes.drilldown });
      expect(staticHtml).toContain("static 1-hop reach");
      expect(staticHtml).toContain("Static Test Reachability (1-hop)");
      expect(staticHtml).toContain("Verification Scope");

      fs.mkdirSync(path.join(dir, "coverage"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "coverage/lcov.info"),
        [
          "TN:",
          "SF:src/runtimeHub.ts",
          "LF:10",
          "LH:9",
          "BRF:4",
          "BRH:3",
          "end_of_record",
        ].join("\n"),
        "utf8",
      );
      const lcovRes = await generateRepoSpec(dir, "artifact", path.join(dir, "lcov.sqlite"));
      expect(lcovRes.spec.verification.coverageSource).toBe("lcov");
      expect(lcovRes.spec.verification.realLineCoveragePct).toBe(90);
      expect(lcovRes.spec.verification.realBranchCoveragePct).toBe(75);
      const lcovFanin = lcovRes.spec.invariants.find((i) => i.id === "sql:untested-high-fanin-modules");
      expect(lcovFanin?.evidence.some((e) => e.file === "src/runtimeHub.ts")).toBe(false);

      fs.rmSync(path.join(dir, "coverage"), { recursive: true, force: true });
      fs.mkdirSync(path.join(dir, "TestResults/run1"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "TestResults/run1/coverage.cobertura.xml"),
        '<coverage line-rate="0.825" branch-rate="0.64"><packages><package name="app"><classes><class filename="src/runtimeHub.ts" line-rate="0.85"/></classes></package></packages></coverage>',
        "utf8",
      );
      const cobRes = await generateRepoSpec(dir, "artifact", path.join(dir, "cob.sqlite"));
      expect(cobRes.spec.verification.coverageSource).toBe("cobertura");
      expect(cobRes.spec.verification.realLineCoveragePct).toBe(82.5);
      expect(cobRes.spec.verification.realBranchCoveragePct).toBe(64);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Bun.serve fetch handlers and pathname branches are extracted into httpEndpoints", async () => {
    const dir = makeTmpRepo({
      "package.json": JSON.stringify({ name: "@demo/bun-http" }),
      "src/server.ts": [
        "function handleRequest(request: Request): Response {",
        "  const url = new URL(request.url);",
        '  if (request.method === "GET" && url.pathname === "/health") return new Response("ok");',
        '  if (request.method === "POST" && url.pathname === "/api/orders") return new Response("created");',
        '  if (url.pathname.startsWith("/api/v1/assets/")) return new Response("asset");',
        "  const userMatch = url.pathname.match(/^\\/api\\/users\\/([^/]+)$/);",
        "  if (userMatch) return new Response(userMatch[1]);",
        "  switch (url.pathname) {",
        '    case "/metrics":',
        '      return new Response("m");',
        "  }",
        '  return new Response("not found", { status: 404 });',
        "}",
        "export function boot() {",
        "  return Bun.serve({ port: 0, fetch: handleRequest });",
        "}",
      ].join("\n"),
    });
    try {
      const { spec } = await generateRepoSpec(dir, "artifact", path.join(dir, "out.sqlite"));
      const routes = spec.surfaces.endpoints.map((e) => `${e.method} ${e.path}`);
      expect(spec.summary.httpEndpoints).toBeGreaterThanOrEqual(5);
      expect(routes).toContain("GET /health");
      expect(routes).toContain("POST /api/orders");
      expect(routes).toContain("ANY /api/v1/assets/*");
      expect(routes).toContain("ANY /api/users/:param");
      expect(routes).toContain("ANY /metrics");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
