import { describe, expect, test } from "bun:test";
import { aggregateRepoSpecs } from "@repospec/plugin-arch";
import { renderVisualHtml } from "@repospec/plugin-studio";
import { parseRepoSpec, type RepoSpecV4 } from "@repospec/plugin";
import type { CommitArchDiff } from "@repospec/plugin-studio";

function makeSmokeSpec(name: string, opts?: { externals?: string[]; entities?: Array<{ datastore: string; entity: string }> }): RepoSpecV4 {
  return parseRepoSpec({
    schemaVersion: "5.0.0",
    specKind: "repospec.canonical",
    repo: {
      name,
      ecosystem: "typescript",
      languages: ["typescript"],
      commitSha: "abcdef123456",
      branch: "main",
      remote: `https://github.com/acme/${name}`,
      scopeRootRel: ".",
      storageMode: "artifact",
      extractors: ["smoke"],
    },
    nodes: [
      {
        id: `arch:app:${name}`,
        domain: "arch",
        kind: "app",
        role: "service",
        label: name,
        provenance: { file: "src/index.ts" },
        tags: ["typescript"],
        meta: {},
      },
      ...(opts?.externals ?? []).map((ext) => ({
        id: `arch:ext:${ext}`,
        domain: "arch" as const,
        kind: "external_service" as const,
        role: "external" as const,
        label: ext,
        provenance: { file: "src/client.ts" },
        tags: ["http"],
        meta: {},
      })),
    ],
    edges: [],
    rules: [],
    invariants: [],
    entities: (opts?.entities ?? []).map((e) => ({
      datastore: e.datastore,
      entity: e.entity,
      declared: true,
      authorizedShared: false,
      totalRefs: 2,
      layers: ["dao"],
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
    surfaces: { endpoints: [], foreignKeys: [], envBindings: [], govRules: [] },
    diagrams: [],
    verification: {
      totalSourceFiles: 10,
      directlyTestedSourceFiles: 8,
      directTestCoveragePct: 80,
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
      totalNodes: 1,
      totalEdges: 0,
      totalRules: 0,
      crossDomainEdges: 0,
      countsByDomain: { arch: 1, ci: 0, test: 0, iac: 0, rules: 0 },
      countsByNodeKind: { app: 1 },
      countsByEdgeKind: {},
      testFilesByRung: {},
      iacByPlane: { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 },
      workflowCount: 0,
      ciJobCount: 0,
      indexedSourceFiles: 10,
      indexedImportEdges: 2,
      datastoreEntities: opts?.entities?.length ?? 0,
      externalServices: opts?.externals?.length ?? 0,
      stateMachines: 0,
      loops: 0,
      httpEndpoints: 0,
      foreignKeys: 0,
      envBindings: 0,
      govRules: 0,
      docDriftCount: 0,
    },
  });
}

function makeSmokeDiff(): CommitArchDiff {
  return {
    range: "HEAD~1..HEAD",
    baseRef: "HEAD~1",
    headRef: "HEAD",
    baseSha: "1111111",
    headSha: "2222222",
    commitSubject: "feat: smoke diff",
    author: "dev",
    date: "2026-11-25",
    commitCount: 1,
    verdict: "safe",
    verdictSummary: "No regressions.",
    kpis: {
      failures: { before: 0, after: 0, delta: 0 },
      warnings: { before: 0, after: 0, delta: 0 },
      coveragePct: { before: 80, after: 82, delta: 2 },
      files: { added: 0, modified: 1, deleted: 0, insertions: 12, deletions: 2 },
      nodes: { added: 0, modified: 1, removed: 0 },
      edges: { added: 0, removed: 0 },
    },
    surfaces: {
      endpointsAdded: ["POST /orders"],
      endpointsRemoved: [],
      externalAdded: [],
      externalRemoved: [],
      envAdded: [],
      envRemoved: [],
      entitiesAdded: ["postgres:orders"],
      entitiesRemoved: [],
    },
    findings: { introduced: [], resolved: [], persistentCount: 0 },
    edgeChanges: { added: [], removed: [] },
    changedFiles: [
      {
        path: "src/routes.ts",
        status: "modified",
        insertions: 12,
        deletions: 2,
        unitSlug: "orders-api",
        moduleId: null,
        blastRadius: 1,
      },
    ],
    diagrams: [],
  };
}

function assertValidStudioHtml(html: string): void {
  expect(html).toContain("RepoSpec v5.0.0");
  const scriptMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);
  expect(scriptMatch?.[1]).toBeTruthy();
  expect(() => new Function(scriptMatch?.[1] ?? "")).not.toThrow();
}

describe("Studio HTML runtime smoke suite", () => {
  test("federated distributed-system HTML compiles cleanly and preserves datastore entity counts + Visual PR provenance", () => {
    const agg = aggregateRepoSpecs({
      name: "smoke-mesh",
      inputs: [
        {
          spec: makeSmokeSpec("orders-api", {
            externals: ["billing-api"],
            entities: [
              { datastore: "postgres", entity: "orders" },
              { datastore: "postgres", entity: "line_items" },
            ],
          }),
          diff: makeSmokeDiff(),
        },
        {
          spec: makeSmokeSpec("billing-api", {
            entities: [{ datastore: "postgres", entity: "orders" }],
          }),
        },
      ],
    });

    const dbNode = agg.spec.nodes.find((n) => n.id === "fed:db:postgres");
    expect(dbNode?.meta.entityCount).toBe(2);
    const runtimeDiag = agg.spec.diagrams.find((d) => d.category === "runtime");
    const dbLayoutNode = runtimeDiag?.nodes.find((n) => n.id === "fed:db:postgres");
    expect(dbLayoutNode?.sublabel).toBe("2 entities");

    const standaloneHtml = renderVisualHtml(agg.spec, agg.digest, { inline: false, commitDiff: agg.commitDiff });
    const inlineHtml = renderVisualHtml(agg.spec, agg.digest, { inline: true, commitDiff: agg.commitDiff });

    assertValidStudioHtml(standaloneHtml);
    assertValidStudioHtml(inlineHtml);
    expect(inlineHtml).not.toContain("100vh");
    expect(inlineHtml).not.toContain("html, body { margin: 0; padding: 0; background: transparent;");
    expect(inlineHtml).toContain("html, body { margin: 0; padding: 0; background: var(--bg-0);");
    expect(standaloneHtml).toContain("html, body { margin: 0; padding: 0; background: var(--bg-0);");
    expect(standaloneHtml).toContain("buildShowMeVisualPrMarkdown");
    expect(standaloneHtml).toContain("Generated deterministically by RepoSpec");
    expect(standaloneHtml).toContain("2 entities");
    expect(standaloneHtml).toContain("if (ctxFiles.length === 1 && ddIdxByPath.has(ctxFiles[0]))");
    expect(standaloneHtml).toContain("renderCodeBlockHtml(idx, f.p, 1, f.l, 1, true, false)");
    expect(standaloneHtml).toContain("renderInlineSourceDisclosure(provFile, node.provenance?.line");
  });
});
