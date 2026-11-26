import fs from "node:fs";
import path from "node:path";
import type { RepoSpecV4 } from "../../schema.ts";
import { runCommitDiffWorktrees } from "../../studio/diffRunner.ts";
import type { DrilldownIndex } from "../../studio/drilldown.ts";
import { renderDiffDiagramSvg, renderSymbolCardSvg } from "./svgRenderer.ts";
import { renderIacCardSvg } from "./iacCardSvg.ts";
import { buildShowMePrComment, type ShowMeShotRecord } from "./markdown.ts";
import {
  parseRankPreset,
  rankChangedFiles,
  rankDiffDiagrams,
  type FocusMode,
  type RankPreset,
} from "./ranking.ts";
import { selectShots, type SelectedShot, type SuppressedShot } from "./shots.ts";
import { rasterizeSvgToPng, type ShowMeTheme, type ShowMeThemeMode } from "./svgPrimitives.ts";
import { triageCommitDiff, type AttentionItem, type PrArchetype, type ReviewLevel } from "./triage.ts";

export type ShowMeFormat = "png" | "svg" | "both";

export interface ShowMeOptions {
  repoDir: string;
  rangeArg?: string;
  outDir: string;
  top?: number;
  rank?: RankPreset | string;
  format?: ShowMeFormat | string;
  focus?: FocusMode | string;
  theme?: ShowMeThemeMode | string;
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
  reviewLevel: ReviewLevel;
  archetype: PrArchetype;
  headline: string;
  shapeLine: string;
  attentionItems: AttentionItem[];
  verdict: "safe" | "caution" | "risk";
  verdictSummary: string;
  rankPreset: RankPreset;
  focusMode: FocusMode;
  format: ShowMeFormat;
  themeMode: ShowMeThemeMode;
  outDir: string;
  prCommentPath: string;
  manifestPath: string;
  shots: ShowMeShotRecord[];
  suppressedShots: SuppressedShot[];
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

function parseThemeMode(raw?: string): ShowMeThemeMode {
  if (raw === "dark" || raw === "light" || raw === "auto") return raw;
  return "auto";
}

function writeVariantAssets(params: {
  absOut: string;
  baseName: string;
  svg: string;
  format: ShowMeFormat;
}): { svgFile?: string; pngFile?: string } {
  const { absOut, baseName, svg, format } = params;
  let svgFile: string | undefined;
  let pngFile: string | undefined;
  if (format === "svg" || format === "both") {
    svgFile = `${baseName}.svg`;
    fs.writeFileSync(path.join(absOut, svgFile), svg, "utf8");
  }
  if (format === "png" || format === "both") {
    pngFile = `${baseName}.png`;
    fs.writeFileSync(path.join(absOut, pngFile), rasterizeSvgToPng(svg, 2));
  }
  return { svgFile, pngFile };
}

export async function runShowMeBundle(options: ShowMeOptions): Promise<ShowMeManifest> {
  const absRepo = path.resolve(options.repoDir);
  const absOut = path.resolve(options.outDir);
  fs.mkdirSync(absOut, { recursive: true });

  const preset = parseRankPreset(options.rank);
  const format = parseFormat(options.format);
  const focusMode = parseFocus(options.focus);
  const themeMode = parseThemeMode(options.theme);
  const topN = Math.max(1, Math.min(12, options.top ?? 3));
  const includeTopFile = options.includeTopFile !== false;

  const sqliteOut = path.join(absOut, "repospec.sqlite");
  const { head, commitDiff } = await runCommitDiffWorktrees({
    repoDir: absRepo,
    rangeArg: options.rangeArg,
    headSqliteOut: sqliteOut,
    generateFn: options.generateFn,
  });

  const rankedFiles = rankChangedFiles({
    commitDiff,
    headSpec: head.spec,
    drilldown: head.drilldown,
    preset,
  });

  const topSourceFile = rankedFiles.find((f) => f.fileClass === "source");
  const topFileHint = topSourceFile
    ? { moduleId: topSourceFile.file.moduleId, fileName: path.basename(topSourceFile.file.path) }
    : undefined;

  const rankedDiagrams = rankDiffDiagrams({
    commitDiff,
    headSpec: head.spec,
    drilldown: head.drilldown,
    preset,
    focusMode,
    topFileHint,
  });

  const triage = triageCommitDiff({
    commitDiff,
    rankedDiagrams,
    rankedFiles,
  });

  const plan = selectShots({
    triage,
    rankedDiagrams,
    rankedFiles,
    drilldown: head.drilldown,
    top: topN,
    includeTopFile,
  });

  const drillByPath = new Map(head.drilldown.files.map((f) => [f.p, f]));
  const themes: ShowMeTheme[] = themeMode === "auto" ? ["dark", "light"] : [themeMode];
  const shots: ShowMeShotRecord[] = [];
  let seq = 1;

  const emitShot = (shot: SelectedShot, placement: "hero" | "detail"): void => {
    const prefix = String(seq).padStart(2, "0");

    if (shot.kind === "diagram") {
      const baseSlug = `${prefix}-${slugifyFilePart(shot.ranked.bundle.label)}`;
      const record: ShowMeShotRecord = {
        rank: seq,
        placement,
        kind: "diagram",
        id: shot.ranked.bundle.id,
        title: shot.ranked.bundle.label,
        altText: `${triage.headline} (${shot.ranked.bundle.label})`,
        score: shot.ranked.score,
        focused: shot.ranked.focused,
        hiddenNodes: shot.ranked.hiddenNodes,
        reasons: shot.ranked.breakdown.reasons,
        breakdown: shot.ranked.breakdown,
      };
      for (const theme of themes) {
        const svg = renderDiffDiagramSvg({ ranked: shot.ranked, theme });
        const suffix = themeMode === "auto" ? `-${theme}` : "";
        const files = writeVariantAssets({ absOut, baseName: `${baseSlug}${suffix}`, svg, format });
        if (theme === "dark" || themeMode === "dark") {
          record.svgFile = files.svgFile;
          record.pngFile = files.pngFile;
        } else {
          record.lightSvgFile = files.svgFile;
          record.lightPngFile = files.pngFile;
        }
      }
      shots.push(record);
      seq += 1;
      return;
    }

    if (shot.kind === "iac") {
      const baseSlug = `${prefix}-iac-${slugifyFilePart(path.basename(shot.primaryFile.file.path))}`;
      const record: ShowMeShotRecord = {
        rank: seq,
        placement,
        kind: "iac",
        id: `iac:${shot.primaryFile.file.path}`,
        title: `IaC Delta: ${shot.primaryFile.file.path}`,
        altText: `IaC diff in ${shot.primaryFile.file.path}: ${triage.shapeLine}`,
        score: shot.primaryFile.score,
        focused: true,
        hiddenNodes: 0,
        reasons: shot.primaryFile.reasons,
      };
      for (const theme of themes) {
        const svg = renderIacCardSvg({ primaryFile: shot.primaryFile, iacDelta: triage.iacDelta, theme });
        const suffix = themeMode === "auto" ? `-${theme}` : "";
        const files = writeVariantAssets({ absOut, baseName: `${baseSlug}${suffix}`, svg, format });
        if (theme === "dark" || themeMode === "dark") {
          record.svgFile = files.svgFile;
          record.pngFile = files.pngFile;
        } else {
          record.lightSvgFile = files.svgFile;
          record.lightPngFile = files.pngFile;
        }
      }
      shots.push(record);
      seq += 1;
      return;
    }

    const drillFile = drillByPath.get(shot.rankedFile.file.path);
    if (!drillFile) return;
    const baseSlug = `${prefix}-symbols-${slugifyFilePart(path.basename(shot.rankedFile.file.path))}`;
    const record: ShowMeShotRecord = {
      rank: seq,
      placement,
      kind: "symbol",
      id: `symbol:${shot.rankedFile.file.path}`,
      title: `Symbols in <code>${shot.rankedFile.file.path}</code>`,
      altText: `Symbol call graph for ${shot.rankedFile.file.path}`,
      score: shot.rankedFile.score,
      focused: true,
      hiddenNodes: 0,
      reasons: shot.rankedFile.reasons,
    };
    for (const theme of themes) {
      const svg = renderSymbolCardSvg({ rankedFile: shot.rankedFile, drillFile, theme });
      const suffix = themeMode === "auto" ? `-${theme}` : "";
      const files = writeVariantAssets({ absOut, baseName: `${baseSlug}${suffix}`, svg, format });
      if (theme === "dark" || themeMode === "dark") {
        record.svgFile = files.svgFile;
        record.pngFile = files.pngFile;
      } else {
        record.lightSvgFile = files.svgFile;
        record.lightPngFile = files.pngFile;
      }
    }
    shots.push(record);
    seq += 1;
  };

  if (plan.heroShots.length > 0 || plan.detailShots.length > 0) {
    for (const s of plan.heroShots) emitShot(s, "hero");
    for (const s of plan.detailShots) emitShot(s, "detail");
  }

  const prMarkdown = buildShowMePrComment({
    repoName: head.spec.repo.name,
    commitDiff,
    preset,
    triage,
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
    reviewLevel: triage.level,
    archetype: triage.archetype,
    headline: triage.headline,
    shapeLine: triage.shapeLine,
    attentionItems: triage.attentionItems,
    verdict: commitDiff.verdict,
    verdictSummary: commitDiff.verdictSummary,
    rankPreset: preset,
    focusMode,
    format,
    themeMode,
    outDir: absOut,
    prCommentPath,
    manifestPath,
    shots,
    suppressedShots: plan.suppressedShots,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}
