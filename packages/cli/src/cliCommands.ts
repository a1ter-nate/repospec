import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildArchTimeline, type ArchTimelineData } from "@repospec/plugin-studio";
import { aggregateRepoSpecs } from "@repospec/plugin-arch";
import { loadFederationInputs, type ExplicitTopologyLink } from "@repospec/plugin-arch";
import { serializeSpec } from "@repospec/core";
import { buildRepoSpecJsonSchema, type RepoSpecV4 } from "@repospec/plugin";
import type { CommitArchDiff } from "@repospec/plugin-studio";
import { runCommitDiffWorktrees } from "@repospec/plugin-studio";
import type { DrilldownIndex } from "@repospec/plugin-studio";
import { startStudioServer } from "@repospec/plugin-studio";

export interface GeneratedBundle {
  spec: RepoSpecV4;
  digest: string;
  drilldown: DrilldownIndex;
}

export type RenderVisualHtmlFn = (
  spec: RepoSpecV4,
  digest: string,
  options?: { inline?: boolean; drilldown?: DrilldownIndex; commitDiff?: CommitArchDiff; timeline?: ArchTimelineData },
) => string;

export async function runServeCommand(params: {
  target: string;
  port?: number;
  ollamaUrl?: string;
  watchRepo?: string;
  liveDiff?: boolean;
  generateFn: (dir: string, sqlitePath: string) => Promise<GeneratedBundle>;
  renderHtmlFn: RenderVisualHtmlFn;
}): Promise<void> {
  let htmlPath = params.target;
  let onRebuild: (() => Promise<void>) | undefined;

  if (params.watchRepo) {
    const absRepo = path.resolve(params.watchRepo);
    const outDir = path.resolve(
      fs.existsSync(params.target) && fs.statSync(params.target).isDirectory()
        ? params.target
        : path.join(os.tmpdir(), `repospec-watch-${path.basename(absRepo)}`),
    );
    fs.mkdirSync(outDir, { recursive: true });
    htmlPath = path.join(outDir, "repospec.html");
    const sqliteOut = path.join(outDir, "repospec.sqlite");

    const rebuild = async () => {
      let head: GeneratedBundle;
      let commitDiff: CommitArchDiff | undefined;
      if (params.liveDiff) {
        const res = await runCommitDiffWorktrees({
          repoDir: absRepo,
          rangeArg: "HEAD..WORKTREE",
          headSqliteOut: sqliteOut,
          generateFn: params.generateFn,
        });
        head = res.head;
        commitDiff = res.commitDiff;
      } else {
        head = await params.generateFn(absRepo, sqliteOut);
      }
      fs.writeFileSync(
        htmlPath,
        params.renderHtmlFn(head.spec, head.digest, { inline: false, drilldown: head.drilldown, commitDiff }),
        "utf8",
      );
    };

    await rebuild();
    onRebuild = rebuild;
  }

  const started = startStudioServer({
    targetPath: htmlPath,
    port: params.port,
    ollamaUrl: params.ollamaUrl,
    watchDir: params.watchRepo,
    onRebuild,
  });
  console.log(
    JSON.stringify(
      {
        url: started.url,
        html: started.htmlPath,
        watching: started.watching,
        localAiProxy: `${started.url}/api/ai/explain`,
      },
      null,
      2,
    ),
  );
  await new Promise(() => {});
}

