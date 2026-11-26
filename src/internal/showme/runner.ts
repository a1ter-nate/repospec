import fs from "node:fs";
import path from "node:path";
import type { RepoSpecV4 } from "../../schema.ts";
import { runCommitDiffWorktrees } from "../../studio/diffRunner.ts";
import type { DrilldownIndex } from "../../studio/drilldown.ts";
import { buildShowMePrComment, type ShowMeShotRecord } from "./markdown.ts";
import {
  parseRankPreset,
  rankChangedFiles,
  rankDiffDiagrams,
  type FocusMode,
  type RankPreset,
} from "./ranking.ts";
import {
  rasterizeSvgToPng,
  renderDiffDiagramSvg,
  renderTopFileCardSvg,
  type ShowMeTheme,
} from "./svgRenderer.ts";

export type ShowMeFormat = "png" | "svg" | "both";

export interface ShowMeOptions {
  repoDir: string;
  rangeArg?: string;
  outDir: string;
  top?: number;
  rank?: RankPreset | string;
  format?: ShowMeFormat | string;
  focus?: FocusMode | string;
  theme?: ShowMeTheme | string;
  includeTopFile?: boolean;
  imageBaseUrl?: string;
  generateFn: (dir: string, sqlitePath: string) => Promise<{
    spec: RepoSpecV4;
    digest: string;
    drilldown: DrilldownIndex;
  }>;
}

export interface ShowMeManifest {
  repo: string;
  range: string;
  baseSha: string;
  headSha: string;
  verdict: "safe" | "caution" | "risk";
  verdictSummary: string;
  rankPreset: RankPreset;
  focusMode: FocusMode;
  format: ShowMeFormat;
  outDir: string;
  prCommentPath: string;
  manifestPath: string;
  shots: ShowMeShotRecord[];
}

function slugifyFilePart(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean.slice(0, 48) || "view";
}

function parseFormat(raw?: string): ShowMeFormat {
  if (raw === "png" || raw === "svg" || raw === "both") return raw;
  return "both";
}

function parseFocus(raw?: string): FocusMode {
  if (raw === "always" || raw === "off" || raw === "auto") return raw;
  return "auto";
}

function parseTheme(raw?: string): ShowMeTheme {
  return raw === "light" ? "light" : "dark";
}

export async function runShowMeBundle(options: ShowMeOptions): Promise<ShowMeManifest> {
  const absRepo = path.resolve(options.repoDir);
  const absOut = path.resolve(options.outDir);
  fs.mkdirSync(absOut, { recursive: true });

  const preset = parseRankPreset(options.rank);
  const format = parseFormat(options.format);
  const focusMode = parseFocus(options.focus);
  const theme = parseTheme(options.theme);
  const topN = Math.max(1, Math.min(12, options.top ?? 3));
  const includeTopFile = options.includeTopFile !== false;

  const sqliteOut = path.join(absOut, "repospec.sqlite");
  const { head, commitDiff } = await runCommitDiffWorktrees({
    repoDir: absRepo,
    rangeArg: options.rangeArg,
    headSqliteOut: sqliteOut,
    generateFn: options.generateFn,
  });

  const rankedDiagrams = rankDiffDiagrams({
    commitDiff,
    headSpec: head.spec,
    drilldown: head.drilldown,
    preset,
    focusMode,
  });

  const rankedFiles = rankChangedFiles({
    commitDiff,
    headSpec: head.spec,
    drilldown: head.drilldown,
    preset,
  });

  const nonZeroDiagrams = rankedDiagrams.filter((d) => d.bundle.changedCount > 0);
  const selectedDiagrams = (nonZeroDiagrams.length > 0 ? nonZeroDiagrams : rankedDiagrams).slice(0, topN);

  const shots: ShowMeShotRecord[] = [];
  let seq = 1;

  for (const rd of selectedDiagrams) {
    const prefix = String(seq).padStart(2, "0");
    const baseName = `${prefix}-${slugifyFilePart(rd.bundle.label)}`;
    const svg = renderDiffDiagramSvg({
      ranked: rd,
      commitDiff,
      repoName: head.spec.repo.name,
      theme,
    });

    const record: ShowMeShotRecord = {
      rank: seq,
      kind: "diagram",
      id: rd.bundle.id,
      title: rd.bundle.label,
      priority: rd.priority,
      score: rd.score,
      focused: rd.focused,
      hiddenNodes: rd.hiddenNodes,
      reasons: rd.breakdown.reasons,
      breakdown: rd.breakdown,
    };

    if (format === "svg" || format === "both") {
      const svgFile = `${baseName}.svg`;
      fs.writeFileSync(path.join(absOut, svgFile), svg, "utf8");
      record.svgFile = svgFile;
    }
    if (format === "png" || format === "both") {
      const pngFile = `${baseName}.png`;
      fs.writeFileSync(path.join(absOut, pngFile), rasterizeSvgToPng(svg, 2));
      record.pngFile = pngFile;
    }

    shots.push(record);
    seq += 1;
  }

  const topFile = includeTopFile ? rankedFiles[0] : undefined;
  if (topFile) {
    const drillByPath = new Map(head.drilldown.files.map((f) => [f.p, f]));
    const drillFile = drillByPath.get(topFile.file.path);
    const prefix = String(seq).padStart(2, "0");
    const baseName = `${prefix}-file-${slugifyFilePart(path.basename(topFile.file.path))}`;
    const svg = renderTopFileCardSvg({
      rankedFile: topFile,
      drillFile,
      commitDiff,
      theme,
    });

    const record: ShowMeShotRecord = {
      rank: seq,
      kind: "top_file",
      id: `file:${topFile.file.path}`,
      title: `Focus File: ${topFile.file.path}`,
      priority: topFile.priority,
      score: topFile.score,
      focused: true,
      hiddenNodes: 0,
      reasons: topFile.reasons,
    };

    if (format === "svg" || format === "both") {
      const svgFile = `${baseName}.svg`;
      fs.writeFileSync(path.join(absOut, svgFile), svg, "utf8");
      record.svgFile = svgFile;
    }
    if (format === "png" || format === "both") {
      const pngFile = `${baseName}.png`;
      fs.writeFileSync(path.join(absOut, pngFile), rasterizeSvgToPng(svg, 2));
      record.pngFile = pngFile;
    }

    shots.push(record);
  }

  const prMarkdown = buildShowMePrComment({
    repoName: head.spec.repo.name,
    commitDiff,
    preset,
    shots,
    topFiles: rankedFiles,
    imageBaseUrl: options.imageBaseUrl,
  });

  const prCommentPath = path.join(absOut, "pr-comment.md");
  fs.writeFileSync(prCommentPath, prMarkdown, "utf8");

  const manifestPath = path.join(absOut, "manifest.json");
  const manifest: ShowMeManifest = {
    repo: head.spec.repo.name,
    range: commitDiff.range,
    baseSha: commitDiff.baseSha,
    headSha: commitDiff.headSha,
    verdict: commitDiff.verdict,
    verdictSummary: commitDiff.verdictSummary,
    rankPreset: preset,
    focusMode,
    format,
    outDir: absOut,
    prCommentPath,
    manifestPath,
    shots,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}
