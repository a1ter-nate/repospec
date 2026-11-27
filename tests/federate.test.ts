import { describe, expect, test } from "bun:test";
import { aggregateRepoSpecs } from "@repospec/plugin-arch";
import { renderVisualHtml } from "@repospec/plugin-studio";
import { parseRepoSpec, type RepoSpecV4 } from "@repospec/plugin";
import type { CommitArchDiff } from "@repospec/plugin-studio";

function makeMinimalSpec(params: {
  name: string;
  role: "client" | "service" | "library";
  externals?: string[];
  envNames?: string[];
  entities?: Array<{ datastore: string; entity: string }>;
  endpoints?: Array<{ method: string; path: string }>;
}): RepoSpecV4 {
  return parseRepoSpec({
    schemaVersion: "5.0.0",
    specKind: "repospec.canonical",
    repo: {
      name: params.name,
      ecosystem: "typescript",
      languages: ["typescript"],
      commitSha: "abc1234",
      branch: "main",
      remote: `https://github.com/example/${params.name}`,
      scopeRootRel: ".",
      storageMode: "artifact",
      extractors: ["test"],
    },
    nodes: [
      {
        id: `arch:app:${params.name}`,
        domain: "arch",
        kind: params.role === "library" ? "package" : "app",
        role: params.role,
        label: params.name,
        provenance: { file: "package.json" },
        tags: [],
        meta: {},
      },
      ...(params.externals ?? []).map((ex) => ({
        id: `arch:ext:${ex}`,
        domain: "arch" as const,
        kind: "external_service" as const,
        role: "external" as const,
        label: ex,
        provenance: { file: "src/client.ts" },
        tags: [],
        meta: {},
      })),
    ],
    edges: [],
    rules: [],
    invariants: [],
    entities: (params.entities ?? []).map((e) => ({
      datastore: e.datastore,
      entity: e.entity,
      declared: true,
      authorizedShared: false,
      totalRefs: 3,
      layers: ["persistence"],
      domains: ["core"],
      hasBypass: false,
      fkCount: 0,
      hasTenancyKey: false,
      sampleFiles: ["src/dao.ts"],
    })),
    stateMachines: [],
    loops: [],
    catalogArtifacts: [],
    modules: [],
    traces: [],
    surfaces: {
      endpoints: (params.endpoints ?? []).map((ep) => ({
        unit: params.name,
        method: ep.method,
        path: ep.path,
        authGuard: "jwt",
        source: "ast" as const,
        file: "src/routes.ts",
      })),
      foreignKeys: [],
      envBindings: (params.envNames ?? []).map((ev) => ({
        name: ev,
        sources: ["process.env"],
        units: [params.name],
        isSecret: false,
        sampleFile: "src/config.ts",
      })),
      govRules: [],
    },
    diagrams: [],
    verification: {
      totalSourceFiles: 10,
      directlyTestedSourceFiles: 6,
      directTestCoveragePct: 60,
      registeredGates: 1,
      ciWiredGates: 1,
      unwiredGateNames: [],
      invariantsPassed: 1,
      invariantsWarned: 0,
      invariantsFailed: 0,
      invariantsNa: 0,
    },
    diagnostics: [],
    summary: {
      totalNodes: 1 + (params.externals?.length ?? 0),
      totalEdges: 0,
      totalRules: 0,
      crossDomainEdges: 0,
      countsByDomain: { arch: 1, ci: 0, test: 0, iac: 0, rules: 0 },
      countsByNodeKind: {},
      countsByEdgeKind: {},
      testFilesByRung: {},
      iacByPlane: { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 },
      workflowCount: 1,
      ciJobCount: 1,
      indexedSourceFiles: 10,
      indexedImportEdges: 12,
      datastoreEntities: params.entities?.length ?? 0,
      externalServices: params.externals?.length ?? 0,
      stateMachines: 0,
      loops: 0,
      httpEndpoints: params.endpoints?.length ?? 0,
      foreignKeys: 0,
      envBindings: params.envNames?.length ?? 0,
      govRules: 0,
      docDriftCount: 0,
    },
  });
}

