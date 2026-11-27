import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { buildAllDiagrams } from "@repospec/plugin-module-atlas";
import { buildModuleArchitecture } from "@repospec/plugin-module-atlas";
import { renderVisualHtml } from "@repospec/plugin-studio";
import { createEmptyAst, type CanonicalLayer, type LayoutNode, type RepoSpecV4, type SpecEdge, type SpecNode, type UnitDescriptor } from "@repospec/plugin";
import { resolveLayerSemantics } from "@repospec/plugin";
import { computeTopologicalLevels } from "@repospec/plugin-module-atlas";

const LAYER_POOL: Array<{ raw: string; canonical: CanonicalLayer }> = [
  { raw: "routes", canonical: "transport" },
  { raw: "middleware", canonical: "transport" },
  { raw: "controller", canonical: "transport" },
  { raw: "service", canonical: "orchestration" },
  { raw: "dao", canonical: "persistence" },
  { raw: "client", canonical: "integration" },
  { raw: "dto", canonical: "support" },
  { raw: "errors", canonical: "support" },
  { raw: "util", canonical: "support" },
];

function boxesOverlap(a: LayoutNode, b: LayoutNode): boolean {
  const aLeft = a.x - a.w / 2;
  const aRight = a.x + a.w / 2;
  const aTop = a.y - a.h / 2;
  const aBottom = a.y + a.h / 2;
  const bLeft = b.x - b.w / 2;
  const bRight = b.x + b.w / 2;
  const bTop = b.y - b.h / 2;
  const bBottom = b.y + b.h / 2;
  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

const layerGraphArb = fc
  .record({
    layerIndices: fc.uniqueArray(fc.integer({ min: 0, max: LAYER_POOL.length - 1 }), { minLength: 3, maxLength: LAYER_POOL.length }),
    edgePairs: fc.array(
      fc.record({
        fromIdx: fc.integer({ min: 0, max: LAYER_POOL.length - 1 }),
        toIdx: fc.integer({ min: 0, max: LAYER_POOL.length - 1 }),
        weight: fc.integer({ min: 1, max: 60 }),
        violation: fc.boolean(),
      }),
      { minLength: 2, maxLength: 32 },
    ),
    includeStore: fc.boolean(),
  })
  .map(({ layerIndices, edgePairs, includeStore }) => {
    const ownerId = "arch:app:demo-api";
    const nodes: SpecNode[] = [
      {
        id: ownerId,
        domain: "arch",
        kind: "app",
        role: "service",
        label: "demo-api",
        provenance: { file: "apps/demo-api/package.json" },
        tags: ["typescript"],
        meta: { ecosystem: "typescript", archetype: "http_service", dir: "apps/demo-api" },
      },
    ];
    const selectedLayers = layerIndices
      .map((idx) => LAYER_POOL[idx])
      .filter((x): x is { raw: string; canonical: CanonicalLayer } => x !== undefined);
    const layerIds: string[] = [];
    for (const l of selectedLayers) {
      const sem = resolveLayerSemantics(l.raw, l.canonical);
      const id = `arch:layer:demo-api:${l.raw}`;
      layerIds.push(id);
      nodes.push({
        id,
        domain: "arch",
        kind: "code_layer",
        role: "layer",
        label: l.raw,
        group: "demo-api",
        ownerId,
        provenance: { file: `apps/demo-api/src/${l.raw}/index.ts` },
        tags: ["typescript", "layer", l.canonical, sem.axis],
        meta: {
          unit: "demo-api",
          fileCount: 4,
          canonicalLayer: l.canonical,
          layerAxis: sem.axis,
          layerRank: sem.rank,
          laneId: sem.laneId,
          laneLabel: sem.laneLabel,
        },
      });
    }

    const edges: SpecEdge[] = [];
    for (const ep of edgePairs) {
      const fromId = layerIds[ep.fromIdx % layerIds.length];
      const toId = layerIds[ep.toIdx % layerIds.length];
      if (!fromId || !toId || fromId === toId) continue;
      edges.push({
        from: fromId,
        to: toId,
        kind: "imports_layer",
        label: String(ep.weight),
        weight: ep.weight,
        violation: ep.violation,
        confidence: "observed",
      });
    }

    const firstLayerId = layerIds[0];
    if (includeStore && firstLayerId) {
      nodes.push({
        id: "arch:datastore:db",
        domain: "arch",
        kind: "datastore",
        role: "datastore",
        label: "MainDB",
        provenance: { file: "schema.sql" },
        tags: ["datastore"],
        meta: { tableCount: 12 },
      });
      edges.push({
        from: firstLayerId,
        to: "arch:datastore:db",
        kind: "reads_writes",
        label: "12 tables",
        weight: 12,
        confidence: "observed",
      });
    }

    return { nodes, edges };
  });

function reverseCopy<T>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined) out.push(item);
  }
  return out;
}

