import path from "node:path";
import {
  decodeRepoSpecEffect,
  RepoDiscoveryError,
  type DrilldownIndex,
  type RepoSpecV4,
  type SchemaValidationError,
  type SqliteIndexError,
  type StorageMode,
} from "@repospec/plugin";
import { Effect } from "effect";
import { diffSpecs, hashSpec } from "../canonicalize.ts";
import type { LoadedRepoExtensions } from "../internal/loader.ts";
import { checkWithDomains, getDefaultDomains, scanWithDomains } from "../plugin/host.ts";
import { CoverageService, ExtractorRegistry, RepoFs, RepospecLive } from "./services.ts";

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
  const domains = yield* Effect.promise(() => getDefaultDomains());

  return yield* Effect.tryPromise({
    try: () =>
      scanWithDomains(
        domains,
        repoDir,
        { dbPath: dbOutPath, storageMode },
        {
          runExtractors: async (ctx, extra) => {
            const fragments = await Effect.runPromise(extractors.runAll(ctx, extra));
            const ids =
              extractors.plugins.length > 0
                ? [...extractors.plugins.map((e) => e.id), ...extra.map((e) => e.id)]
                : [...domains.extractor.get().map((e) => e.id), ...extra.map((e) => e.id)];
            return { fragments, ids };
          },
          discoverCoverage: (rootDir) => Effect.runPromise(coverageSvc.discover(rootDir)),
        },
      ),
    catch: (err) =>
      new RepoDiscoveryError({
        rootDir: repoDir,
        message: err instanceof Error ? err.message : String(err),
      }),
  });
});

export const checkRepoSpecEffect = Effect.fn("repospec.check")(function* (params: {
  readonly repoDir: string;
  readonly specPath?: string;
  readonly allowFail: boolean;
}) {
  const domains = yield* Effect.promise(() => getDefaultDomains());
  return yield* Effect.tryPromise({
    try: () => checkWithDomains(domains, params.repoDir, { specPath: params.specPath, allowFail: params.allowFail }),
    catch: (err) =>
      new RepoDiscoveryError({
        rootDir: params.repoDir,
        message: err instanceof Error ? err.message : String(err),
      }),
  });
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
  const [baseText, headText] = yield* Effect.all(
    [repoFs.readText(path.resolve(basePath)), repoFs.readText(path.resolve(headPath))],
    { concurrency: 2 },
  );
  const [base, head] = yield* Effect.all(
    [decodeRepoSpecEffect(JSON.parse(baseText)), decodeRepoSpecEffect(JSON.parse(headText))],
    { concurrency: 2 },
  );
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
