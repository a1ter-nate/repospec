#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startStudioServer } from "./ai/studioServer.ts";
import { buildCanonicalSpec, diffSpecs, hashSpec, mergeFragments, serializeSpec } from "./canonicalize.ts";
import { discoverRepo } from "./discover.ts";
import type { CommitArchDiff } from "./studio/commitDiff.ts";
import { runCommitDiffWorktrees } from "./studio/diffRunner.ts";
import { buildDrilldownIndex, type DrilldownIndex } from "./studio/drilldown.ts";
import { archExtractor } from "./extractors/arch.ts";
import { ciExtractor } from "./extractors/ci.ts";
import { codeAstExtractor } from "./extractors/codeAst.ts";
import { buildCrossDomainLinks } from "./extractors/crossLink.ts";
import { csharpAstExtractor } from "./extractors/csharpAst.ts";
import { iacExtractor } from "./extractors/iac.ts";
import { pythonAstExtractor } from "./extractors/pythonAst.ts";
import { rustAstExtractor } from "./extractors/rustAst.ts";
import { surfacesAndGovernanceExtractor } from "./extractors/surfacesAndGovernance.ts";
import { testingAndRulesExtractor } from "./extractors/testingAndRules.ts";
import {
  createAndPopulateIndexDb,
  NAMED_QUERIES,
  projectInvariantsToGraph,
  queryEntityOwnership,
  querySurfaces,
  queryVerificationCoverage,
  runSqlInvariants,
  storeDigestInDb,
} from "./indexDb.ts";
import { buildAllDiagrams, buildStaticTraces, resolveEvidenceAnchors } from "./layout.ts";
import { buildModuleArchitecture } from "./moduleGraph.ts";
import {
  buildFilePassport,
  buildImpactReport,
  buildPrecedentsReport,
  buildUnitPassport,
  formatImpactAsGithubMarkdown,
} from "./passport.ts";
import { renderVisualHtml } from "./render.ts";
import {
  buildRepoSpecJsonSchema,
  RepoSpecV4Schema,
  type ExtractorPlugin,
  type RepoSpecV4,
  type StorageMode,
} from "./schema.ts";
import { generateIdsModule, generateSqliteSdkModule } from "./sdkGen.ts";

export const DEFAULT_EXTRACTORS: ExtractorPlugin[] = [
  archExtractor,
  codeAstExtractor,
  pythonAstExtractor,
  rustAstExtractor,
  csharpAstExtractor,
  ciExtractor,
  testingAndRulesExtractor,
  iacExtractor,
  surfacesAndGovernanceExtractor,
];

const RULES_DIR = path.resolve(import.meta.dir, "../rules");