export async function runDiffViewCommand(params: {
  repoDir: string;
  rangeArg?: string;
  outDir: string;
  generateFn: (dir: string, sqlitePath: string) => Promise<GeneratedBundle>;
  renderHtmlFn: RenderVisualHtmlFn;
}): Promise<void> {
  fs.mkdirSync(params.outDir, { recursive: true });
  const sqliteOut = path.join(params.outDir, "repospec.sqlite");
  const { head, commitDiff } = await runCommitDiffWorktrees({
    repoDir: params.repoDir,
    rangeArg: params.rangeArg,
    headSqliteOut: sqliteOut,
    generateFn: params.generateFn,
  });
  const htmlOut = path.join(params.outDir, "repospec.html");
  const diffJsonOut = path.join(params.outDir, "repospec.diff.json");
  fs.writeFileSync(diffJsonOut, `${JSON.stringify(commitDiff, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    htmlOut,
    params.renderHtmlFn(head.spec, head.digest, { inline: false, drilldown: head.drilldown, commitDiff }),
    "utf8",
  );
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
        },
      },
      null,
      2,
    ),
  );
}

export async function runTimelineCommand(params: {
  repoDir: string;
  commits: number;
  outDir: string;
  generateFn: (dir: string, sqlitePath: string) => Promise<GeneratedBundle>;
  renderHtmlFn: RenderVisualHtmlFn;
}): Promise<ArchTimelineData> {
  fs.mkdirSync(params.outDir, { recursive: true });
  const sqliteOut = path.join(params.outDir, "repospec.sqlite");
  const head = await params.generateFn(params.repoDir, sqliteOut);
  const timeline = await buildArchTimeline({
    repoDir: params.repoDir,
    count: params.commits,
    generateFn: params.generateFn,
  });
  const htmlOut = path.join(params.outDir, "repospec.html");
  const tlJsonOut = path.join(params.outDir, "repospec.timeline.json");
  fs.writeFileSync(tlJsonOut, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    htmlOut,
    params.renderHtmlFn(head.spec, head.digest, { inline: false, drilldown: head.drilldown, timeline }),
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        repo: head.spec.repo.name,
        range: timeline.generatedFrom,
        trend: timeline.trend,
        summary: timeline.summary,
        commits: timeline.commits.length,
        artifacts: {
          html: path.resolve(htmlOut),
          timelineJson: path.resolve(tlJsonOut),
        },
      },
      null,
      2,
    ),
  );
  return timeline;
}

export function runAggregateCommand(params: {
  inputPaths: string[];
  outDir: string;
  name?: string;
  linksPath?: string;
  renderHtmlFn: RenderVisualHtmlFn;
}): void {
  const inputs = loadFederationInputs(params.inputPaths);
  let explicitLinks: ExplicitTopologyLink[] | undefined;
  if (params.linksPath && fs.existsSync(path.resolve(params.linksPath))) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(params.linksPath), "utf8")) as { links?: ExplicitTopologyLink[] } | ExplicitTopologyLink[];
    explicitLinks = Array.isArray(parsed) ? parsed : parsed.links;
  }
  const agg = aggregateRepoSpecs({ inputs, name: params.name, explicitLinks });
  fs.mkdirSync(params.outDir, { recursive: true });
  const specOut = path.join(params.outDir, "repospec.json");
  const schemaOut = path.join(params.outDir, "repospec.schema.json");
  const htmlOut = path.join(params.outDir, "repospec.html");
  fs.writeFileSync(specOut, serializeSpec(agg.spec), "utf8");
  fs.writeFileSync(schemaOut, `${JSON.stringify(buildRepoSpecJsonSchema(), null, 2)}\n`, "utf8");
  fs.writeFileSync(
    htmlOut,
    params.renderHtmlFn(agg.spec, agg.digest, { inline: false, commitDiff: agg.commitDiff }),
    "utf8",
  );
  let diffOut: string | null = null;
  if (agg.commitDiff) {
    diffOut = path.join(params.outDir, "repospec.diff.json");
    fs.writeFileSync(diffOut, `${JSON.stringify(agg.commitDiff, null, 2)}\n`, "utf8");
  }
  console.log(
    JSON.stringify(
      {
        name: agg.spec.repo.name,
        digest: agg.digest,
        stats: agg.stats,
        verification: agg.spec.verification,
        artifacts: {
          spec: path.resolve(specOut),
          schema: path.resolve(schemaOut),
          html: path.resolve(htmlOut),
          diffJson: diffOut ? path.resolve(diffOut) : undefined,
        },
      },
      null,
      2,
    ),
  );
}
