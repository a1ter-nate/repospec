import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { repospecCommand } from "../src/effect/cliApp.ts";
import { checkRepoSpecEffect, generateRepoSpecEffect } from "../src/effect/pipeline.ts";
import { CoverageService, ExtractorRegistry, RepospecLive } from "../src/effect/services.ts";
import { buildRepoSpecJsonSchema } from "../src/schema.ts";

function makeTempFixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-eff-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

describe("Effect 4 runtime, Layer DI, CLI, and hardened signal edge cases", () => {
  test("Effect Layer DI overrides CoverageService and isolates failing extractors into structured diagnostics", async () => {
    const dir = makeTempFixture({
      "package.json": JSON.stringify({ name: "@demo/effect-di" }),
      "src/index.ts": 'import { helper } from "./util.ts";\nexport function main() { return helper(); }\n',
      "src/util.ts": "export function helper() { return 42; }\n",
    });

    const mockCoverageLayer = Layer.succeed(CoverageService, {
      discover: () =>
        Effect.succeed({
          source: "lcov",
          reportFile: "coverage/lcov.info",
          linePct: 88.5,
          branchPct: 71.2,
          fileLinePct: new Map([["src/index.ts", 90]]),
        }),
    });

    const failingExtractorLayer = Layer.succeed(ExtractorRegistry, {
      plugins: [
        {
          id: "test.failing.v1",
          domain: "arch",
          extract: () => Promise.reject(new Error("simulated extractor fault")),
        },
      ],
      runAll: () =>
        Effect.succeed([
          {
            nodes: [],
            edges: [],
            rules: [],
            diagnostics: [
              {
                code: "extractor.failed.test.failing.v1",
                severity: "warn",
                message: "Extractor test.failing.v1 failed: simulated extractor fault",
              },
            ],
          },
        ]),
    });

    const testLayer = Layer.mergeAll(RepospecLive, mockCoverageLayer, failingExtractorLayer);

    try {
      const res = await Effect.runPromise(
        generateRepoSpecEffect(dir, "artifact", path.join(dir, "out.sqlite")).pipe(Effect.provide(testLayer)),
      );
      expect(res.spec.verification.coverageSource).toBe("lcov");
      expect(res.spec.verification.realLineCoveragePct).toBe(88.5);
      expect(res.spec.verification.realBranchCoveragePct).toBe(71.2);
      expect(res.spec.diagnostics.some((d) => d.code === "extractor.failed.test.failing.v1")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Effect CLI Command.runWith executes check and schema subcommands cleanly via BunServices", async () => {
    const dir = makeTempFixture({
      "package.json": JSON.stringify({ name: "@demo/effect-cli" }),
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a + 1;\n',
    });

    const cliLayer = Layer.mergeAll(BunServices.layer, RepospecLive);
    try {
      const checkRes = await Effect.runPromise(
        checkRepoSpecEffect({ repoDir: dir, allowFail: false }).pipe(Effect.provide(RepospecLive)),
      );
      expect(checkRes.ok).toBe(true);
      expect(checkRes.scopeSummary.coverage.source).toBe("static_reachability_1hop");
      expect(checkRes.scopeSummary.invariants.total).toBeGreaterThanOrEqual(14);

      await Effect.runPromise(
        Command.runWith(repospecCommand, { version: "5.0.7" })(["check", dir]).pipe(Effect.provide(cliLayer)),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildRepoSpecJsonSchema derives Draft 2020-12 schema directly from Effect Schema", () => {
    const jsonSchema = buildRepoSpecJsonSchema();
    expect(jsonSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(jsonSchema.title).toBe("RepoSpec Canonical IR v5.0.0");
    expect(jsonSchema.type).toBe("object");
    expect(typeof jsonSchema.properties).toBe("object");
  });

  test("handles declarative Bun.serve routes, nested Azure pipelines, suffix Cobertura paths, and diagram tierKind", async () => {
    const dir = makeTempFixture({
      "package.json": JSON.stringify({ name: "@demo/edge-hardening" }),
      "src/server.ts": [
        'import { formatId } from "./format.ts";',
        "export function start() {",
        "  return Bun.serve({",
        "    port: 0,",
        "    routes: {",
        '      "/api/ping": new Response("pong"),',
        '      "/api/items/:id": {',
        '        GET: () => new Response(formatId("1")),',
        '        POST: () => new Response("ok"),',
        "      },",
        "    },",
        "  });",
        "}",
      ].join("\n"),
      "src/format.ts": "export function formatId(id: string): string { return id.trim(); }\n",
      "ci/pipelines/deploy-prod.yml": [
        "trigger: [main]",
        "jobs:",
        "  - job: DeployInfra",
        "    steps:",
        "      - bash: tofu apply -auto-approve",
      ].join("\n"),
      "infra/main.tf": 'resource "azurerm_container_app" "web" { name = "web-app" }\n',
      "TestResults/coverage.cobertura.xml":
        '<coverage line-rate="0.75" branch-rate="0.5"><packages><package name="app"><classes><class filename="format.ts" line-rate="1.0"/></classes></package></packages></coverage>',
    });

    try {
      const res = await Effect.runPromise(
        generateRepoSpecEffect(dir, "artifact", path.join(dir, "out.sqlite")).pipe(Effect.provide(RepospecLive)),
      );
      const routes = res.spec.surfaces.endpoints.map((e) => `${e.method} ${e.path}`);
      expect(routes).toContain("ANY /api/ping");
      expect(routes).toContain("GET /api/items/:id");
      expect(routes).toContain("POST /api/items/:id");
      expect(res.spec.summary.workflowCount).toBe(1);
      expect(res.spec.verification.coverageSource).toBe("cobertura");
      expect(res.spec.verification.realLineCoveragePct).toBe(75);
      const formatDrill = res.drilldown.files.find((f) => f.p === "src/format.ts");
      expect(formatDrill?.fc).toBe(100);
      const modDiag = res.spec.diagrams.find((d) => d.category === "modules");
      expect(modDiag?.tierKind).toBe("inferred_dag_tiers");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
