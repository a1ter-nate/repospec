import { describe, expect, test } from "bun:test";
import { parseRepoSpec, type RepoSpecV4 } from "../src/schema.ts";
import { buildCommitArchDiff } from "../src/studio/commitDiff.ts";

function makeBaseSpec(overrides: {
  invariants?: RepoSpecV4["invariants"];
  externals?: string[];
  endpoints?: Array<{ method: string; path: string }>;
  envNames?: string[];
  entities?: Array<{ datastore: string; entity: string }>;
  coveragePct?: number;
  edges?: RepoSpecV4["edges"];
} = {}): RepoSpecV4 {
  const invariants = overrides.invariants ?? [];
  const externals = overrides.externals ?? [];
  const endpoints = overrides.endpoints ?? [];
  const envNames = overrides.envNames ?? [];
  const entities = overrides.entities ?? [];
  return parseRepoSpec({
    schemaVersion: "5.0.0",
    specKind: "repospec.canonical",
    repo: {
      name: "@demo/platform",
      ecosystem: "typescript",
      languages: ["typescript"],
      commitSha: "1111111",
      branch: "main",
      remote: null,
      scopeRootRel: ".",
      storageMode: "artifact",
      extractors: ["arch"],
    },
    nodes: [
      {
        id: "arch:app:api",
        domain: "arch",
        kind: "app",
        role: "service",
        label: "@demo/api",
        provenance: { file: "apps/api/package.json" },
        tags: [],
        meta: { dir: "apps/api" },
      },
      ...externals.map((label) => ({
        id: `arch:ext:${label.toLowerCase()}`,
        domain: "arch" as const,
        kind: "external_service" as const,
        role: "external" as const,
        label,
        provenance: { file: "apps/api/src/client.ts" },
        tags: [],
        meta: {},
      })),
    ],
    edges: overrides.edges ?? [],
    rules: [],
    invariants,
    entities: entities.map((e) => ({
      datastore: e.datastore,
      entity: e.entity,
      declared: true,
      authorizedShared: false,
      totalRefs: 2,
      layers: ["persistence"],
      domains: ["core"],
      hasBypass: false,
      fkCount: 0,
      hasTenancyKey: false,
      sampleFiles: ["apps/api/src/dao.ts"],
    })),
    stateMachines: [],
    loops: [],
    catalogArtifacts: [],
    modules: [
      {
        id: "mod:api:routes",
        unitId: "arch:app:api",
        unitSlug: "api",
        unitName: "@demo/api",
        name: "routes",
        relPath: "apps/api/src/routes",
        kind: "directory",
        language: "typescript",
        level: 0,
        role: "entry",
        depth: "balanced",
        fileCount: 1,
        lines: 50,
        exportCount: 2,
        fanIn: 4,
        fanOut: 2,
        directTestCount: 1,
        inTangle: false,
        tangleId: null,
        hasSubsystemDiagram: false,
        capabilities: ["HTTP"],
        topExports: [],
        files: [
          {
            file: "apps/api/src/routes/orders.ts",
            lines: 50,
            exports: 2,
            isBarrel: false,
            directTests: 1,
            capabilities: ["HTTP"],
          },
        ],
      },
    ],
    traces: [],
    surfaces: {
      endpoints: endpoints.map((ep) => ({
        unit: "@demo/api",
        method: ep.method,
        path: ep.path,
        authGuard: "jwt",
        source: "ast" as const,
        file: "apps/api/src/routes/orders.ts",
      })),
      foreignKeys: [],
      envBindings: envNames.map((name) => ({
        name,
        sources: ["process.env"],
        units: ["@demo/api"],
        isSecret: false,
        sampleFile: "apps/api/src/env.ts",
      })),
      govRules: [],
    },
    diagrams: [],
    verification: {
      totalSourceFiles: 10,
      directlyTestedSourceFiles: 8,
      directTestCoveragePct: overrides.coveragePct ?? 80,
      registeredGates: 2,
      ciWiredGates: 2,
      unwiredGateNames: [],
      invariantsPassed: invariants.filter((i) => i.status === "pass").length,
      invariantsWarned: invariants.filter((i) => i.status === "warn").length,
      invariantsFailed: invariants.filter((i) => i.status === "fail").length,
      invariantsNa: 0,
    },
    diagnostics: [],
    summary: {
      totalNodes: 1 + externals.length,
      totalEdges: overrides.edges?.length ?? 0,
      totalRules: 0,
      crossDomainEdges: 0,
      countsByDomain: { arch: 1 + externals.length, ci: 0, test: 0, iac: 0, rules: 0 },
      countsByNodeKind: {},
      countsByEdgeKind: {},
      testFilesByRung: {},
      iacByPlane: { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 },
      workflowCount: 1,
      ciJobCount: 1,
      indexedSourceFiles: 10,
      indexedImportEdges: 5,
      datastoreEntities: entities.length,
      externalServices: externals.length,
      stateMachines: 0,
      loops: 0,
      httpEndpoints: endpoints.length,
      foreignKeys: 0,
      envBindings: envNames.length,
      govRules: 0,
      docDriftCount: 0,
    },
  });
}