describe("Layout & renderer geometric invariants (R2 PBT) [REQ-LAYOUT-01] [REQ-RENDER-01]", () => {
  test("buildAllDiagrams is deterministic under input permutation and produces zero overlapping boxes", () => {
    fc.assert(
      fc.property(layerGraphArb, ({ nodes, edges }) => {
        const d1 = buildAllDiagrams(nodes, edges, []);
        const d2 = buildAllDiagrams(reverseCopy(nodes), reverseCopy(edges), []);
        expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));

        for (const diag of d1) {
          const idSet = new Set(diag.nodes.map((n) => n.id));
          for (let i = 0; i < diag.nodes.length; i += 1) {
            const a = diag.nodes[i];
            if (!a) continue;
            expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
            expect(a.w).toBeGreaterThan(0);
            expect(a.h).toBeGreaterThan(0);
            for (let j = i + 1; j < diag.nodes.length; j += 1) {
              const b = diag.nodes[j];
              if (!b) continue;
              expect(boxesOverlap(a, b)).toBe(false);
            }
          }
          for (const e of diag.edges) {
            expect(idSet.has(e.from)).toBe(true);
            expect(idSet.has(e.to)).toBe(true);
            expect(e.points.length).toBeGreaterThanOrEqual(2);
            for (const pt of e.points) {
              expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
            }
            const expectedViolationTier = e.violation ? "violation" : e.tier;
            expect(e.tier).toBe(expectedViolationTier);
          }
        }
      }),
      { numRuns: 35, seed: 424242 },
    );
  });

  test("renderVisualHtml inline output never emits 100vh and compiles valid client JS for arbitrary repo names", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        layerGraphArb,
        (rawName, { nodes, edges }) => {
          const safeName = rawName.trim() || "demo-repo";
          const diagrams = buildAllDiagrams(nodes, edges, []);
          const spec: RepoSpecV4 = {
            schemaVersion: "5.0.0",
            specKind: "repospec.canonical",
            repo: {
              name: safeName,
              ecosystem: "typescript",
              languages: ["typescript"],
              commitSha: "abcdef1234567890",
              branch: "main",
              remote: "https://github.com/org/repo",
              scopeRootRel: ".",
              storageMode: "artifact",
              extractors: ["test"],
            },
            nodes,
            edges,
            rules: [],
            invariants: [],
            entities: [],
            stateMachines: [],
            loops: [],
            catalogArtifacts: [],
            modules: [],
            traces: [],
            surfaces: { endpoints: [], foreignKeys: [], envBindings: [], govRules: [] },
            diagrams,
            verification: {
              totalSourceFiles: 10,
              directlyTestedSourceFiles: 5,
              directTestCoveragePct: 50,
              registeredGates: 1,
              ciWiredGates: 1,
              unwiredGateNames: [],
              invariantsPassed: 1,
              invariantsWarned: 0,
              invariantsFailed: 0,
              invariantsNa: 0,
            },
            diagnostics: [],
            extensions: { facts: [], factEdges: [], metrics: [] },
            summary: {
              totalNodes: nodes.length,
              totalEdges: edges.length,
              totalRules: 0,
              crossDomainEdges: 0,
              countsByDomain: { arch: nodes.length, ci: 0, test: 0, iac: 0, rules: 0 },
              countsByNodeKind: {},
              countsByEdgeKind: {},
              testFilesByRung: {},
              iacByPlane: { network: 0, compute: 0, data: 0, security: 0, observability: 0, messaging: 0, governance: 0, ci_infra: 0 },
              workflowCount: 0,
              ciJobCount: 0,
              indexedSourceFiles: 10,
              indexedImportEdges: edges.length,
              datastoreEntities: 0,
              externalServices: 0,
              stateMachines: 0,
              loops: 0,
              httpEndpoints: 0,
              foreignKeys: 0,
              envBindings: 0,
              govRules: 0,
              docDriftCount: 0,
            },
          };

          const html = renderVisualHtml(spec, "deadbeef", { inline: true });
          expect(html.includes("100vh")).toBe(false);
          const scriptMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);
          const body = scriptMatch?.[1] ?? "";
          expect(body.length).toBeGreaterThan(200);
          expect(() => new Function(body)).not.toThrow();
        },
      ),
      { numRuns: 20, seed: 1337 },
    );
  });

  test("computeTopologicalLevels enforces strict DAG monotonicity outside Tarjan tangles and deterministic module diagrams", () => {
    const modGraphArb = fc
      .record({
        n: fc.integer({ min: 3, max: 12 }),
        rawEdges: fc.array(
          fc.record({
            from: fc.integer({ min: 0, max: 11 }),
            to: fc.integer({ min: 0, max: 11 }),
          }),
          { minLength: 2, maxLength: 28 },
        ),
      })
      .map(({ n, rawEdges }) => {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`);
        const edges = rawEdges
          .map((e) => ({ from: `m${e.from % n}`, to: `m${e.to % n}` }))
          .filter((e) => e.from !== e.to);
        return { ids, edges };
      });

    fc.assert(
      fc.property(modGraphArb, ({ ids, edges }) => {
        const res1 = computeTopologicalLevels(ids, edges);
        const res2 = computeTopologicalLevels(reverseCopy(ids), reverseCopy(edges));
        expect(Array.from(res1.levels.entries())).toEqual(Array.from(res2.levels.entries()));
        expect(Array.from(res1.inTangle.entries())).toEqual(Array.from(res2.inTangle.entries()));

        for (const e of edges) {
          const tf = res1.inTangle.get(e.from);
          const tt = res1.inTangle.get(e.to);
          const lf = res1.levels.get(e.from) ?? 0;
          const lt = res1.levels.get(e.to) ?? 0;
          const sameTangle = Boolean(tf && tf === tt);
          expect(sameTangle ? lf === lt : lf < lt).toBe(true);
        }

        const unit: UnitDescriptor = {
          id: "arch:app:demo",
          name: "demo",
          slug: "demo",
          dir: ".",
          absDir: "/tmp/demo",
          manifestFile: "package.json",
          ecosystem: "typescript",
          kind: "app",
          archetype: "cli_worker",
          layerPolicy: "flat_library",
          external: false,
          entryFile: "src/m0.ts",
          targetFramework: null,
          bins: [],
        };
        const ast = createEmptyAst();
        for (const id of ids) {
          ast.files.push({
            file: `src/${id}.ts`,
            unit: "demo",
            language: "typescript",
            layer: "root",
            canonicalLayer: "unclassified",
            domainArea: null,
            layerSource: "path_convention",
            domainSource: "none",
            isTest: false,
            isBarrel: false,
            lines: 60,
            exportsCount: 2,
            exportedSymbols: [{ name: `run_${id}`, kind: "function", file: `src/${id}.ts`, line: 1 }],
            capabilities: ["PURE"],
          });
        }
        for (const e of edges) {
          ast.fileImports.push({
            fromFile: `src/${e.from}.ts`,
            toFile: `src/${e.to}.ts`,
            fromUnit: "demo",
            toUnit: "demo",
            fromLayer: "root",
            toLayer: "root",
            fromCanonicalLayer: "unclassified",
            toCanonicalLayer: "unclassified",
            fromDomain: null,
            toDomain: null,
            line: 1,
            typeOnly: false,
          });
        }
        const arch = buildModuleArchitecture({ units: [unit], ast });
        expect(arch.modules.length).toBe(ids.length);
        for (const diag of arch.diagrams) {
          for (let i = 0; i < diag.nodes.length; i += 1) {
            for (let j = i + 1; j < diag.nodes.length; j += 1) {
              const a = diag.nodes[i];
              const b = diag.nodes[j];
              expect(Boolean(a && b && boxesOverlap(a, b))).toBe(false);
            }
          }
        }
      }),
      { numRuns: 40, seed: 50505 },
    );
  });
});
