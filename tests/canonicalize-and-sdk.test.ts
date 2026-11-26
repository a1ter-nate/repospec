import { describe, expect, test } from "bun:test";
import { buildCanonicalSpec, diffSpecs, hashSpec, mergeFragments, serializeSpec } from "../src/canonicalize.ts";
import {
  createEmptyAst,
  type GraphFragment,
  type RepoContext,
  type RepoSpecV4,
  type SpecEdge,
  type SpecNode,
} from "../src/schema.ts";
import { generateIdsModule, generateSqliteSdkModule } from "../src/sdkGen.ts";

function makeCtx(name = "@unit/sample"): RepoContext {
  return {
    rootDir: "/tmp/sample",
    scopeRoot: "/tmp/sample",
    scopeRootRel: ".",
    storageMode: "artifact",
    repoName: name,
    ecosystem: "typescript",
    languages: ["typescript"],
    commitSha: "abcdef1",
    branch: "main",
    remote: "https://github.com/example/sample",
    units: [],
    allFiles: [],
  };
}

function makeNode(id: string, kind: SpecNode["kind"] = "package", overrides: Partial<SpecNode> = {}): SpecNode {
  return {
    id,
    domain: "arch",
    kind,
    label: id.split(":").pop() ?? id,
    provenance: { file: "package.json" },
    tags: [],
    meta: {},
    ...overrides,
  };
}

function makeSpec(nodes: SpecNode[], edges: SpecEdge[], invariants: RepoSpecV4["invariants"] = []): RepoSpecV4 {
  return buildCanonicalSpec({
    ctx: makeCtx(),
    extractorIds: ["arch"],
    nodes,
    edges,
    rules: [],
    ast: createEmptyAst(),
    invariants,
    entities: [
      {
        datastore: "postgres",
        entity: "orders",
        declared: true,
        authorizedShared: false,
        totalRefs: 2,
        layers: ["persistence"],
        domains: ["orders"],
        hasBypass: false,
        fkCount: 1,
        hasTenancyKey: true,
        sampleFiles: ["src/dao/orders.ts"],
      },
    ],
    stateMachines: [],
    loops: [],
    catalogArtifacts: [],
    modules: [],
    traces: [],
    surfaces: {
      endpoints: [],
      foreignKeys: [],
      envBindings: [],
      govRules: [],
      docDriftCount: 0,
    },
    diagrams: [],
    verification: {
      totalSourceFiles: 4,
      directlyTestedSourceFiles: 3,
      directTestCoveragePct: 75,
      registeredGates: 2,
      ciWiredGates: 2,
      unwiredGateNames: [],
      invariantsPassed: invariants.filter((i) => i.status === "pass").length,
      invariantsWarned: invariants.filter((i) => i.status === "warn").length,
      invariantsFailed: invariants.filter((i) => i.status === "fail").length,
      invariantsNa: invariants.filter((i) => i.status === "na").length,
    },
    diagnostics: [],
  });
}