export async function generateRepoSpec(
  repoDir: string,
  storageMode: StorageMode = "artifact",
  dbOutPath?: string,
): Promise<{
  spec: RepoSpecV4;
  digest: string;
  idsModule: string;
  sdkModule: string;
  dbPath: string;
  drilldown: DrilldownIndex;
}> {
  const ctx = discoverRepo(repoDir, storageMode);
  const fragments = await Promise.all(DEFAULT_EXTRACTORS.map((ext) => ext.extract(ctx)));
  const crossFragment = buildCrossDomainLinks(ctx, fragments);
  const merged = mergeFragments([...fragments, crossFragment]);

  const targetDbPath =
    dbOutPath ?? path.join(os.tmpdir(), `repospec-${process.pid}-${ctx.repoName.replace(/[^a-zA-Z0-9_-]/g, "_")}.sqlite`);

  const moduleArch = buildModuleArchitecture({ units: ctx.units, ast: merged.ast });

  const db = createAndPopulateIndexDb({
    dbPath: targetDbPath,
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
  });

  let invariants = [];
  let entities = [];
  let verification;
  let surfaces;
  try {
    invariants = runSqlInvariants(db, RULES_DIR, merged.diagnostics);
    entities = queryEntityOwnership(db);
    surfaces = querySurfaces(db);
    verification = queryVerificationCoverage(db, invariants);
  } finally {
    db.close();
  }

  const projected = projectInvariantsToGraph(merged.nodes, merged.edges, invariants);
  const diagrams = buildAllDiagrams(projected.nodes, projected.edges, merged.stateMachines, moduleArch.diagrams);
  const anchoredInvariants = resolveEvidenceAnchors(invariants, diagrams);
  const traces = buildStaticTraces(diagrams);

  const spec = buildCanonicalSpec({
    ctx,
    extractorIds: [...DEFAULT_EXTRACTORS.map((e) => e.id), "cross-domain.linker.v4", "module-graph.v5", "sqlite.invariants.v4"],
    nodes: projected.nodes,
    edges: projected.edges,
    rules: merged.rules,
    ast: merged.ast,
    invariants: anchoredInvariants,
    entities,
    stateMachines: merged.stateMachines,
    loops: merged.loops,
    catalogArtifacts: merged.catalogArtifacts,
    modules: moduleArch.modules,
    traces,
    surfaces,
    diagrams,
    verification,
    diagnostics: merged.diagnostics,
  });

  const digest = hashSpec(spec);
  storeDigestInDb(targetDbPath, digest);
  const idsModule = generateIdsModule(spec, digest);
  const sdkModule = generateSqliteSdkModule();
  const drilldown = buildDrilldownIndex(ctx.units, merged.ast, ctx.rootDir);
  return { spec, digest, idsModule, sdkModule, dbPath: targetDbPath, drilldown };
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(
      [
        "Usage:",
        "  repospec generate <repoDir> [--out <dir>] [--mode artifact|commit] [--inline]",
        "  repospec serve <repospec.html|outDir> [--port 4173] [--ollama http://127.0.0.1:11434]",
        "  repospec check <repoDir> [--spec <path/to/repospec.json>] [--allow-fail]",
        "  repospec explain <path-or-unit> --db <repospec.sqlite>",
        "  repospec impact <base..head> --db <repospec.sqlite> [--repo <repoDir>] [--format json|github]",
        "  repospec precedents (--path <relpath> | --intent <text>) --db <repospec.sqlite>",
        "  repospec validate <spec.json>",
        "  repospec diff <base.json> <head.json>",
        `  repospec query <repospec.sqlite> [--named ${Object.keys(NAMED_QUERIES).join("|")} | "<sql>"]`,
        "  repospec schema",
      ].join("\n"),
    );
    return;
  }

  if (cmd === "schema") {
    console.log(JSON.stringify(buildRepoSpecJsonSchema(), null, 2));
    return;
  }

  if (cmd === "explain") {
    const subject = args[1];
    const dbFile = parseFlag(args, "--db");
    if (!subject || !dbFile) {
      console.error("Usage: repospec explain <path-or-unit> --db <repospec.sqlite>");
      process.exit(1);
    }
    const db = new Database(path.resolve(dbFile), { readonly: true });
    try {
      const looksLikeFile = subject.includes("/") || /\.[a-zA-Z0-9]+$/.test(subject);
      const result = looksLikeFile ? buildFilePassport(db, subject) : buildUnitPassport(db, subject);
      console.log(JSON.stringify(result, null, 2));
      if ("found" in result) process.exit(1);
    } finally {
      db.close();
    }
    return;
  }

  if (cmd === "impact") {
    const range = args[1];
    const dbFile = parseFlag(args, "--db");
    const repoDir = parseFlag(args, "--repo") ?? ".";
    const format = parseFlag(args, "--format") ?? "json";
    if (!range || !dbFile) {
      console.error("Usage: repospec impact <base..head> --db <repospec.sqlite> [--repo <dir>] [--format json|github]");
      process.exit(1);
    }
    const db = new Database(path.resolve(dbFile), { readonly: true });
    try {
      const report = buildImpactReport(db, path.resolve(repoDir), range);
      if (format === "github") console.log(formatImpactAsGithubMarkdown(report));
      else console.log(JSON.stringify(report, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  if (cmd === "precedents") {
    const dbFile = parseFlag(args, "--db");
    const targetPath = parseFlag(args, "--path");
    const intent = parseFlag(args, "--intent");
    if (!dbFile || (!targetPath && !intent)) {
      console.error("Usage: repospec precedents (--path <relpath> | --intent <text>) --db <repospec.sqlite>");
      process.exit(1);
    }
    const db = new Database(path.resolve(dbFile), { readonly: true });
    try {
      const report = buildPrecedentsReport(db, { path: targetPath, intent });
      console.log(JSON.stringify(report, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  if (cmd === "query") {
    const dbFile = args[1];
    const named = parseFlag(args, "--named");
    const sqlText = named ? NAMED_QUERIES[named] : args.slice(2).join(" ");
    if (!dbFile || !sqlText) {
      console.error(`Usage: repospec query <repospec.sqlite> [--named ${Object.keys(NAMED_QUERIES).join("|")} | "<sql>"]`);
      process.exit(1);
    }
    const db = new Database(path.resolve(dbFile), { readonly: true });
    try {
      const rows = db.query(sqlText).all();
      console.log(JSON.stringify(rows, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  if (cmd === "validate") {
    const target = args[1];
    if (!target) {
      console.error("Missing <spec.json> path");
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(path.resolve(target), "utf8")) as unknown;
    const parsed = RepoSpecV4Schema.parse(raw);
    console.log(
      JSON.stringify(
        {
          valid: true,
          repo: parsed.repo.name,
          ecosystem: parsed.repo.ecosystem,
          schemaVersion: parsed.schemaVersion,
          digest: hashSpec(parsed),
          verification: parsed.verification,
          summary: parsed.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "check") {
    const repoDir = args[1] ?? ".";
    const specFlag = parseFlag(args, "--spec");
    const allowFail = args.includes("--allow-fail");
    const tmpDb = path.join(os.tmpdir(), `repospec-check-${process.pid}.sqlite`);
    try {
      const { spec, digest } = await generateRepoSpec(repoDir, "artifact", tmpDb);
      let drifted = false;
      if (specFlag && fs.existsSync(path.resolve(specFlag))) {
        const committed = RepoSpecV4Schema.parse(JSON.parse(fs.readFileSync(path.resolve(specFlag), "utf8")));
        drifted = hashSpec(committed) !== digest;
      }
      const failedInvariants = spec.invariants.filter((i) => i.status === "fail");
      const errorDiagnostics = spec.diagnostics.filter((d) => d.severity === "error");
      const ok = !drifted && errorDiagnostics.length === 0 && (allowFail || failedInvariants.length === 0);
      console.log(
        JSON.stringify(
          {
            ok,
            drifted,
            digest,
            errorDiagnostics,
            failedInvariants: failedInvariants.map((i) => ({ id: i.id, name: i.name, count: i.violationCount })),
            verification: spec.verification,
          },
          null,
          2,
        ),
      );
      if (!ok) process.exit(1);
    } finally {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    }
    return;
  }

  if (cmd === "diff") {
    const basePath = args[1];
    const headPath = args[2];
    if (!basePath || !headPath) {
      console.error("Usage: repospec diff <base.json> <head.json>");
      process.exit(1);
    }
    const base = RepoSpecV4Schema.parse(JSON.parse(fs.readFileSync(path.resolve(basePath), "utf8")));
    const head = RepoSpecV4Schema.parse(JSON.parse(fs.readFileSync(path.resolve(headPath), "utf8")));
    console.log(JSON.stringify(diffSpecs(base, head), null, 2));
    return;
  }

  if (cmd === "diff-view") {
    const repoDir = args[1];
    if (!repoDir) {
      console.error("Usage: repospec diff-view <repoDir> [base..head] [--out <dir>] [--inline]");
      process.exit(1);
    }
    const maybeRange = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
    const outArg = parseFlag(args, "--out") ?? path.join(process.cwd(), "out", `${path.basename(path.resolve(repoDir))}-diff`);
    const writeInline = args.includes("--inline");
    fs.mkdirSync(outArg, { recursive: true });
    const sqliteOut = path.join(outArg, "repospec.sqlite");
    const { head, commitDiff } = await runCommitDiffWorktrees({
      repoDir,
      rangeArg: maybeRange,
      headSqliteOut: sqliteOut,
      generateFn: (dir, dbPath) => generateRepoSpec(dir, "artifact", dbPath),
    });
    const htmlOut = path.join(outArg, "repospec.html");
    const diffJsonOut = path.join(outArg, "repospec.diff.json");
    fs.writeFileSync(diffJsonOut, `${JSON.stringify(commitDiff, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      htmlOut,
      renderVisualHtml(head.spec, head.digest, { inline: false, drilldown: head.drilldown, commitDiff }),
      "utf8",
    );
    let inlineOut: string | null = null;
    if (writeInline) {
      inlineOut = path.join(outArg, "repospec.inline.html");
      fs.writeFileSync(
        inlineOut,
        renderVisualHtml(head.spec, head.digest, { inline: true, drilldown: head.drilldown, commitDiff }),
        "utf8",
      );
    }
    console.log(
      JSON.stringify(
        {
          repo: head.spec.repo.name,
          range: commitDiff.range,
          baseSha: commitDiff.baseSha,
          headSha: commitDiff.headSha,
          verdict: commitDiff.verdict,
          verdictSummary: commitDiff.verdictSummary,
          kpis: commitDiff.kpis,
          artifacts: {
            html: path.resolve(htmlOut),
            diffJson: path.resolve(diffJsonOut),
            ...(inlineOut ? { inlineHtml: path.resolve(inlineOut) } : {}),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "serve") {
    const target = args[1];
    if (!target) {
      console.error("Usage: repospec serve <repospec.html|outDir> [--port 4173] [--ollama http://127.0.0.1:11434]");
      process.exit(1);
    }
    const portFlag = parseFlag(args, "--port");
    const ollamaFlag = parseFlag(args, "--ollama");
    const started = startStudioServer({
      targetPath: target,
      port: portFlag ? Number(portFlag) : undefined,
      ollamaUrl: ollamaFlag,
    });
    console.log(JSON.stringify({ url: started.url, html: started.htmlPath, localAiProxy: `${started.url}/api/ai/explain` }, null, 2));
    await new Promise(() => {});
  }

  if (cmd === "generate") {
    const repoDir = args[1];
    if (!repoDir) {
      console.error("Missing <repoDir>");
      process.exit(1);
    }
    const modeArg = parseFlag(args, "--mode") ?? "artifact";
    const storageMode: StorageMode = modeArg === "commit" ? "commit" : "artifact";
    const outArg = parseFlag(args, "--out") ?? path.join(process.cwd(), "out", path.basename(path.resolve(repoDir)));
    const diffFlag = parseFlag(args, "--diff");
    const writeInline = args.includes("--inline");

    fs.mkdirSync(outArg, { recursive: true });
    const sqliteOut = path.join(outArg, "repospec.sqlite");
    let commitDiff: CommitArchDiff | undefined;
    let genRes: Awaited<ReturnType<typeof generateRepoSpec>>;
    if (diffFlag) {
      const diffOut = await runCommitDiffWorktrees({
        repoDir,
        rangeArg: diffFlag,
        headSqliteOut: sqliteOut,
        generateFn: (dir, dbPath) => generateRepoSpec(dir, storageMode, dbPath),
      });
      genRes = diffOut.head;
      commitDiff = diffOut.commitDiff;
    } else {
      genRes = await generateRepoSpec(repoDir, storageMode, sqliteOut);
    }
    const { spec, digest, idsModule, sdkModule, drilldown } = genRes;

    const specOut = path.join(outArg, "repospec.json");
    const schemaOut = path.join(outArg, "repospec.schema.json");
    const idsOut = path.join(outArg, "repospec.ids.ts");
    const sdkOut = path.join(outArg, "repospec.sdk.ts");
    const htmlOut = path.join(outArg, "repospec.html");

    fs.writeFileSync(specOut, serializeSpec(spec), "utf8");
    fs.writeFileSync(schemaOut, `${JSON.stringify(buildRepoSpecJsonSchema(), null, 2)}\n`, "utf8");
    fs.writeFileSync(idsOut, idsModule, "utf8");
    fs.writeFileSync(sdkOut, sdkModule, "utf8");
    fs.writeFileSync(htmlOut, renderVisualHtml(spec, digest, { inline: false, drilldown, commitDiff }), "utf8");

    let inlineOut: string | null = null;
    if (writeInline) {
      inlineOut = path.join(outArg, "repospec.inline.html");
      fs.writeFileSync(inlineOut, renderVisualHtml(spec, digest, { inline: true, drilldown, commitDiff }), "utf8");
    }

    console.log(
      JSON.stringify(
        {
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
            ...(inlineOut ? { inlineHtml: path.resolve(inlineOut) } : {}),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
