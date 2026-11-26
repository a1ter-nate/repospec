import path from "node:path";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { runAggregateCommand, runDiffViewCommand, runServeCommand, runTimelineCommand } from "../ai/cliCommands.ts";
import { serializeSpec } from "../canonicalize.ts";
import { buildArchTimeline, type ArchTimelineData } from "../extractors/gitMetrics.ts";
import { NAMED_QUERIES } from "../indexDb.ts";
import {
  buildFilePassport,
  buildImpactReport,
  buildPrecedentsReport,
  buildUnitPassport,
  formatImpactAsGithubMarkdown,
} from "../passport.ts";
import { renderVisualHtml } from "../render.ts";
import { buildRepoSpecJsonSchema, type StorageMode } from "../schema.ts";
import type { CommitArchDiff } from "../studio/commitDiff.ts";
import { runCommitDiffWorktrees } from "../studio/diffRunner.ts";
import { CliUsageError } from "./errors.ts";
import {
  checkRepoSpecEffect,
  diffSpecFilesEffect,
  generateRepoSpecEffect,
  runGenerateRepoSpec,
  validateSpecFileEffect,
} from "./pipeline.ts";
import { RepoFs, SqliteIndexService } from "./services.ts";

const printJson = (value: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(value, null, 2));
  });

const schemaCmd = Command.make("schema", {}, () => printJson(buildRepoSpecJsonSchema())).pipe(
  Command.withDescription("Emit the RepoSpec v5.0.0 Draft 2020-12 JSON Schema."),
);

const explainCmd = Command.make(
  "explain",
  {
    subject: Argument.String("path-or-unit"),
    db: Flag.String("db"),
  },
  (cfg) =>
    Effect.gen(function* () {
      const sqlite = yield* SqliteIndexService;
      const result = yield* sqlite.withReadonlyDb(cfg.db, (db) =>
        Effect.sync(() => {
          const looksLikeFile = cfg.subject.includes("/") || /\.[a-zA-Z0-9]+$/.test(cfg.subject);
          return looksLikeFile ? buildFilePassport(db, cfg.subject) : buildUnitPassport(db, cfg.subject);
        }),
      );
      yield* printJson(result);
      if ("found" in result) {
        return yield* Effect.fail(new CliUsageError({ message: `Not found: ${cfg.subject}` }));
      }
    }),
).pipe(Command.withDescription("Explain a file or unit passport from repospec.sqlite."));

const impactCmd = Command.make(
  "impact",
  {
    range: Argument.String("range"),
    db: Flag.String("db"),
    repo: Flag.withDefault(Flag.String("repo"), "."),
    format: Flag.withDefault(Flag.String("format"), "json"),
  },
  (cfg) =>
    Effect.gen(function* () {
      const sqlite = yield* SqliteIndexService;
      const report = yield* sqlite.withReadonlyDb(cfg.db, (db) =>
        Effect.sync(() => buildImpactReport(db, path.resolve(cfg.repo), cfg.range)),
      );
      if (cfg.format === "github") {
        yield* Effect.sync(() => console.log(formatImpactAsGithubMarkdown(report)));
      } else {
        yield* printJson(report);
      }
    }),
).pipe(Command.withDescription("Compute blast-radius impact for a git diff range."));

const precedentsCmd = Command.make(
  "precedents",
  {
    db: Flag.String("db"),
    path: Flag.optional(Flag.String("path")),
    intent: Flag.optional(Flag.String("intent")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const targetPath = Option.getOrUndefined(cfg.path);
      const intent = Option.getOrUndefined(cfg.intent);
      if (!targetPath && !intent) {
        return yield* Effect.fail(
          new CliUsageError({ message: "Provide --path <relpath> or --intent <text>." }),
        );
      }
      const sqlite = yield* SqliteIndexService;
      const report = yield* sqlite.withReadonlyDb(cfg.db, (db) =>
        Effect.sync(() => buildPrecedentsReport(db, { path: targetPath, intent })),
      );
      yield* printJson(report);
    }),
).pipe(Command.withDescription("Find architectural precedents by path or intent."));

const queryCmd = Command.make(
  "query",
  {
    dbFile: Argument.String("db"),
    sql: Argument.optional(Argument.String("sql")),
    named: Flag.optional(Flag.String("named")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const namedKey = Option.getOrUndefined(cfg.named);
      const sqlText = namedKey ? NAMED_QUERIES[namedKey] : Option.getOrUndefined(cfg.sql);
      if (!sqlText) {
        return yield* Effect.fail(
          new CliUsageError({
            message: `Provide --named ${Object.keys(NAMED_QUERIES).join("|")} or a SQL string.`,
          }),
        );
      }
      const sqlite = yield* SqliteIndexService;
      const rows = yield* sqlite.withReadonlyDb(cfg.dbFile, (db) => Effect.sync(() => db.query(sqlText).all()));
      yield* printJson(rows);
    }),
).pipe(Command.withDescription("Run a named or ad-hoc read-only SQL query on repospec.sqlite."));