describe("Canonicalization & SDK generation (R2 pure unit)", () => {
  test("mergeFragments deduplicates nodes and sorts tags and meta keys deterministically", () => {
    const f1: GraphFragment = {
      nodes: [
        makeNode("arch:pkg:b", "package", { tags: ["z", "a"], meta: { zKey: 1, aKey: 2 } }),
        makeNode("arch:pkg:a", "package", { ownerId: "arch:app:web", tags: ["core"] }),
      ],
      edges: [],
      rules: [],
    };
    const f2: GraphFragment = {
      nodes: [
        makeNode("arch:pkg:b", "package", { ownerId: "arch:app:api", tags: ["m", "a"], meta: { bKey: 3 } }),
      ],
      edges: [],
      rules: [],
    };

    const mergedForward = mergeFragments([f1, f2]);
    const mergedReverse = mergeFragments([f2, f1]);

    expect(mergedForward.nodes.map((n) => n.id)).toEqual(["arch:pkg:a", "arch:pkg:b"]);
    const nodeB = mergedForward.nodes[1];
    expect(nodeB?.tags).toEqual(["a", "m", "z"]);
    expect(Object.keys(nodeB?.meta ?? {})).toEqual(["aKey", "bKey", "zKey"]);
    expect(nodeB?.ownerId).toBe("arch:app:api");
    expect(mergedForward.nodes.map((n) => n.id)).toEqual(mergedReverse.nodes.map((n) => n.id));
  });

  test("mergeFragments merges duplicate edges by taking max weight, observed confidence, and union of ruleIds", () => {
    const nodes = [makeNode("arch:app:api", "app"), makeNode("arch:pkg:db", "package")];
    const merged = mergeFragments([
      {
        nodes,
        edges: [
          {
            from: "arch:app:api",
            to: "arch:pkg:db",
            kind: "depends_on",
            weight: 1,
            confidence: "inferred",
            violation: false,
            ruleIds: ["r-b"],
          },
        ],
        rules: [],
      },
      {
        nodes: [],
        edges: [
          {
            from: "arch:app:api",
            to: "arch:pkg:db",
            kind: "depends_on",
            weight: 4,
            confidence: "observed",
            violation: true,
            ruleIds: ["r-a", "r-b"],
          },
        ],
        rules: [],
      },
    ]);

    expect(merged.edges).toHaveLength(1);
    const edge = merged.edges[0];
    expect(edge?.weight).toBe(4);
    expect(edge?.confidence).toBe("observed");
    expect(edge?.violation).toBe(true);
    expect(edge?.ruleIds).toEqual(["r-a", "r-b"]);
  });

  test("mergeFragments prunes dangling edges and records an error diagnostic", () => {
    const merged = mergeFragments([
      {
        nodes: [makeNode("arch:app:api", "app")],
        edges: [
          {
            from: "arch:app:api",
            to: "arch:pkg:missing",
            kind: "depends_on",
            weight: 1,
            confidence: "observed",
          },
        ],
        rules: [],
      },
    ]);

    expect(merged.edges).toHaveLength(0);
    expect(merged.diagnostics).toHaveLength(1);
    expect(merged.diagnostics[0]?.code).toBe("graph.dangling-edges-pruned");
    expect(merged.diagnostics[0]?.severity).toBe("error");
  });

  test("hashSpec is deterministic across equivalent specs and ignores evidence anchor noise", () => {
    const n1 = makeNode("arch:app:api", "app");
    const n2 = makeNode("arch:pkg:core", "package");
    const edge: SpecEdge = { from: n1.id, to: n2.id, kind: "depends_on", weight: 1, confidence: "observed" };

    const baseInv: RepoSpecV4["invariants"][number] = {
      id: "sql:layer-inversion",
      name: "Layer Inversion",
      rung: "R1",
      severity: "error",
      status: "fail",
      statement: "No upward imports",
      why: "Prevents cyclic layering",
      fix: "Invert dependency via interface",
      sqlFile: "rules/layer.sql",
      violationCount: 1,
      evidence: [
        {
          subject: "dao->routes",
          file: "src/dao.ts",
          line: 10,
          detail: "bad",
          anchors: [{ diagramId: "runtime", nodeIds: ["arch:app:api"], edgeIds: [] }],
        },
      ],
    };
    const invBase: RepoSpecV4["invariants"] = [baseInv];
    const invDifferentAnchor: RepoSpecV4["invariants"] = [
      {
        ...baseInv,
        evidence: [
          {
            subject: "dao->routes",
            file: "src/dao.ts",
            line: 10,
            detail: "bad",
            anchors: [{ diagramId: "layers", nodeIds: ["arch:pkg:core"], edgeIds: ["e1"] }],
          },
        ],
      },
    ];

    const specA = makeSpec([n1, n2], [edge], invBase);
    const specB = makeSpec([n1, n2], [edge], invDifferentAnchor);
    const specC = makeSpec([n1, n2], [], invBase);

    expect(hashSpec(specA)).toBe(hashSpec(specB));
    expect(hashSpec(specA)).not.toBe(hashSpec(specC));
    expect(serializeSpec(specA).endsWith("\n")).toBe(true);
  });

  test("diffSpecs detects added and removed nodes, edges, and invariant deltas", () => {
    const app = makeNode("arch:app:api", "app");
    const core = makeNode("arch:pkg:core", "package");
    const billing = makeNode("arch:pkg:billing", "package");
    const baseSpec = makeSpec(
      [app, core],
      [{ from: app.id, to: core.id, kind: "depends_on", weight: 1, confidence: "observed" }],
      [
        {
          id: "sql:orphan",
          name: "Orphan",
          rung: "R1",
          severity: "warn",
          status: "warn",
          statement: "No orphans",
          why: "Avoids dead modules",
          fix: "Import or delete module",
          sqlFile: "rules/orphan.sql",
          violationCount: 2,
          evidence: [],
        },
      ],
    );
    const headSpec = makeSpec(
      [app, billing],
      [{ from: app.id, to: billing.id, kind: "depends_on", weight: 1, confidence: "observed" }],
      [
        {
          id: "sql:orphan",
          name: "Orphan",
          rung: "R1",
          severity: "warn",
          status: "pass",
          statement: "No orphans",
          why: "Avoids dead modules",
          fix: "Import or delete module",
          sqlFile: "rules/orphan.sql",
          violationCount: 0,
          evidence: [],
        },
      ],
    );

    const diff = diffSpecs(baseSpec, headSpec);
    expect(diff.changed).toBe(true);
    expect(diff.addedNodes).toEqual(["arch:pkg:billing"]);
    expect(diff.removedNodes).toEqual(["arch:pkg:core"]);
    expect(diff.addedEdges).toEqual(["arch:app:api|depends_on|arch:pkg:billing"]);
    expect(diff.removedEdges).toEqual(["arch:app:api|depends_on|arch:pkg:core"]);
    expect(diff.invariantDeltas).toEqual([
      { id: "sql:orphan", baseCount: 2, headCount: 0, baseStatus: "warn", headStatus: "pass" },
    ]);
  });

  test("generateIdsModule and generateSqliteSdkModule emit Effect Schema IDs, Schema.Never fallbacks, and readonly query helpers", () => {
    const spec = makeSpec([makeNode("arch:app:web", "app"), makeNode("arch:pkg:ui", "package")], []);
    const digest = hashSpec(spec);
    const idsSrc = generateIdsModule(spec, digest);
    const sdkSrc = generateSqliteSdkModule();

    expect(idsSrc).toContain(`export const REPOSPEC_DIGEST = ${JSON.stringify(digest)} as const;`);
    expect(idsSrc).toContain('export type AppId = "arch:app:web";');
    expect(idsSrc).toContain('export type PackageId = "arch:pkg:ui";');
    expect(idsSrc).toContain('export type EntityName = "orders";');
    expect(idsSrc).toContain("export const StateMachineIdSchema = Schema.Never;");
    expect(sdkSrc).toContain('export const REPOSPEC_SDK_RUNTIME = "bun:sqlite" as const;');
    expect(sdkSrc).toContain("new Database(dbPath, { readonly: true })");
  });
});
