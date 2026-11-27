import path from "node:path";
import { createPluginHost, runGenerateRepoSpec, serializeSpec } from "@repospec/core";
import { checkRepoSpecEffect, generateRepoSpecEffect, RepoFs } from "@repospec/core/effect";
import { buildRepoSpecJsonSchema, CliUsageError, type StorageMode } from "@repospec/plugin";
import {
  buildArchTimeline,
  renderVisualHtml,
  runCommitDiffWorktrees,
  type ArchTimelineData,
  type CommitArchDiff,
  type ReportCustomization,
} from "@repospec/plugin-studio";
import { runShowMeBundle } from "@repospec/show-me";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { runAggregateCommand, runDiffViewCommand, runServeCommand, runTimelineCommand } from "./cliCommands.ts";
import { buildPluginOperations, ejectCmd, factsCmd, flowsCmd, scanCmd } from "./jellyCli.ts";
import { querySubcommands } from "./queryCli.ts";

const printJson = (value: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(value, null, 2));
  });

const checkCmd = Command.make(
  "check",
  {
    repoDir: Argument.withDefault(Argument.String("repoDir"), "."),
    spec: Flag.optional(Flag.String("spec")),
    allowFail: Flag.withDefault(Flag.Boolean("allow-fail"), false),
    plugin: Flag.optional(Flag.String("plugin")),
    disablePlugin: Flag.optional(Flag.String("disable-plugin")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const ops = buildPluginOperations(
        Option.getOrUndefined(cfg.plugin),
        Option.getOrUndefined(cfg.disablePlugin),
      );
      const summary =
        ops.length > 0
          ? yield* Effect.tryPromise({
              try: async () => {
                const host = await createPluginHost({ repoDir: cfg.repoDir, includeBuiltins: true, operations: ops });
                try {
                  return await host.check(cfg.repoDir, {
                    specPath: Option.getOrUndefined(cfg.spec),
                    allowFail: cfg.allowFail,
                  });
                } finally {
                  await host.dispose();
                }
              },
              catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
            })
          : yield* checkRepoSpecEffect({
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
    plugin: Flag.optional(Flag.String("plugin")),
    disablePlugin: Flag.optional(Flag.String("disable-plugin")),
  },
  (cfg) =>
    Effect.tryPromise({
      try: async () => {
        const ops = buildPluginOperations(
          Option.getOrUndefined(cfg.plugin),
          Option.getOrUndefined(cfg.disablePlugin),
        );
        if (ops.length === 0) {
          return runServeCommand({
            target: cfg.target,
            port: Option.getOrUndefined(cfg.port),
            ollamaUrl: Option.getOrUndefined(cfg.ollama),
            watchRepo: Option.getOrUndefined(cfg.watch),
            liveDiff: cfg.diff,
            generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
            renderHtmlFn: renderVisualHtml,
          });
        }
        const host = await createPluginHost({ repoDir: cfg.target, includeBuiltins: true, operations: ops });
        return runServeCommand({
          target: cfg.target,
          port: Option.getOrUndefined(cfg.port),
          ollamaUrl: Option.getOrUndefined(cfg.ollama),
          watchRepo: Option.getOrUndefined(cfg.watch),
          liveDiff: cfg.diff,
          generateFn: (dir, dbPath) => host.scan(dir, { dbPath, storageMode: "artifact" }),
          renderHtmlFn: (spec, digest, opts) => host.renderStudio({ spec, digest, ...opts }),
        });
      },
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

export function resolveGenerateOutDir(params: {
  readonly repoDir: string;
  readonly explicitOut?: string;
  readonly inPlace: boolean;
  readonly storageMode: StorageMode;
  readonly hasExistingDotRepospec: boolean;
  readonly cwd?: string;
}): { readonly outDir: string; readonly outputHint?: string } {
  const absRepo = path.resolve(params.repoDir);
  if (params.explicitOut) return { outDir: params.explicitOut };
  if (params.inPlace || params.storageMode === "commit" || params.hasExistingDotRepospec) {
    return { outDir: path.join(absRepo, ".repospec") };
  }
  const baseCwd = params.cwd ?? process.cwd();
  return {
    outDir: path.join(baseCwd, "out", path.basename(absRepo)),
    outputHint: "Written outside the repo. Pass --in-place or --out .repospec (or create .repospec/) to refresh .repospec/ artifacts in place.",
  };
}

const generateCmd = Command.make(
  "generate",
  {
    repoDir: Argument.String("repoDir"),
    out: Flag.optional(Flag.String("out")),
    mode: Flag.withDefault(Flag.String("mode"), "artifact"),
    inPlace: Flag.withDefault(Flag.Boolean("in-place"), false),
    inline: Flag.withDefault(Flag.Boolean("inline"), false),
    diff: Flag.optional(Flag.String("diff")),
    timeline: Flag.optional(Flag.Int("timeline")),
    plugin: Flag.optional(Flag.String("plugin")),
    disablePlugin: Flag.optional(Flag.String("disable-plugin")),
  },
  (cfg) =>
    Effect.gen(function* () {
      const repoFs = yield* RepoFs;
      const storageMode: StorageMode = cfg.mode === "commit" ? "commit" : "artifact";
      const dotRepospecPath = path.join(path.resolve(cfg.repoDir), ".repospec");
      const hasExistingDotRepospec = yield* repoFs.exists(dotRepospecPath);
      const { outDir, outputHint } = resolveGenerateOutDir({
        repoDir: cfg.repoDir,
        explicitOut: Option.getOrUndefined(cfg.out),
        inPlace: cfg.inPlace,
        storageMode,
        hasExistingDotRepospec,
      });
      yield* repoFs.mkdir(outDir);
      const sqliteOut = path.join(outDir, "repospec.sqlite");

      const ops = buildPluginOperations(Option.getOrUndefined(cfg.plugin), Option.getOrUndefined(cfg.disablePlugin));
      const diffRange = Option.getOrUndefined(cfg.diff);
      const timelineCount = Option.getOrElse(cfg.timeline, () => 0);

      let commitDiff: CommitArchDiff | undefined;
      let timeline: ArchTimelineData | undefined;
      let htmlOutput = "";
      let inlineHtmlOutput: string | undefined;
      let genSpec;
      let genDigest = "";
      let genIds = "";
      let genSdk = "";

      if (ops.length > 0) {
        const res = yield* Effect.tryPromise({
          try: async () => {
            const host = await createPluginHost({ repoDir: cfg.repoDir, includeBuiltins: true, operations: ops });
            try {
              const scanRes = await host.scan(cfg.repoDir, { dbPath: sqliteOut, storageMode });
              const rendered = host.renderStudio({ ...scanRes, inline: false });
              const renderedInline = cfg.inline ? host.renderStudio({ ...scanRes, inline: true }) : undefined;
              return { scanRes, rendered, renderedInline };
            } finally {
              await host.dispose();
            }
          },
          catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
        });
        genSpec = res.scanRes.spec;
        genDigest = res.scanRes.digest;
        genIds = res.scanRes.idsModule;
        genSdk = res.scanRes.sdkModule;
        htmlOutput = res.rendered;
        inlineHtmlOutput = res.renderedInline;
      } else {
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
          genRes = { ...diffOut.head, repoExtensions: { studioCustomizations: [] as unknown[] } };
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

        genSpec = genRes.spec;
        genDigest = genRes.digest;
        genIds = "idsModule" in genRes ? genRes.idsModule : "";
        genSdk = "sdkModule" in genRes ? genRes.sdkModule : "";
        const lastUi = genRes.repoExtensions.studioCustomizations.at(-1);
        const reportUi = lastUi && typeof lastUi === "object" ? (lastUi as ReportCustomization) : undefined;
        htmlOutput = renderVisualHtml(genSpec, genDigest, {
          inline: false,
          drilldown: genRes.drilldown,
          commitDiff,
          timeline,
          ui: reportUi,
        });
        if (cfg.inline) {
          inlineHtmlOutput = renderVisualHtml(genSpec, genDigest, {
            inline: true,
            drilldown: genRes.drilldown,
            commitDiff,
            timeline,
            ui: reportUi,
          });
        }
      }

      const specOut = path.join(outDir, "repospec.json");
      const schemaOut = path.join(outDir, "repospec.schema.json");
      const idsOut = path.join(outDir, "repospec.ids.ts");
      const sdkOut = path.join(outDir, "repospec.sdk.ts");
      const htmlOut = path.join(outDir, "repospec.html");

      yield* Effect.all(
        [
          repoFs.writeText(specOut, serializeSpec(genSpec)),
          repoFs.writeText(schemaOut, `${JSON.stringify(buildRepoSpecJsonSchema(), null, 2)}\n`),
          repoFs.writeText(idsOut, genIds),
          repoFs.writeText(sdkOut, genSdk),
          repoFs.writeText(htmlOut, htmlOutput),
        ],
        { concurrency: 4 },
      );

      let inlineOut: string | undefined;
      if (inlineHtmlOutput) {
        inlineOut = path.join(outDir, "repospec.inline.html");
        yield* repoFs.writeText(inlineOut, inlineHtmlOutput);
      }

      yield* printJson({
        repo: genSpec.repo.name,
        ecosystem: genSpec.repo.ecosystem,
        languages: genSpec.repo.languages,
        commitSha: genSpec.repo.commitSha,
        remote: genSpec.repo.remote,
        storageMode,
        digest: genDigest,
        verification: genSpec.verification,
        diagnostics: genSpec.diagnostics,
        summary: genSpec.summary,
        outputHint,
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

const showMeCmd = Command.make(
  "show-me",
  {
    repoDir: Argument.withDefault(Argument.String("repoDir"), "."),
    range: Argument.optional(Argument.String("range")),
    out: Flag.optional(Flag.String("out")),
    top: Flag.withDefault(Flag.Int("top"), 3),
    rank: Flag.withDefault(Flag.String("rank"), "risk"),
    format: Flag.withDefault(Flag.String("format"), "both"),
    focus: Flag.withDefault(Flag.String("focus"), "auto"),
    theme: Flag.withDefault(Flag.String("theme"), "auto"),
    imageBaseUrl: Flag.optional(Flag.String("image-base-url")),
    noTopFile: Flag.withDefault(Flag.Boolean("no-top-file"), false),
  },
  (cfg) =>
    Effect.tryPromise({
      try: () =>
        runShowMeBundle({
          repoDir: cfg.repoDir,
          rangeArg: Option.getOrUndefined(cfg.range),
          outDir:
            Option.getOrUndefined(cfg.out) ??
            path.join(process.cwd(), "out", `${path.basename(path.resolve(cfg.repoDir))}-show-me`),
          top: cfg.top,
          rank: cfg.rank,
          format: cfg.format,
          focus: cfg.focus,
          theme: cfg.theme,
          includeTopFile: !cfg.noTopFile,
          imageBaseUrl: Option.getOrUndefined(cfg.imageBaseUrl),
          generateFn: (dir, dbPath) => runGenerateRepoSpec(dir, "artifact", dbPath),
        }),
      catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
    }).pipe(Effect.flatMap(printJson)),
).pipe(Command.withDescription("Generate priority-ranked architectural diff screenshots (SVG/PNG) and a /show-me PR comment."));

export const repospecCommand = Command.make("repospec").pipe(
  Command.withDescription("Deterministic canonical RepoSpec IR, SQLite graph index, and interactive visual Studio."),
  Command.withSubcommands([
    generateCmd,
    scanCmd,
    factsCmd,
    flowsCmd,
    ejectCmd,
    serveCmd,
    timelineCmd,
    aggregateCmd,
    checkCmd,
    diffViewCmd,
    showMeCmd,
    ...querySubcommands,
  ]),
);
