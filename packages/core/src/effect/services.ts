import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverRealCoverageReport,
  GitCommandError,
  RepoDiscoveryError,
  SqliteIndexError,
  type AstIndexData,
  type CatalogArtifact,
  type EntityOwnership,
  type EnvBindingSummary,
  type ExtractorPlugin,
  type FactEdgeRecord,
  type FactRecord,
  type ForeignKeySummary,
  type GovRuleSummary,
  type GraphFragment,
  type HttpEndpointSummary,
  type LoopRecord,
  type MetricRecord,
  type ModuleCard,
  type RealCoverageReport,
  type RepoContext,
  type SpecDiagnostic,
  type SpecEdge,
  type SpecNode,
  type SpecRule,
  type SqlInvariantResult,
  type StateMachineRecord,
  type UnitDescriptor,
  type VerificationCoverage,
} from "@repospec/plugin";
import { Context, Effect, Layer, Scope } from "effect";
import {
  createAndPopulateIndexDb,
  queryEntityOwnership,
  querySurfaces,
  queryVerificationCoverage,
  runSqlInvariants,
  storeDigestInDb,
} from "../indexDb.ts";
import { getDefaultDomains } from "../plugin/host.ts";

export interface RepoFsShape {
  readonly readText: (absPath: string) => Effect.Effect<string, RepoDiscoveryError>;
  readonly writeText: (absPath: string, content: string) => Effect.Effect<void, RepoDiscoveryError>;
  readonly exists: (absPath: string) => Effect.Effect<boolean>;
  readonly mkdir: (absPath: string) => Effect.Effect<void, RepoDiscoveryError>;
  readonly withTempDir: (prefix: string) => Effect.Effect<string, RepoDiscoveryError, Scope.Scope>;
}

export class RepoFs extends Context.Service<RepoFs, RepoFsShape>()("@repospec/RepoFs") {}

export interface GitServiceShape {
  readonly run: (cwd: string, args: readonly string[]) => Effect.Effect<string, GitCommandError>;
  readonly withWorktree: (
    repoDir: string,
    gitRef: string,
    prefix: string,
  ) => Effect.Effect<string, GitCommandError, Scope.Scope>;
}

export class GitService extends Context.Service<GitService, GitServiceShape>()("@repospec/GitService") {}

export interface CoverageServiceShape {
  readonly discover: (rootDir: string) => Effect.Effect<RealCoverageReport | null>;
}

export class CoverageService extends Context.Service<CoverageService, CoverageServiceShape>()(
  "@repospec/CoverageService",
) {}

export interface IndexDbEvaluation {
  readonly invariants: SqlInvariantResult[];
  readonly entities: EntityOwnership[];
  readonly surfaces: {
    endpoints: HttpEndpointSummary[];
    foreignKeys: ForeignKeySummary[];
    envBindings: EnvBindingSummary[];
    govRules: GovRuleSummary[];
    docDriftCount: number;
  };
  readonly verification: VerificationCoverage;
}

export interface SqliteIndexServiceShape {
  readonly buildAndEvaluate: (params: {
    dbPath: string;
    rulesDir: string;
    extraRulesDirs?: readonly string[];
    repoName: string;
    commitSha: string | null;
    scopeRootRel: string;
    units: UnitDescriptor[];
    nodes: SpecNode[];
    edges: SpecEdge[];
    rules: SpecRule[];
    ast: AstIndexData;
    stateMachines: StateMachineRecord[];
    loops: LoopRecord[];
    catalogArtifacts: CatalogArtifact[];
    modules: ModuleCard[];
    realCoverage: RealCoverageReport | null;
    diagnostics: SpecDiagnostic[];
    facts?: FactRecord[];
    factEdges?: FactEdgeRecord[];
    metrics?: MetricRecord[];
  }) => Effect.Effect<IndexDbEvaluation, SqliteIndexError>;
  readonly storeDigest: (dbPath: string, digest: string) => Effect.Effect<void, SqliteIndexError>;
  readonly withReadonlyDb: <A, E>(
    dbPath: string,
    use: (db: Database) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | SqliteIndexError>;
}

export class SqliteIndexService extends Context.Service<SqliteIndexService, SqliteIndexServiceShape>()(
  "@repospec/SqliteIndexService",
) {}

export interface ExtractorRegistryShape {
  readonly plugins: readonly ExtractorPlugin[];
  readonly runAll: (ctx: RepoContext, extraPlugins?: readonly ExtractorPlugin[]) => Effect.Effect<GraphFragment[]>;
}

export class ExtractorRegistry extends Context.Service<ExtractorRegistry, ExtractorRegistryShape>()(
  "@repospec/ExtractorRegistry",
) {}

const RepoFsLive = Layer.succeed(RepoFs, {
  readText: (absPath) =>
    Effect.try({
      try: () => fs.readFileSync(absPath, "utf8"),
      catch: (err) =>
        new RepoDiscoveryError({
          rootDir: absPath,
          message: err instanceof Error ? err.message : String(err),
        }),
    }),
  writeText: (absPath, content) =>
    Effect.try({
      try: () => {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, "utf8");
      },
      catch: (err) =>
        new RepoDiscoveryError({
          rootDir: absPath,
          message: err instanceof Error ? err.message : String(err),
        }),
    }),
  exists: (absPath) => Effect.sync(() => fs.existsSync(absPath)),
  mkdir: (absPath) =>
    Effect.try({
      try: () => {
        fs.mkdirSync(absPath, { recursive: true });
      },
      catch: (err) =>
        new RepoDiscoveryError({
          rootDir: absPath,
          message: err instanceof Error ? err.message : String(err),
        }),
    }),
  withTempDir: (prefix) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
        catch: (err) =>
          new RepoDiscoveryError({
            rootDir: os.tmpdir(),
            message: err instanceof Error ? err.message : String(err),
          }),
      }),
      (dir) =>
        Effect.sync(() => {
          fs.rmSync(dir, { recursive: true, force: true });
        }),
    ),
});