function makeMockDiff(slug: string, subject: string): CommitArchDiff {
  return {
    range: "aaa1111..bbb2222",
    baseRef: "main",
    headRef: "feat/pr",
    baseSha: "aaa1111",
    headSha: "bbb2222",
    commitSubject: subject,
    author: "dev",
    date: "2026-11-25",
    commitCount: 1,
    verdict: "safe",
    verdictSummary: "Touches 1 file (+12/-2).",
    kpis: {
      failures: { before: 0, after: 0, delta: 0 },
      warnings: { before: 0, after: 0, delta: 0 },
      coveragePct: { before: 60, after: 62, delta: 2 },
      files: { added: 0, modified: 1, deleted: 0, insertions: 12, deletions: 2 },
      nodes: { added: 0, modified: 1, removed: 0 },
      edges: { added: 0, removed: 0 },
    },
    surfaces: {
      endpointsAdded: [`POST /${slug}/sync`],
      endpointsRemoved: [],
      externalAdded: [],
      externalRemoved: [],
      envAdded: [],
      envRemoved: [],
      entitiesAdded: [],
      entitiesRemoved: [],
    },
    findings: { introduced: [], resolved: [], persistentCount: 0 },
    edgeChanges: { added: [], removed: [] },
    changedFiles: [
      {
        path: "src/handler.ts",
        status: "modified",
        insertions: 12,
        deletions: 2,
        unitSlug: slug,
        moduleId: null,
        blastRadius: 1,
        hunk: "@@ -1,2 +1,3 @@\n export function handle() {\n+  return true;\n }",
      },
    ],
    diagrams: [],
  };
}

describe("Multi-Repo Distributed System Aggregator", () => {
  test("links microservices via externals & env URLs, flags shared-DB coupling, and rolls up PR diffs", () => {
    const web = makeMinimalSpec({
      name: "web-frontend",
      role: "client",
      externals: ["orders-api", "Stripe"],
      envNames: ["ORDERS_API_URL"],
    });
    const orders = makeMinimalSpec({
      name: "orders-service",
      role: "service",
      envNames: ["BILLING_SERVICE_URL"],
      entities: [{ datastore: "postgres", entity: "invoices" }],
      endpoints: [{ method: "POST", path: "/orders" }],
    });
    const billing = makeMinimalSpec({
      name: "billing-service",
      role: "service",
      externals: ["Stripe"],
      entities: [{ datastore: "postgres", entity: "invoices" }],
      endpoints: [{ method: "POST", path: "/charge" }],
    });

    const result = aggregateRepoSpecs({
      name: "acme-mesh",
      inputs: [
        { spec: web },
        { spec: orders, diff: makeMockDiff("orders-service", "Add order sync endpoint") },
        { spec: billing, diff: makeMockDiff("billing-service", "Add invoice charge retry") },
      ],
    });

    expect(result.spec.repo.name).toBe("acme-mesh");
    expect(result.stats.repos).toBe(3);
    expect(result.stats.crossRepoServiceEdges).toBe(2);
    expect(result.stats.sharedDatastoreEntities).toBe(1);
    expect(result.stats.crossRepoCycles).toBe(0);
    expect(result.stats.activePrDiffs).toBe(2);

    const sharedDbInv = result.spec.invariants.find((i) => i.id === "fed:shared-datastore-coupling");
    expect(sharedDbInv?.status).toBe("warn");
    expect(sharedDbInv?.violationCount).toBe(1);

    const cycleInv = result.spec.invariants.find((i) => i.id === "fed:cross-repo-cycle");
    expect(cycleInv?.status).toBe("pass");

    expect(result.commitDiff?.changedFiles.length).toBe(2);
    expect(result.commitDiff?.diagrams.length).toBe(1);

    const html = renderVisualHtml(result.spec, result.digest, { inline: false, commitDiff: result.commitDiff });
    expect(html).toContain("acme-mesh");
    expect(html).toContain("Copy Visual PR");
    const scriptMatches = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
    const appScript = scriptMatches[scriptMatches.length - 1]?.[1] ?? "";
    expect(() => new Function(appScript)).not.toThrow();
  });

  test("detects distributed circular dependencies across repositories", () => {
    const svcA = makeMinimalSpec({ name: "alpha-service", role: "service", externals: ["beta-service"] });
    const svcB = makeMinimalSpec({ name: "beta-service", role: "service", externals: ["alpha-service"] });

    const res = aggregateRepoSpecs({
      name: "cyclic-mesh",
      inputs: [{ spec: svcA }, { spec: svcB }],
    });

    expect(res.stats.crossRepoCycles).toBe(1);
    const cycleInv = res.spec.invariants.find((i) => i.id === "fed:cross-repo-cycle");
    expect(cycleInv?.status).toBe("fail");
    expect(res.spec.verification.invariantsFailed).toBe(1);
  });
});
