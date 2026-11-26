import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { buildCanonicalSpec, diffSpecs, hashSpec, mergeFragments } from "../canonicalize.ts";
import { discoverRepo } from "../discover.ts";
import { buildCrossDomainLinks } from "../extractors/crossLink.ts";
import { projectInvariantsToGraph } from "../indexDb.ts";
import { evaluateCiGates, type CiDefinition } from "../../packages/ci/src/index.ts";
import { loadRepoExtensions, type LoadedRepoExtensions } from "../../packages/core/src/facts.ts";
import { buildVerificationScopeSummary } from "../internal/coverage.ts";
import { buildAllDiagrams, buildStaticTraces, resolveEvidenceAnchors } from "../layout.ts";
import { buildModuleArchitecture } from "../moduleGraph.ts";
import { decodeRepoSpecEffect, type RepoSpecV4, type StorageMode } from "../schema.ts";
import { generateIdsModule, generateSqliteSdkModule } from "../sdkGen.ts";
import { buildDrilldownIndex, type DrilldownIndex } from "../studio/drilldown.ts";
import { RepoDiscoveryError, type SchemaValidationError, type SqliteIndexError } from "./errors.ts";
import {
  CoverageService,
  ExtractorRegistry,
  RepoFs,
  RepospecLive,
  SqliteIndexService,
} from "./services.ts";

const RULES_DIR = path.resolve(import.meta.dir, "../../rules");

export interface GenerateResult {
  readonly spec: RepoSpecV4;
  readonly digest: string;
  readonly idsModule: string;
  readonly sdkModule: string;
  readonly dbPath: string;
  readonly drilldown: DrilldownIndex;
  readonly repoExtensions: LoadedRepoExtensions;
}