const GitServiceLive = Layer.succeed(GitService, {
  run: (cwd, args) =>
    Effect.try({
      try: () =>
        execFileSync("git", [...args], {
          cwd,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        }).trim(),
      catch: (err) =>
        new GitCommandError({
          args,
          cwd,
          message: err instanceof Error ? err.message : String(err),
        }),
    }),
  withWorktree: (repoDir, gitRef, prefix) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
          execFileSync("git", ["worktree", "add", "--detach", dir, gitRef], {
            cwd: repoDir,
            stdio: ["ignore", "ignore", "pipe"],
          });
          return dir;
        },
        catch: (err) =>
          new GitCommandError({
            args: ["worktree", "add", "--detach", gitRef],
            cwd: repoDir,
            message: err instanceof Error ? err.message : String(err),
          }),
      }),
      (wtDir) =>
        Effect.sync(() => {
          try {
            execFileSync("git", ["worktree", "remove", "--force", wtDir], {
              cwd: repoDir,
              stdio: "ignore",
            });
          } catch {
            fs.rmSync(wtDir, { recursive: true, force: true });
          }
        }),
    ),
});

const CoverageServiceLive = Layer.succeed(CoverageService, {
  discover: (rootDir) => Effect.sync(() => discoverRealCoverageReport(rootDir)),
});

const SqliteIndexServiceLive = Layer.succeed(SqliteIndexService, {
  buildAndEvaluate: (params) =>
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              createAndPopulateIndexDb({
                dbPath: params.dbPath,
                repoName: params.repoName,
                commitSha: params.commitSha,
                scopeRootRel: params.scopeRootRel,
                units: params.units,
                nodes: params.nodes,
                edges: params.edges,
                rules: params.rules,
                ast: params.ast,
                stateMachines: params.stateMachines,
                loops: params.loops,
                catalogArtifacts: params.catalogArtifacts,
                modules: params.modules,
                realCoverage: params.realCoverage,
                facts: params.facts,
                factEdges: params.factEdges,
                metrics: params.metrics,
              }),
            catch: (err) =>
              new SqliteIndexError({
                operation: "createAndPopulateIndexDb",
                message: err instanceof Error ? err.message : String(err),
              }),
          }),
          (handle) =>
            Effect.sync(() => {
              handle.close();
            }),
        );
        return yield* Effect.try({
          try: () => {
            const invariants = runSqlInvariants(db, params.rulesDir, params.diagnostics, params.extraRulesDirs ?? []);
            const entities = queryEntityOwnership(db);
            const surfaces = querySurfaces(db);
            const verification = queryVerificationCoverage(db, invariants, params.realCoverage);
            return { invariants, entities, surfaces, verification };
          },
          catch: (err) =>
            new SqliteIndexError({
              operation: "evaluateInvariants",
              message: err instanceof Error ? err.message : String(err),
            }),
        });
      }),
    ),
  storeDigest: (dbPath, digest) =>
    Effect.try({
      try: () => storeDigestInDb(dbPath, digest),
      catch: (err) =>
        new SqliteIndexError({
          operation: "storeDigest",
          message: err instanceof Error ? err.message : String(err),
        }),
    }),
  withReadonlyDb: (dbPath, use) =>
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () => new Database(path.resolve(dbPath), { readonly: true }),
            catch: (err) =>
              new SqliteIndexError({
                operation: "openReadonly",
                message: err instanceof Error ? err.message : String(err),
              }),
          }),
          (handle) =>
            Effect.sync(() => {
              handle.close();
            }),
        );
        return yield* use(db);
      }),
    ),
});

const ExtractorRegistryLive = Layer.succeed(ExtractorRegistry, {
  plugins: [],
  runAll: (ctx, extraPlugins) =>
    Effect.promise(async () => {
      const domains = await getDefaultDomains();
      const builtinExtractors: ExtractorPlugin[] = domains.extractor.get().map((e) => ({
        id: e.id,
        domain: e.domain ?? "arch",
        extract: (repoCtx) => Promise.resolve(e.extract(repoCtx)),
      }));
      const list = extraPlugins && extraPlugins.length > 0 ? [...builtinExtractors, ...extraPlugins] : builtinExtractors;
      return Promise.all(
        list.map(async (plugin): Promise<GraphFragment> => {
          try {
            return await plugin.extract(ctx);
          } catch (err) {
            return {
              nodes: [],
              edges: [],
              rules: [],
              diagnostics: [
                {
                  code: `extractor.failed.${plugin.id}`,
                  severity: "warn",
                  message: `Extractor ${plugin.id} failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
            };
          }
        }),
      );
    }),
});

export const RepospecLive = Layer.mergeAll(
  RepoFsLive,
  GitServiceLive,
  CoverageServiceLive,
  SqliteIndexServiceLive,
  ExtractorRegistryLive,
);