const validateCmd = Command.make("validate", { specPath: Argument.String("spec") }, (cfg) =>
  validateSpecFileEffect(cfg.specPath).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Validate a repospec.json file against Effect Schema."));

const checkCmd = Command.make(
  "check",
  {
    repoDir: Argument.withDefault(Argument.String("repoDir"), "."),
    spec: Flag.optional(Flag.String("spec")),
    allowFail: Flag.withDefault(Flag.Boolean("allow-fail"), false),
  },
  (cfg) =>
    Effect.gen(function* () {
      const summary = yield* checkRepoSpecEffect({
        repoDir: cfg.repoDir,
        specPath: Option.getOrUndefined(cfg.spec),
        allowFail: cfg.allowFail,
      });
      yield* printJson(summary);
      if (!summary.ok) {
        return yield* Effect.fail(new CliUsageError({ message: "RepoSpec verification check failed." }));
      }
    }),
).pipe(Command.withDescription("Evaluate architectural invariants and drift on a repository."));

const diffCmd = Command.make(
  "diff",
  { base: Argument.String("base"), head: Argument.String("head") },
  (cfg) => diffSpecFilesEffect(cfg.base, cfg.head).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Diff two canonical repospec.json specs."));

const diffViewCmd = Command.make(
  "diff-view",
  {
    repoDir: Argument.String("repoDir"),
    range: Argument.optional(Argument.String("range")),
    out: Flag.optional(Flag.String("out")),
    inline: Flag.withDefault(Flag.Boolean("inline"), false),
  },
  (cfg) =>
    Effect.tryPromise({
      try: () =>
        runDiffViewCommand({
          repoDir: cfg.repoDir,
          rangeArg: Option.getOrUndefined(cfg.range),
          outDir:
            Option.getOrUndefined(cfg.out) ??
            path.join(process.cwd(), "out", `${path.basename(path.resolve(cfg.repoDir))}-diff`),
          writeInline: cfg.inline,
          generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
          renderHtmlFn: renderVisualHtml,
        }),
      catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
    }),
).pipe(Command.withDescription("Generate a visual architectural diff Studio bundle."));

const serveCmd = Command.make(
  "serve",
  {
    target: Argument.withDefault(Argument.String("target"), "."),
    port: Flag.optional(Flag.Int("port")),
    ollama: Flag.optional(Flag.String("ollama")),
    watch: Flag.optional(Flag.String("watch")),
    diff: Flag.withDefault(Flag.Boolean("diff"), false),
  },
  (cfg) =>
    Effect.tryPromise({
      try: () =>
        runServeCommand({
          target: cfg.target,
          port: Option.getOrUndefined(cfg.port),
          ollamaUrl: Option.getOrUndefined(cfg.ollama),
          watchRepo: Option.getOrUndefined(cfg.watch),
          liveDiff: cfg.diff,
          generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
          renderHtmlFn: renderVisualHtml,
        }),
      catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
    }),
).pipe(Command.withDescription("Serve RepoSpec Studio with optional live watch and local Ollama proxy."));

const timelineCmd = Command.make(
  "timeline",
  {
    repoDir: Argument.String("repoDir"),
    commits: Flag.withDefault(Flag.Int("commits"), 8),
    out: Flag.optional(Flag.String("out")),
    inline: Flag.withDefault(Flag.Boolean("inline"), false),
  },
  (cfg) =>
    Effect.tryPromise({
      try: () =>
        runTimelineCommand({
          repoDir: cfg.repoDir,
          commits: cfg.commits,
          outDir:
            Option.getOrUndefined(cfg.out) ??
            path.join(process.cwd(), "out", `${path.basename(path.resolve(cfg.repoDir))}-timeline`),
          writeInline: cfg.inline,
          generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
          renderHtmlFn: renderVisualHtml,
        }),
      catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
    }).pipe(Effect.asVoid),
).pipe(Command.withDescription("Build an architectural timeline across recent git commits."));

const aggregateCmd = Command.make(
  "aggregate",
  {
    inputs: Argument.variadic(Argument.String("specOrDir")),
    out: Flag.optional(Flag.String("out")),
    name: Flag.optional(Flag.String("name")),
    links: Flag.optional(Flag.String("links")),
    inline: Flag.withDefault(Flag.Boolean("inline"), false),
  },
  (cfg) =>
    Effect.gen(function* () {
      if (cfg.inputs.length === 0) {
        return yield* Effect.fail(new CliUsageError({ message: "Provide at least one <specOrDir> input." }));
      }
      yield* Effect.try({
        try: () =>
          runAggregateCommand({
            inputPaths: [...cfg.inputs],
            outDir: Option.getOrUndefined(cfg.out) ?? path.join(process.cwd(), "out", "distributed-system"),
            name: Option.getOrUndefined(cfg.name),
            linksPath: Option.getOrUndefined(cfg.links),
            writeInline: cfg.inline,
            renderHtmlFn: renderVisualHtml,
          }),
        catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
      });
    }),
).pipe(Command.withDescription("Aggregate multiple repository specs into one federated mesh."));

const generateCmd = Command.make(
  "generate",
  {
    repoDir: Argument.String("repoDir"),
    out: Flag.optional(Flag.String("out")),
    mode: Flag.withDefault(Flag.String("mode"), "artifact"),
    inline: Flag.withDefault(Flag.Boolean("inline"), false),
    diff: Flag.optional(Flag.String("diff")),
    timeline: Flag.optional(Flag.Int("timeline")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const repoFs = yield* RepoFs;
      const storageMode: StorageMode = cfg.mode === "commit" ? "commit" : "artifact";
      const outDir =
        Option.getOrUndefined(cfg.out) ??
        path.join(process.cwd(), "out", path.basename(path.resolve(cfg.repoDir)));
      yield* repoFs.mkdir(outDir);
      const sqliteOut = path.join(outDir, "repospec.sqlite");

      const diffRange = Option.getOrUndefined(cfg.diff);
      const timelineCount = Option.getOrElse(cfg.timeline, () => 0);

      let commitDiff: CommitArchDiff | undefined;
      let timeline: ArchTimelineData | undefined;
      let genRes;
      if (diffRange) {
        const diffOut = yield* Effect.tryPromise({
          try: () =>
            runCommitDiffWorktrees({
              repoDir: cfg.repoDir,
              rangeArg: diffRange,
              headSqliteOut: sqliteOut,
              generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, storageMode, dbPath),
            }),
          catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
        });
        genRes = diffOut.head;
        commitDiff = diffOut.commitDiff;
      } else {
        genRes = yield* generateRepoSpecEffect(cfg.repoDir, storageMode, sqliteOut);
      }

      if (timelineCount > 0) {
        timeline = yield* Effect.tryPromise({
          try: () =>
            buildArchTimeline({
              repoDir: cfg.repoDir,
              count: timelineCount,
              generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, storageMode, dbPath),
            }),
          catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
        });
      }

      const { spec, digest, idsModule, sdkModule, drilldown } = genRes;
      const specOut = path.join(outDir, "repospec.json");
      const schemaOut = path.join(outDir, "repospec.schema.json");
      const idsOut = path.join(outDir, "repospec.ids.ts");
      const sdkOut = path.join(outDir, "repospec.sdk.ts");
      const htmlOut = path.join(outDir, "repospec.html");

      yield* Effect.all([
        repoFs.writeText(specOut, serializeSpec(spec)),
        repoFs.writeText(schemaOut, `${JSON.stringify(buildRepoSpecJsonSchema(), null, 2)}\n`),
        repoFs.writeText(idsOut, idsModule),
        repoFs.writeText(sdkOut, sdkModule),
        repoFs.writeText(htmlOut, renderVisualHtml(spec, digest, { inline: false, drilldown, commitDiff, timeline })),
      ]);

      let inlineOut: string | undefined;
      if (cfg.inline) {
        inlineOut = path.join(outDir, "repospec.inline.html");
        yield* repoFs.writeText(
          inlineOut,
          renderVisualHtml(spec, digest, { inline: true, drilldown, commitDiff, timeline }),
        );
      }

      yield* printJson({
        repo: spec.repo.name,
        ecosystem: spec.repo.ecosystem,
        languages: spec.repo.languages,
        commitSha: spec.repo.commitSha,
        remote: spec.repo.remote,
        storageMode,
        digest,
        verification: spec.verification,
        diagnostics: spec.diagnostics,
        summary: spec.summary,
        artifacts: {
          spec: path.resolve(specOut),
          schema: path.resolve(schemaOut),
          sqlite: path.resolve(sqliteOut),
          ids: path.resolve(idsOut),
          sdk: path.resolve(sdkOut),
          html: path.resolve(htmlOut),
          inlineHtml: inlineOut ? path.resolve(inlineOut) : undefined,
        },
      });
    }),
).pipe(Command.withDescription("Generate canonical RepoSpec IR, SQLite graph index, SDK, and visual Studio HTML."));

export const repospecCommand = Command.make("repospec").pipe(
  Command.withDescription("Deterministic canonical RepoSpec IR, SQLite graph index, and interactive visual Studio."),
  Command.withSubcommands([
    generateCmd,
    serveCmd,
    timelineCmd,
    aggregateCmd,
    checkCmd,
    explainCmd,
    impactCmd,
    precedentsCmd,
    validateCmd,
    diffCmd,
    diffViewCmd,
    queryCmd,
    schemaCmd,
  ]),
);
