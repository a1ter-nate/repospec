import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { createAndPopulateIndexDb, projectInvariantsToGraph, querySurfaces, runSqlInvariants } from "../src/indexDb.ts";
import type { AstIndexData, CanonicalLayer, SpecEdge, SpecNode, UnitDescriptor } from "../src/schema.ts";
import { createEmptyAst } from "../src/schema.ts";
import { resolveLayerSemantics } from "../src/taxonomy.ts";

const RULES_DIR = path.resolve(import.meta.dir, "../rules");

interface WorkspaceModel {
  layers: Set<string>;
  inversions: number;
  contractEndpoints: Set<string>;
  fragmentEndpoints: Set<string>;
}

interface WorkspaceReal {
  unit: UnitDescriptor;
  nodes: SpecNode[];
  edges: SpecEdge[];
  ast: AstIndexData;
  fileSeq: number;
}

const LAYER_DEFS: Array<{ raw: string; canonical: CanonicalLayer }> = [
  { raw: "routes", canonical: "transport" },
  { raw: "service", canonical: "orchestration" },
  { raw: "dao", canonical: "persistence" },
  { raw: "client", canonical: "integration" },
];

function isLayerInversion(fromCanonical: CanonicalLayer, toCanonical: CanonicalLayer): boolean {
  if (fromCanonical === "persistence" && (toCanonical === "orchestration" || toCanonical === "transport")) return true;
  if (fromCanonical === "orchestration" && toCanonical === "transport") return true;
  if (
    fromCanonical === "integration" &&
    (toCanonical === "orchestration" || toCanonical === "transport" || toCanonical === "persistence")
  ) {
    return true;
  }
  return false;
}

class AddLayerImportCommand implements fc.Command<WorkspaceModel, WorkspaceReal> {
  constructor(
    readonly fromIdx: number,
    readonly toIdx: number,
  ) {}

  check(): boolean {
    return this.fromIdx !== this.toIdx;
  }

  run(m: WorkspaceModel, r: WorkspaceReal): void {
    const fromDef = LAYER_DEFS[this.fromIdx];
    const toDef = LAYER_DEFS[this.toIdx];
    if (!fromDef || !toDef) return;
    r.fileSeq += 1;
    const fromFile = `apps/api/src/${fromDef.raw}/f${r.fileSeq}.ts`;
    const toFile = `apps/api/src/${toDef.raw}/t${r.fileSeq}.ts`;

    for (const def of [fromDef, toDef]) {
      const lid = `arch:layer:api:${def.raw}`;
      if (!m.layers.has(def.raw)) {
        m.layers.add(def.raw);
        const sem = resolveLayerSemantics(def.raw, def.canonical);
        r.nodes.push({
          id: lid,
          domain: "arch",
          kind: "code_layer",
          role: "layer",
          label: def.raw,
          group: "api",
          ownerId: r.unit.id,
          provenance: { file: fromFile },
          tags: ["typescript", "layer", def.canonical, sem.axis],
          meta: {
            unit: r.unit.name,
            fileCount: 1,
            canonicalLayer: def.canonical,
            layerAxis: sem.axis,
            layerRank: sem.rank,
            laneId: sem.laneId,
            laneLabel: sem.laneLabel,
          },
        });
      }
    }

    r.ast.files.push(
      {
        file: fromFile,
        unit: r.unit.name,
        language: "typescript",
        layer: fromDef.raw,
        canonicalLayer: fromDef.canonical,
        domainArea: null,
        layerSource: "path_convention",
        domainSource: "none",
        isTest: false,
        isBarrel: false,
        lines: 20,
        exportsCount: 1,
      },
      {
        file: toFile,
        unit: r.unit.name,
        language: "typescript",
        layer: toDef.raw,
        canonicalLayer: toDef.canonical,
        domainArea: null,
        layerSource: "path_convention",
        domainSource: "none",
        isTest: false,
        isBarrel: false,
        lines: 20,
        exportsCount: 1,
      },
    );

    r.ast.fileImports.push({
      fromFile,
      toFile,
      fromUnit: r.unit.name,
      toUnit: r.unit.name,
      fromLayer: fromDef.raw,
      toLayer: toDef.raw,
      fromCanonicalLayer: fromDef.canonical,
      toCanonicalLayer: toDef.canonical,
      fromDomain: null,
      toDomain: null,
      line: 1,
      typeOnly: false,
    });

    r.edges.push({
      from: `arch:layer:api:${fromDef.raw}`,
      to: `arch:layer:api:${toDef.raw}`,
      kind: "imports_layer",
      weight: 1,
      confidence: "observed",
    });

    if (isLayerInversion(fromDef.canonical, toDef.canonical)) {
      m.inversions += 1;
    }
  }

  toString(): string {
    return `AddLayerImport(${LAYER_DEFS[this.fromIdx]?.raw}->${LAYER_DEFS[this.toIdx]?.raw})`;
  }
}

class AddOpenApiRouteCommand implements fc.Command<WorkspaceModel, WorkspaceReal> {
  constructor(readonly routeSlug: string) {}

  check(): boolean {
    return true;
  }