function makeGitInfo(fileStats: Array<{ path: string; status: "added" | "modified" | "deleted" | "renamed"; insertions: number; deletions: number }>) {
  return {
    range: "1111111..2222222",
    baseRef: "main",
    headRef: "feat/test",
    baseSha: "1111111",
    headSha: "2222222",
    commitSubject: "feat: update api",
    author: "dev",
    date: "2026-11-25",
    commitCount: 1,
    fileStats,
  };
}

describe("Commit architectural diff classification (R2 pure unit)", () => {
  test("verdict is safe when no new errors, warnings, externals, or coverage regressions occur", () => {
    const baseSpec = makeBaseSpec({ coveragePct: 80 });
    const headSpec = makeBaseSpec({ coveragePct: 82 });

    const diff = buildCommitArchDiff({
      git: makeGitInfo([{ path: "apps/api/src/routes/orders.ts", status: "modified", insertions: 10, deletions: 4 }]),
      baseSpec,
      headSpec,
    });

    expect(diff.verdict).toBe("safe");
    expect(diff.verdictSummary).toContain("0 new architectural violations");
    expect(diff.kpis.coveragePct.delta).toBe(2);
    expect(diff.changedFiles[0]?.moduleId).toBe("mod:api:routes");
    expect(diff.changedFiles[0]?.blastRadius).toBe(4);
  });

  test("verdict is risk when new failing invariant findings are introduced and tracks resolved/persistent items", () => {
    const sharedEvidence = { subject: "dao->routes", file: "apps/api/src/dao.ts", line: 4, detail: "existing" };
    const resolvedEvidence = { subject: "client->routes", file: "apps/api/src/client.ts", line: 8, detail: "fixed" };
    const newEvidence = { subject: "dao->http", file: "apps/api/src/ordersDao.ts", line: 12, detail: "introduced" };

    const baseSpec = makeBaseSpec({
      invariants: [
        {
          id: "sql:layer-inversion",
          name: "Layer Inversion",
          rung: "R1",
          severity: "error",
          status: "fail",
          statement: "No upward imports",
          why: "Prevents upward dependency cycles",
          fix: "Move shared contracts to domain",
          sqlFile: "rules/layer.sql",
          violationCount: 2,
          evidence: [sharedEvidence, resolvedEvidence],
        },
      ],
    });
    const headSpec = makeBaseSpec({
      invariants: [
        {
          id: "sql:layer-inversion",
          name: "Layer Inversion",
          rung: "R1",
          severity: "error",
          status: "fail",
          statement: "No upward imports",
          why: "Prevents upward dependency cycles",
          fix: "Move shared contracts to domain",
          sqlFile: "rules/layer.sql",
          violationCount: 2,
          evidence: [sharedEvidence, newEvidence],
        },
      ],
    });

    const diff = buildCommitArchDiff({
      git: makeGitInfo([{ path: "apps/api/src/ordersDao.ts", status: "added", insertions: 30, deletions: 0 }]),
      baseSpec,
      headSpec,
    });

    expect(diff.verdict).toBe("risk");
    expect(diff.findings.persistentCount).toBe(1);
    expect(diff.findings.introduced.map((f) => f.subject)).toEqual(["dao->http"]);
    expect(diff.findings.resolved.map((f) => f.subject)).toEqual(["client->routes"]);
  });

  test("verdict is caution when a new external service is added or coverage drops by at least 1%", () => {
    const baseSpec = makeBaseSpec({ externals: ["Stripe"], coveragePct: 80 });
    const addedExternalSpec = makeBaseSpec({ externals: ["Stripe", "Twilio"], coveragePct: 80 });
    const covDropSpec = makeBaseSpec({ externals: ["Stripe"], coveragePct: 78.5 });

    const extDiff = buildCommitArchDiff({
      git: makeGitInfo([{ path: "apps/api/src/client.ts", status: "modified", insertions: 5, deletions: 0 }]),
      baseSpec,
      headSpec: addedExternalSpec,
    });
    expect(extDiff.verdict).toBe("caution");
    expect(extDiff.surfaces.externalAdded).toEqual(["Twilio"]);

    const covDiff = buildCommitArchDiff({
      git: makeGitInfo([{ path: "apps/api/src/routes/orders.ts", status: "modified", insertions: 12, deletions: 0 }]),
      baseSpec,
      headSpec: covDropSpec,
    });
    expect(covDiff.verdict).toBe("caution");
    expect(covDiff.kpis.coveragePct.delta).toBe(-1.5);
  });

  test("computes endpoint, env, entity, and edge deltas cleanly across base and head specs", () => {
    const baseSpec = makeBaseSpec({
      externals: ["Stripe"],
      endpoints: [{ method: "GET", path: "/v1/orders" }],
      envNames: ["STRIPE_KEY"],
      entities: [{ datastore: "postgres", entity: "orders" }],
      edges: [{ from: "arch:app:api", to: "arch:ext:stripe", kind: "calls_external", weight: 1, confidence: "observed" }],
    });
    const headSpec = makeBaseSpec({
      externals: ["Stripe", "Postmark"],
      endpoints: [
        { method: "GET", path: "/v1/orders" },
        { method: "POST", path: "/v1/orders" },
      ],
      envNames: ["STRIPE_KEY", "POSTMARK_TOKEN"],
      entities: [
        { datastore: "postgres", entity: "orders" },
        { datastore: "postgres", entity: "receipts" },
      ],
      edges: [
        { from: "arch:app:api", to: "arch:ext:stripe", kind: "calls_external", weight: 1, confidence: "observed" },
        { from: "arch:app:api", to: "arch:ext:postmark", kind: "calls_external", weight: 1, confidence: "observed" },
      ],
    });

    const diff = buildCommitArchDiff({
      git: makeGitInfo([{ path: "apps/api/src/routes/orders.ts", status: "modified", insertions: 18, deletions: 2 }]),
      baseSpec,
      headSpec,
    });

    expect(diff.surfaces.endpointsAdded).toEqual(["POST /v1/orders"]);
    expect(diff.surfaces.envAdded).toEqual(["POSTMARK_TOKEN"]);
    expect(diff.surfaces.entitiesAdded).toEqual(["postgres:receipts"]);
    expect(diff.edgeChanges.added).toEqual([{ from: "@demo/api", to: "Postmark", kind: "calls_external" }]);
    expect(diff.kpis.edges).toEqual({ added: 1, removed: 0 });
  });
});
