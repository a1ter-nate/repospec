import path from "node:path";
import { NAMED_QUERIES } from "@repospec/core";
import { diffSpecFilesEffect, SqliteIndexService, validateSpecFileEffect } from "@repospec/core/effect";
import { buildRepoSpecJsonSchema, CliUsageError } from "@repospec/plugin";
import {
  buildContractionReport,
  buildFilePassport,
  buildImpactReport,
  buildPrecedentsReport,
  buildUnitPassport,
  formatImpactAsGithubMarkdown,
} from "@repospec/plugin-passport";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

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

const diffCmd = Command.make(
  "diff",
  { base: Argument.String("base"), head: Argument.String("head") },
  (cfg) => diffSpecFilesEffect(cfg.base, cfg.head).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Diff two canonical repospec.json specs."));

const contractionCmd = Command.make(
  "contraction",
  {
    target: Argument.String("path-or-unit"),
    db: Flag.String("db"),
  },
  (cfg) =>
    Effect.gen(function* () {
      const sqlite = yield* SqliteIndexService;
      const report = yield* sqlite.withReadonlyDb(cfg.db, (db) =>
        Effect.sync(() => buildContractionReport(db, cfg.target)),
      );
      yield* printJson(report);
    }),
).pipe(Command.withDescription("Compute Parnas/Young contraction & cartridge deletability blast radius."));

export const querySubcommands = [
  explainCmd,
  contractionCmd,
  impactCmd,
  precedentsCmd,
  validateCmd,
  diffCmd,
  queryCmd,
  schemaCmd,
] as const;
