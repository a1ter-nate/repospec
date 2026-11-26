import path from "node:path";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { diffFactSets, queryFactsFromDb } from "@repospec/core";
import { ejectJellywareTarget, parseEjectTarget } from "@repospec/core/eject";
import { serializeSpec } from "../canonicalize.ts";
import { runCommitDiffWorktrees } from "../studio/diffRunner.ts";
import { CliUsageError } from "./errors.ts";
import { generateRepoSpecEffect, runGenerateRepoSpec } from "./pipeline.ts";
import { RepoFs, SqliteIndexService } from "./services.ts";

const printJson = (value: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(value, null, 2));
  });

export const scanCmd = Command.make(
  "scan",
  {
    repoDir: Argument.withDefault(Argument.String("repoDir"), "."),
    out: Flag.optional(Flag.String("out")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const repoFs = yield* RepoFs;
      const absRepo = path.resolve(cfg.repoDir);
      const outDir = path.resolve(
        Option.getOrUndefined(cfg.out) ?? path.join(absRepo, ".repospec"),
      );
      yield* repoFs.mkdir(outDir);
      const sqliteOut = path.join(outDir, "repospec.sqlite");
      const specOut = path.join(outDir, "repospec.json");
      const { spec, digest } = yield* generateRepoSpecEffect(absRepo, "artifact", sqliteOut);
      yield* repoFs.writeText(specOut, serializeSpec(spec));
      yield* printJson({
        repo: spec.repo.name,
        digest,
        factsCount: spec.extensions.facts.length,
        metricsCount: spec.extensions.metrics.length,
        extractors: spec.repo.extractors,
        artifacts: {
          spec: specOut,
          sqlite: sqliteOut,
        },
      });
    }),
).pipe(Command.withDescription("Run kernel scan + storage primitives only (IR + SQLite + custom facts, zero HTML UI)."));

export const factsCmd = Command.make(
  "facts",
  {
    target: Argument.withDefault(Argument.String("dbOrRepo"), "."),
    kind: Flag.optional(Flag.String("kind")),
    file: Flag.optional(Flag.String("file")),
    diff: Flag.optional(Flag.String("diff")),
    limit: Flag.withDefault(Flag.Int("limit"), 500),
  },
  (cfg) =>
    Effect.gen(function* () {
      const kind = Option.getOrUndefined(cfg.kind);
      const file = Option.getOrUndefined(cfg.file);
      const diffRange = Option.getOrUndefined(cfg.diff);

      if (diffRange) {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const tmpDb = path.join(path.resolve(cfg.target), ".repospec-facts-diff.sqlite");
            const { base, head } = await runCommitDiffWorktrees({
              repoDir: cfg.target,
              rangeArg: diffRange,
              headSqliteOut: tmpDb,
              generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
            });
            return diffFactSets(base.spec.extensions.facts, head.spec.extensions.facts, kind);
          },
          catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
        });
        yield* printJson(result);
        return;
      }

      if (cfg.target.endsWith(".sqlite")) {
        const sqlite = yield* SqliteIndexService;
        const rows = yield* sqlite.withReadonlyDb(cfg.target, (db) =>
          Effect.sync(() => queryFactsFromDb(db, { kind, file, limit: cfg.limit })),
        );
        yield* printJson(rows);
        return;
      }

      const repoFs = yield* RepoFs;
      const facts = yield* Effect.scoped(
        Effect.gen(function* () {
          const tmpDir = yield* repoFs.withTempDir("repospec-facts-");
          const { spec } = yield* generateRepoSpecEffect(cfg.target, "artifact", path.join(tmpDir, "facts.sqlite"));
          return spec.extensions.facts.filter(
            (f) => (!kind || f.kind === kind) && (!file || f.file === file),
          ).slice(0, cfg.limit);
        }),
      );
      yield* printJson(facts);
    }),
).pipe(Command.withDescription("Query or diff extracted custom facts from repospec.sqlite or a repository."));

export const ejectCmd = Command.make(
  "eject",
  {
    target: Argument.String("target"),
    repoDir: Argument.withDefault(Argument.String("repoDir"), "."),
    force: Flag.withDefault(Flag.Boolean("force"), false),
  },
  (cfg) =>
    Effect.gen(function* () {
      const parsed = parseEjectTarget(cfg.target);
      if (!parsed) {
        return yield* Effect.fail(
          new CliUsageError({
            message: "Invalid eject target. Choose one of: show-me, report, ci, extractor, facts, rule, all.",
          }),
        );
      }
      const res = ejectJellywareTarget(cfg.repoDir, parsed, cfg.force);
      yield* printJson(res);
    }),
).pipe(Command.withDescription("Scaffold editable jellyware overrides or custom extractors into .repospec/."));