export const generateRepoSpecEffect = Effect.fn("repospec.generate")(function* (
  repoDir: string,
  storageMode: StorageMode = "artifact",
  dbOutPath?: string,
) {
  const extractors = yield* ExtractorRegistry;
  const coverageSvc = yield* CoverageService;
  const sqliteSvc = yield* SqliteIndexService;

  const ctx = yield* Effect.try({
    try: () => discoverRepo(repoDir, storageMode),
    catch: (err) =>
      new RepoDiscoveryError({
        rootDir: repoDir,
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const repoExtensions = yield* Effect.tryPromise({
    try: () => loadRepoExtensions(ctx.rootDir),
    catch: () =>
      new RepoDiscoveryError({
        rootDir: ctx.rootDir,
        message: "Failed to load .repospec extensions",
      }),
  });

  const fragments = yield* extractors.runAll(ctx, repoExtensions.extractors);
  const crossFragment = buildCrossDomainLinks(ctx, fragments);
  const merged = mergeFragments([...fragments, crossFragment]);
  if (repoExtensions.diagnostics.length > 0) {
    merged.diagnostics.push(...repoExtensions.diagnostics);
  }

  const targetDbPath =
    dbOutPath ??
    path.join(os.tmpdir(), `repospec-${process.pid}-${ctx.repoName.replace(/[^a-zA-Z0-9_-]/g, "_")}.sqlite`);

  const moduleArch = buildModuleArchitecture({ units: ctx.units, ast: merged.ast });
  const realCoverage = yield* coverageSvc.discover(ctx.rootDir);

  const evalResult = yield* sqliteSvc.buildAndEvaluate({
    dbPath: targetDbPath,
    rulesDir: RULES_DIR,
    extraRulesDirs: repoExtensions.extraRulesDirs,
    repoName: ctx.repoName,
    commitSha: ctx.commitSha,
    scopeRootRel: ctx.scopeRootRel,
    units: ctx.units,
    nodes: merged.nodes,
    edges: merged.edges,
    rules: merged.rules,
    ast: merged.ast,
    stateMachines: merged.stateMachines,
    loops: merged.loops,
    catalogArtifacts: merged.catalogArtifacts,
    modules: moduleArch.modules,
    realCoverage,
    diagnostics: merged.diagnostics,
    facts: merged.facts,
    factEdges: merged.factEdges,
    metrics: merged.metrics,
  });

  const projected = projectInvariantsToGraph(merged.nodes, merged.edges, evalResult.invariants);
  const diagrams = buildAllDiagrams(projected.nodes, projected.edges, merged.stateMachines, moduleArch.diagrams);
  const anchoredInvariants = resolveEvidenceAnchors(evalResult.invariants, diagrams);
  const traces = buildStaticTraces(diagrams);

  const rawSpec = buildCanonicalSpec({
    ctx,
    extractorIds: [
      ...extractors.plugins.map((e) => e.id),
      ...repoExtensions.extractors.map((e) => e.id),
      "cross-domain.linker.v4",
      "module-graph.v5",
      "sqlite.invariants.v4",
    ],
    nodes: projected.nodes,
    edges: projected.edges,
    rules: merged.rules,
    ast: merged.ast,
    invariants: anchoredInvariants,
    entities: evalResult.entities,
    stateMachines: merged.stateMachines,
    loops: merged.loops,
    catalogArtifacts: merged.catalogArtifacts,
    modules: moduleArch.modules,
    traces,
    surfaces: evalResult.surfaces,
    diagrams,
    verification: evalResult.verification,
    diagnostics: merged.diagnostics,
    facts: merged.facts,
    factEdges: merged.factEdges,
    metrics: merged.metrics,
  });

  const spec = yield* decodeRepoSpecEffect(rawSpec);
  const digest = hashSpec(spec);
  yield* sqliteSvc.storeDigest(targetDbPath, digest);
  const idsModule = generateIdsModule(spec, digest);
  const sdkModule = generateSqliteSdkModule();
  const drilldown = buildDrilldownIndex(ctx.units, merged.ast, ctx.rootDir, realCoverage);

  return {
    spec,
    digest,
    idsModule,
    sdkModule,
    dbPath: targetDbPath,
    drilldown,
    repoExtensions,
  } satisfies GenerateResult;
});

export const checkRepoSpecEffect = Effect.fn("repospec.check")(function* (params: {
  readonly repoDir: string;
  readonly specPath?: string;
  readonly allowFail: boolean;
}) {
  const repoFs = yield* RepoFs;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const tmpDir = yield* repoFs.withTempDir("repospec-check-");
      const tmpDb = path.join(tmpDir, "check.sqlite");
      const { spec, digest, repoExtensions } = yield* generateRepoSpecEffect(params.repoDir, "artifact", tmpDb);
      let drifted = false;
      if (params.specPath) {
        const absSpec = path.resolve(params.specPath);
        if (yield* repoFs.exists(absSpec)) {
          const text = yield* repoFs.readText(absSpec);
          const committed = yield* decodeRepoSpecEffect(JSON.parse(text));
          drifted = hashSpec(committed) !== digest;
        }
      }
      const ciDef =
        repoExtensions.ciOverride && typeof repoExtensions.ciOverride === "object"
          ? (repoExtensions.ciOverride as CiDefinition)
          : null;
      const customCi = evaluateCiGates({ spec, digest }, ciDef);
      const failedInvariants = spec.invariants.filter((i) => i.status === "fail");
      const errorDiagnostics = spec.diagnostics.filter((d) => d.severity === "error");
      const ok =
        !drifted &&
        errorDiagnostics.length === 0 &&
        (params.allowFail || (failedInvariants.length === 0 && customCi.ok));
      return {
        ok,
        drifted,
        digest,
        errorDiagnostics,
        failedInvariants: failedInvariants.map((i) => ({ id: i.id, name: i.name, count: i.violationCount })),
        customGates: customCi.results,
        scopeSummary: buildVerificationScopeSummary(spec.verification),
        verification: spec.verification,
      };
    }),
  );
});

export const validateSpecFileEffect = Effect.fn("repospec.validate")(function* (
  specPath: string,
): Effect.fn.Return<
  {
    valid: true;
    repo: string;
    ecosystem: string;
    schemaVersion: string;
    digest: string;
    verification: RepoSpecV4["verification"];
    summary: RepoSpecV4["summary"];
  },
  RepoDiscoveryError | SchemaValidationError,
  RepoFs
> {
  const repoFs = yield* RepoFs;
  const text = yield* repoFs.readText(path.resolve(specPath));
  const parsed = yield* decodeRepoSpecEffect(JSON.parse(text));
  return {
    valid: true,
    repo: parsed.repo.name,
    ecosystem: parsed.repo.ecosystem,
    schemaVersion: parsed.schemaVersion,
    digest: hashSpec(parsed),
    verification: parsed.verification,
    summary: parsed.summary,
  };
});

export const diffSpecFilesEffect = Effect.fn("repospec.diff")(function* (
  basePath: string,
  headPath: string,
) {
  const repoFs = yield* RepoFs;
  const [baseText, headText] = yield* Effect.all([
    repoFs.readText(path.resolve(basePath)),
    repoFs.readText(path.resolve(headPath)),
  ]);
  const [base, head] = yield* Effect.all([
    decodeRepoSpecEffect(JSON.parse(baseText)),
    decodeRepoSpecEffect(JSON.parse(headText)),
  ]);
  return diffSpecs(base, head);
});

export function runGenerateRepoSpec(
  repoDir: string,
  storageMode: StorageMode = "artifact",
  dbOutPath?: string,
): Promise<GenerateResult> {
  return Effect.runPromise(
    generateRepoSpecEffect(repoDir, storageMode, dbOutPath).pipe(
      Effect.provide(RepospecLive),
    ) as Effect.Effect<GenerateResult, RepoDiscoveryError | SchemaValidationError | SqliteIndexError, never>,
  );
}
