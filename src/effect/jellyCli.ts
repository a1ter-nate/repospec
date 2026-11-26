import path from "node:path";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { diffFactSets, queryFactsFromDb } from "../../packages/core/src/facts.ts";
import { ejectJellywareTarget, parseEjectTarget } from "../../packages/core/src/eject.ts";
import { analyzeRepoFlows } from "../../packages/flows/src/index.ts";
import { renderFlowsHtmlReport } from "../../packages/flows/src/svg.ts";
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

export const flowsCmd = Command.make(
  "flows",
  {
    repoDir: Argument.withDefault(Argument.String("repoDir"), "."),
    out: Flag.optional(Flag.String("out")),
    traces: Flag.optional(Flag.String("traces")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const repoFs = yield* RepoFs;
      const absRepo = path.resolve(cfg.repoDir);
      const tracesPath = Option.getOrUndefined(cfg.traces);
      const bundle = analyzeRepoFlows(absRepo, tracesPath ? { telemetryPath: path.resolve(tracesPath) } : undefined);
      const outDirOpt = Option.getOrUndefined(cfg.out);
      let htmlOut: string | null = null;
      let jsonOut: string | null = null;
      if (outDirOpt) {
        const outDir = path.resolve(outDirOpt);
        yield* repoFs.mkdir(outDir);
        htmlOut = path.join(outDir, "flows.html");
        jsonOut = path.join(outDir, "flows.json");
        yield* repoFs.writeText(jsonOut, JSON.stringify(bundle, null, 2));
        yield* repoFs.writeText(htmlOut, renderFlowsHtmlReport(bundle, `RepoSpec Flows · ${path.basename(absRepo)}`));
      }
      yield* printJson({
        repo: path.basename(absRepo),
        workFlowsCount: bundle.workFlows.length,
        entityLifecyclesCount: bundle.entityLifecycles.length,
        stateMachinesCount: bundle.stateMachines.length,
        asyncHandoffsCount: bundle.asyncHandoffs.length,
        hazardsCount: bundle.hazards.length,
        topFlows: bundle.workFlows.slice(0, 10).map((f) => ({
          id: f.id,
          name: f.name,
          file: f.file,
          line: f.line,
          serialAwaitCount: f.serialAwaitCount,
          hazards: f.hazards.map((h) => h.kind),
          telemetry: f.telemetry ?? null,
        })),
        artifacts: htmlOut && jsonOut ? { html: htmlOut, json: jsonOut } : null,
      });
    }),
).pipe(Command.withDescription("Analyze ordered work flows, data lifecycles, state machines, async handoffs, and DDIA hazards."));
