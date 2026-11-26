import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { startStudioServer } from "../src/ai/studioServer.ts";
import { aggregateRepoSpecs } from "../src/extractors/federate.ts";
import { computeTopologicalLevels } from "../src/internal/topoLevels.ts";
import { parseRepoSpec, type RepoSpecV4 } from "../src/schema.ts";

interface MeshModel {
  repos: Map<string, { role: "client" | "service" | "library"; externals: Set<string>; entities: Set<string> }>;
}

interface MeshReal {
  specs: Map<string, RepoSpecV4>;
}

const REPO_POOL = ["alpha-svc", "beta-svc", "gamma-svc", "delta-svc"] as const;
const ENTITY_POOL = ["orders", "invoices", "users"] as const;

function buildRepoSpecFromModel(
  name: string,
  state: { role: "client" | "service" | "library"; externals: Set<string>; entities: Set<string> },
): RepoSpecV4 {
  const externals = Array.from(state.externals).sort();
  const entities = Array.from(state.entities).sort();
  return parseRepoSpec({
    schemaVersion: "5.0.0",
    specKind: "repospec.canonical",
    repo: {
      name,
      ecosystem: "typescript",
      languages: ["typescript"],
      commitSha: "fed0001",
      branch: "main",
      remote: `https://github.com/example/${name}`,
      scopeRootRel: ".",
      storageMode: "artifact",
      extractors: ["mbt"],
    },
    nodes: [
      {
        id: `arch:app:${name}`,
        domain: "arch",
        kind: state.role === "library" ? "package" : "app",
        role: state.role,
        label: name,
        provenance: { file: "package.json" },
        tags: [],
        meta: {},
      },
      ...externals.map((ex) => ({
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
    entities: entities.map((entity) => ({
      datastore: "postgres",
      entity,
      declared: true,
      authorizedShared: false,
      totalRefs: 2,
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
    surfaces: { endpoints: [], foreignKeys: [], envBindings: [], govRules: [] },
    diagrams: [],
    verification: {
      totalSourceFiles: 5,
      directlyTestedSourceFiles: 5,
      directTestCoveragePct: 100,
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
      totalNodes: 1 + externals.length,
      totalEdges: 0,
      totalRules: 0,
      crossDomainEdges: 0,
      countsByDomain: { arch: 1 + externals.length, ci: 0, test: 0, iac: 0, rules: 0 },
      countsByNodeKind: {},
      countsByEdgeKind: {},
      testFilesByRung: {},
      iacByPlane: { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 },
      workflowCount: 1,
      ciJobCount: 1,
      indexedSourceFiles: 5,
      indexedImportEdges: 2,
      datastoreEntities: entities.length,
      externalServices: externals.length,
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

class RegisterRepoCommand implements fc.Command<MeshModel, MeshReal> {
  constructor(
    readonly name: string,
    readonly role: "client" | "service" | "library",
  ) {}

  check(m: Readonly<MeshModel>): boolean {
    return !m.repos.has(this.name);
  }

  run(m: MeshModel, r: MeshReal): void {
    const state = { role: this.role, externals: new Set<string>(), entities: new Set<string>() };
    m.repos.set(this.name, state);
    r.specs.set(this.name, buildRepoSpecFromModel(this.name, state));
  }

  toString(): string {
    return `RegisterRepo(${this.name},${this.role})`;
  }
}

class AddServiceEdgeCommand implements fc.Command<MeshModel, MeshReal> {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {}

  check(m: Readonly<MeshModel>): boolean {
    return this.from !== this.to && m.repos.has(this.from) && m.repos.has(this.to);
  }

  run(m: MeshModel, r: MeshReal): void {
    const src = m.repos.get(this.from);
    if (!src) return;
    src.externals.add(this.to);
    r.specs.set(this.from, buildRepoSpecFromModel(this.from, src));
  }

  toString(): string {
    return `AddServiceEdge(${this.from}->${this.to})`;
  }
}

class AttachEntityCommand implements fc.Command<MeshModel, MeshReal> {
  constructor(
    readonly repo: string,
    readonly entity: string,
  ) {}

  check(m: Readonly<MeshModel>): boolean {
    return m.repos.has(this.repo);
  }

  run(m: MeshModel, r: MeshReal): void {
    const state = m.repos.get(this.repo);
    if (!state) return;
    state.entities.add(this.entity);
    r.specs.set(this.repo, buildRepoSpecFromModel(this.repo, state));
  }

  toString(): string {
    return `AttachEntity(${this.repo},${this.entity})`;
  }
}

class AggregateAndVerifyCommand implements fc.Command<MeshModel, MeshReal> {
  check(m: Readonly<MeshModel>): boolean {
    return m.repos.size >= 1;
  }

  run(m: MeshModel, r: MeshReal): void {
    const inputs = Array.from(r.specs.values()).map((spec) => ({ spec }));
    const reversedInputs: Array<{ spec: RepoSpecV4 }> = [];
    for (let i = inputs.length - 1; i >= 0; i -= 1) {
      const item = inputs[i];
      if (item) reversedInputs.push(item);
    }
    const res1 = aggregateRepoSpecs({ name: "mbt-mesh", inputs });
    const res2 = aggregateRepoSpecs({ name: "mbt-mesh", inputs: reversedInputs });

    expect(res1.stats.repos).toBe(m.repos.size);
    expect(res1.digest).toBe(res2.digest);

    const entityOwners = new Map<string, number>();
    for (const st of m.repos.values()) {
      for (const ent of st.entities) {
        entityOwners.set(ent, (entityOwners.get(ent) ?? 0) + 1);
      }
    }
    const expectedShared = Array.from(entityOwners.values()).filter((c) => c >= 2).length;
    expect(res1.stats.sharedDatastoreEntities).toBe(expectedShared);
    const sharedInv = res1.spec.invariants.find((i) => i.id === "fed:shared-datastore-coupling");
    expect(sharedInv?.status).toBe(expectedShared > 0 ? "warn" : "pass");

    const repoIds = Array.from(m.repos.keys());
    const edges: Array<{ from: string; to: string }> = [];
    for (const [from, st] of m.repos) {
      for (const to of st.externals) {
        if (m.repos.has(to)) edges.push({ from, to });
      }
    }
    const topo = computeTopologicalLevels(repoIds, edges);
    const expectedCycleCount = topo.sccs.filter((c) => c.length > 1).length;
    expect(res1.stats.crossRepoCycles).toBe(expectedCycleCount);
    const cycleInv = res1.spec.invariants.find((i) => i.id === "fed:cross-repo-cycle");
    expect(cycleInv?.status).toBe(expectedCycleCount > 0 ? "fail" : "pass");
  }

  toString(): string {
    return "AggregateAndVerify()";
  }
}

function createMeshSetup(): { model: MeshModel; real: MeshReal } {
  return {
    model: { repos: new Map() },
    real: { specs: new Map() },
  };
}

describe("Federated aggregator & Studio HTTP server boundary (R3 MBT + Host) [REQ-FED-01]", () => {
  test("arbitrary multi-repo mesh mutations preserve cycle, shared-datastore, and order-independence invariants", () => {
    const cmdArb = fc.commands(
      [
        fc
          .tuple(fc.constantFrom(...REPO_POOL), fc.constantFrom("client" as const, "service" as const, "library" as const))
          .map(([name, role]) => new RegisterRepoCommand(name, role)),
        fc
          .tuple(fc.constantFrom(...REPO_POOL), fc.constantFrom(...REPO_POOL))
          .map(([from, to]) => new AddServiceEdgeCommand(from, to)),
        fc
          .tuple(fc.constantFrom(...REPO_POOL), fc.constantFrom(...ENTITY_POOL))
          .map(([repo, entity]) => new AttachEntityCommand(repo, entity)),
        fc.constant(new AggregateAndVerifyCommand()),
      ],
      { maxCommands: 12 },
    );

    fc.assert(
      fc.property(cmdArb, (cmds) => {
        fc.modelRun(createMeshSetup, cmds);
      }),
      { numRuns: 25, seed: 20261125 },
    );
  });

  test("startStudioServer serves rendered HTML, handles inactive live SSE, and enforces loopback-only SSRF guard", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-studio-host-"));
    const htmlPath = path.join(tmpDir, "repospec.html");
    fs.writeFileSync(htmlPath, "<!doctype html><html><body><h1>RepoSpec Boundary</h1></body></html>", "utf8");

    const srv = startStudioServer({ targetPath: htmlPath, port: 0 });
    try {
      const rootRes = await fetch(`${srv.url}/`);
      expect(rootRes.status).toBe(200);
      expect(rootRes.headers.get("content-type")).toContain("text/html");
      expect(rootRes.headers.get("cache-control")).toBe("no-store");
      expect(await rootRes.text()).toContain("RepoSpec Boundary");

      const liveRes = await fetch(`${srv.url}/api/live`);
      expect(liveRes.status).toBe(204);

      const badJsonRes = await fetch(`${srv.url}/api/ai/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-valid-json",
      });
      expect(badJsonRes.status).toBe(400);

      const ssrfRes = await fetch(`${srv.url}/api/ai/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", prompt: "hello" }),
      });
      expect(ssrfRes.status).toBe(400);
      const ssrfJson = (await ssrfRes.json()) as { error?: string };
      expect(ssrfJson.error).toContain("loopback");

      const notFoundRes = await fetch(`${srv.url}/does-not-exist`);
      expect(notFoundRes.status).toBe(404);
    } finally {
      srv.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
