import type { CommitArchDiff } from "@repospec/plugin-studio";
import type { ImportanceBreakdown, RankedChangedFile, RankPreset } from "./ranking.ts";
import type { ReviewLevel, TriageResult } from "./triage.ts";

export interface ShowMeShotRecord {
  rank: number;
  placement: "hero" | "detail";
  kind: "diagram" | "symbol" | "iac";
  id: string;
  title: string;
  altText: string;
  score: number;
  focused: boolean;
  hiddenNodes: number;
  reasons: string[];
  svgFile?: string;
  pngFile?: string;
  lightSvgFile?: string;
  lightPngFile?: string;
  breakdown?: ImportanceBreakdown;
}

function joinImageUrl(baseUrl: string | undefined, fileName: string): string {
  if (!baseUrl || baseUrl.trim().length === 0) return `./${fileName}`;
  const clean = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${clean}/${fileName}`;
}

function levelBadge(level: ReviewLevel): string {
  if (level === "scrutinize") return "🔴 Scrutinize";
  if (level === "look") return "🟡 Look";
  return "🟢 Skim";
}

function renderPictureBlock(shot: ShowMeShotRecord, imageBaseUrl?: string): string {
  const darkFile = shot.pngFile ?? shot.svgFile;
  const lightFile = shot.lightPngFile ?? shot.lightSvgFile;
  const alt = shot.altText.replaceAll('"', "'");

  if (darkFile && lightFile) {
    return [
      "<picture>",
      `  <source media="(prefers-color-scheme: dark)" srcset="${joinImageUrl(imageBaseUrl, darkFile)}">`,
      `  <source media="(prefers-color-scheme: light)" srcset="${joinImageUrl(imageBaseUrl, lightFile)}">`,
      `  <img alt="${alt}" src="${joinImageUrl(imageBaseUrl, lightFile)}" width="840">`,
      "</picture>",
    ].join("\n");
  }
  const single = darkFile ?? lightFile;
  if (!single) return "";
  return `<img alt="${alt}" src="${joinImageUrl(imageBaseUrl, single)}" width="840">`;
}

function statusIcon(status: RankedChangedFile["file"]["status"]): string {
  if (status === "added") return "🟢";
  if (status === "deleted") return "🔴";
  return "🟡";
}

function formatDeltaCell(ins: number, del: number): string {
  if (ins > 0 && del > 0) return `+${ins} −${del}`;
  if (ins > 0) return `+${ins}`;
  if (del > 0) return `−${del}`;
  return "0";
}

function formatUsedByCell(tf: RankedChangedFile): string {
  if (tf.fileClass !== "source") return "—";
  if (tf.preexistingDependents > 0) {
    return `${tf.preexistingDependents} existing`;
  }
  if (tf.newWiring > 0) {
    return `${tf.newWiring} (new)`;
  }
  return "0";
}

function formatTestCell(tf: RankedChangedFile): string {
  if (tf.fileClass !== "source" && tf.fileClass !== "iac") return "—";
  if (tf.testedInPr) return "✓ in PR";
  if (tf.coverageKnown && tf.coveragePct !== undefined) return `${Math.round(tf.coveragePct)}% line`;
  if (tf.noDirectTest) return "no direct test";
  return "—";
}

function buildFilesSummaryLabel(topFiles: RankedChangedFile[], commitDiff: CommitArchDiff): string {
  const counts = new Map<string, number>();
  for (const f of topFiles) {
    counts.set(f.fileClass, (counts.get(f.fileClass) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const cls of ["source", "iac", "contract", "fixture", "test", "script", "doc", "config"]) {
    const n = counts.get(cls) ?? 0;
    if (n > 0) parts.push(`${n} ${cls}${n === 1 || cls === "iac" || cls === "source" ? "" : "s"}`);
  }
  const delta = `+${commitDiff.kpis.files.insertions} −${commitDiff.kpis.files.deletions}`;
  return parts.length > 0 ? `Changed files · ${parts.join(" · ")} (${delta})` : `Changed files (${delta})`;
}

export function buildShowMePrComment(params: {
  repoName: string;
  commitDiff: CommitArchDiff;
  preset: RankPreset;
  triage: TriageResult;
  shots: ShowMeShotRecord[];
  topFiles: RankedChangedFile[];
  imageBaseUrl?: string;
}): string {
  const { commitDiff, triage, shots, topFiles, imageBaseUrl } = params;
  const heroShots = shots.filter((s) => s.placement === "hero");
  const detailShots = shots.filter((s) => s.placement === "detail");

  const out: string[] = [
    "<!-- repospec-show-me -->",
    `### ${levelBadge(triage.level)} · ${triage.headline}`,
    triage.shapeLine,
    "",
  ];

  if (triage.attentionItems.length > 0) {
    const alertKind = triage.level === "scrutinize" ? "[!CAUTION]" : "[!WARNING]";
    out.push(`> ${alertKind}`);
    for (const item of triage.attentionItems.slice(0, 2)) {
      out.push(`> **${item.title}:** ${item.detail}`);
    }
    out.push("");
  }

  for (const shot of heroShots) {
    const pic = renderPictureBlock(shot, imageBaseUrl);
    if (pic) out.push(pic, "");
  }

  const hasSurfaces =
    commitDiff.surfaces.endpointsAdded.length +
      commitDiff.surfaces.endpointsRemoved.length +
      commitDiff.surfaces.entitiesAdded.length +
      commitDiff.surfaces.entitiesRemoved.length +
      commitDiff.surfaces.externalAdded.length +
      commitDiff.surfaces.externalRemoved.length +
      commitDiff.surfaces.envAdded.length +
      commitDiff.surfaces.envRemoved.length >
    0;

  if (hasSurfaces && heroShots.length === 0) {
    out.push("```diff");
    for (const ep of commitDiff.surfaces.endpointsAdded.slice(0, 6)) out.push(`+ endpoint ${ep}`);
    for (const ep of commitDiff.surfaces.endpointsRemoved.slice(0, 6)) out.push(`- endpoint ${ep}`);
    for (const en of commitDiff.surfaces.entitiesAdded.slice(0, 6)) out.push(`+ entity   ${en}`);
    for (const en of commitDiff.surfaces.entitiesRemoved.slice(0, 6)) out.push(`- entity   ${en}`);
    for (const ex of commitDiff.surfaces.externalAdded.slice(0, 4)) out.push(`+ external ${ex}`);
    for (const ev of commitDiff.surfaces.envAdded.slice(0, 4)) out.push(`+ env      ${ev}`);
    out.push("```", "");
  }

  if (topFiles.length > 0) {
    const primaryRows = topFiles.filter(
      (f) => f.fileClass === "source" || f.fileClass === "iac" || f.fileClass === "contract" || f.fileClass === "fixture",
    );
    const secondaryRows = topFiles.filter(
      (f) => f.fileClass === "test" || f.fileClass === "doc" || f.fileClass === "script" || f.fileClass === "config",
    );

    out.push(`<details><summary>${buildFilesSummaryLabel(topFiles, commitDiff)}</summary>`, "");
    if (primaryRows.length > 0) {
      out.push("| | File | Δ | Used by | Tests |");
      out.push("| :--- | :--- | :---: | :---: | :---: |");
      for (const tf of primaryRows.slice(0, 15)) {
        out.push(
          `| ${statusIcon(tf.file.status)} | \`${tf.file.path}\` | ${formatDeltaCell(tf.file.insertions, tf.file.deletions)} | ${formatUsedByCell(tf)} | ${formatTestCell(tf)} |`,
        );
      }
      out.push("");
    }
    if (secondaryRows.length > 0) {
      const secIns = secondaryRows.reduce((s, f) => s + f.file.insertions, 0);
      const secDel = secondaryRows.reduce((s, f) => s + f.file.deletions, 0);
      const list = secondaryRows
        .slice(0, 6)
        .map((f) => `\`${f.file.path}\` (${formatDeltaCell(f.file.insertions, f.file.deletions)})`)
        .join(", ");
      const extra = secondaryRows.length > 6 ? ` +${secondaryRows.length - 6} more` : "";
      out.push(`**Tests / docs / support (${formatDeltaCell(secIns, secDel)}):** ${list}${extra}`, "");
    }
    out.push("</details>");
  }

  for (const shot of detailShots) {
    const pic = renderPictureBlock(shot, imageBaseUrl);
    if (!pic) continue;
    out.push(`<details><summary>${shot.title}</summary>`, "", pic, "", "</details>");
  }

  out.push("", `<sub>RepoSpec · static structure only · ${commitDiff.baseSha}..${commitDiff.headSha}</sub>`);
  return out.join("\n");
}