  run(m: WorkspaceModel, r: WorkspaceReal): void {
    const routePath = `/v1/${this.routeSlug}`;
    const key = `GET|${routePath}`;
    m.contractEndpoints.add(key);
    r.ast.httpEndpoints.push({
      unit: r.unit.name,
      method: "GET",
      path: routePath,
      authGuard: "bearerAuth",
      source: "openapi",
      resolution: "contract",
      handlerFile: "apps/api/openapi.json",
      line: 1,
      operationId: `get_${this.routeSlug}`,
    });
  }

  toString(): string {
    return `AddOpenApiRoute(/v1/${this.routeSlug})`;
  }
}

class AddSubRouterFragmentCommand implements fc.Command<WorkspaceModel, WorkspaceReal> {
  constructor(readonly fragmentPath: "/" | "/:id") {}

  check(): boolean {
    return true;
  }

  run(m: WorkspaceModel, r: WorkspaceReal): void {
    m.fragmentEndpoints.add(`GET|${this.fragmentPath}`);
    r.ast.httpEndpoints.push({
      unit: r.unit.name,
      method: "GET",
      path: this.fragmentPath,
      authGuard: null,
      source: "ast",
      resolution: "fragment",
      handlerFile: "apps/api/src/routes/sub.ts",
      line: 4,
      operationId: null,
    });
  }

  toString(): string {
    return `AddSubRouterFragment(${this.fragmentPath})`;
  }
}

class CompileAndAssertCommand implements fc.Command<WorkspaceModel, WorkspaceReal> {
  check(): boolean {
    return true;
  }

  run(m: WorkspaceModel, r: WorkspaceReal): void {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-mbt-"));
    const dbPath = path.join(tmpDir, "index.sqlite");
    try {
      const db = createAndPopulateIndexDb({
        dbPath,
        repoName: "@mbt/repo",
        commitSha: "0123456789abcdef",
        scopeRootRel: ".",
        units: [r.unit],
        nodes: r.nodes.map((n) => ({ ...n })),
        edges: r.edges.map((e) => ({ ...e })),
        rules: [],
        ast: r.ast,
        stateMachines: [],
        loops: [],
        catalogArtifacts: [],
      });
      try {
        const invariants = runSqlInvariants(db, RULES_DIR, []);
        const surfaces = querySurfaces(db);
        const layerInv = invariants.find((i) => i.id === "sql:layer-inversion");
        expect(layerInv?.violationCount ?? 0).toBe(m.inversions);

        const projected = projectInvariantsToGraph(
          r.nodes.map((n) => ({ ...n })),
          r.edges.map((e) => ({ ...e })),
          invariants,
        );
        const violatedEdges = projected.edges.filter((e) => e.violation === true);
        expect(violatedEdges.length > 0).toBe(m.inversions > 0);

        const expectedEndpointCount =
          m.contractEndpoints.size > 0 ? m.contractEndpoints.size : m.fragmentEndpoints.size;
        expect(surfaces.endpoints.length).toBe(expectedEndpointCount);
        const hasLeakedFragment =
          m.contractEndpoints.size > 0 && surfaces.endpoints.some((ep) => ep.resolution === "fragment");
        expect(hasLeakedFragment).toBe(false);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  toString(): string {
    return "CompileAndAssert()";
  }
}

describe("RepoSpec SQLite index & projection pipeline (R3 Stateful MBT) [REQ-PIPELINE-01]", () => {
  test("arbitrary sequences of layer imports, OpenAPI contracts, and sub-router fragments match reference model", () => {
    const cmdArb = fc.commands(
      [
        fc
          .tuple(fc.integer({ min: 0, max: LAYER_DEFS.length - 1 }), fc.integer({ min: 0, max: LAYER_DEFS.length - 1 }))
          .map(([a, b]) => new AddLayerImportCommand(a, b)),
        fc.constantFrom("orders", "billing", "devices", "users").map((slug) => new AddOpenApiRouteCommand(slug)),
        fc.constantFrom("/" as const, "/:id" as const).map((frag) => new AddSubRouterFragmentCommand(frag)),
        fc.constant(new CompileAndAssertCommand()),
      ],
      { maxCommands: 10 },
    );

    fc.assert(
      fc.property(cmdArb, (cmds) => {
        const unit: UnitDescriptor = {
          id: "arch:app:api",
          name: "@mbt/api",
          slug: "api",
          dir: "apps/api",
          absDir: "/tmp/mbt/apps/api",
          manifestFile: "apps/api/package.json",
          ecosystem: "typescript",
          kind: "app",
          archetype: "http_service",
          layerPolicy: "layered_backend",
          external: false,
          entryFile: "apps/api/src/index.ts",
          targetFramework: null,
          bins: [],
        };
        const setup = (): { model: WorkspaceModel; real: WorkspaceReal } => ({
          model: {
            layers: new Set(),
            inversions: 0,
            contractEndpoints: new Set(),
            fragmentEndpoints: new Set(),
          },
          real: {
            unit,
            nodes: [
              {
                id: unit.id,
                domain: "arch",
                kind: "app",
                role: "service",
                label: unit.name,
                provenance: { file: unit.manifestFile },
                tags: ["typescript"],
                meta: { dir: unit.dir, archetype: unit.archetype },
              },
            ],
            edges: [],
            ast: createEmptyAst(),
            fileSeq: 0,
          },
        });
        fc.modelRun(setup, cmds);
      }),
      { numRuns: 20, seed: 20261124 },
    );
  });
});
