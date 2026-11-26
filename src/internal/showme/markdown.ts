import type { CommitArchDiff } from "../../studio/commitDiff.ts";
import type { ImportanceBreakdown, PriorityTier, RankedChangedFile, RankPreset } from "./ranking.ts";

export interface ShowMeShotRecord {
  rank: number;
  kind: "diagram" | "top_file";
  id: string;
  title: string;
  priority: PriorityTier;
  score: number;
  focused: boolean;
  hiddenNodes: number;
  reasons: string[];
  svgFile?: string;
  pngFile?: string;
  breakdown?: ImportanceBreakdown;
}

function joinImageUrl(baseUrl: string | undefined, fileName: string): string {
  if (!baseUrl || baseUrl.trim().length === 0) return `./${fileName}`;
  const clean = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${clean}/${fileName}`;
}

function buildSpecialNotes(commitDiff: CommitArchDiff, topFiles: RankedChangedFile[]): string[] {
  const notes: string[] = [];
  if (commitDiff.findings.introduced.length > 0) {
    const sample = commitDiff.findings.introduced
      .slice(0, 2)
      .map((f) => `${f.invariantName} (\`${f.file}\`)`)
      .join(", ");
    notes.push(`Introduces **${commitDiff.findings.introduced.length}** new architectural finding(s): ${sample}.`);
  }
  if (commitDiff.kpis.coveragePct.delta <= -0.5) {
    notes.push(
      `Test reachability shifted **${commitDiff.kpis.coveragePct.before}% → ${commitDiff.kpis.coveragePct.after}%** (${commitDiff.kpis.coveragePct.delta}%).`,
    );
  }
  if (commitDiff.surfaces.externalAdded.length > 0) {
    notes.push(`Adds new external dependency: ${commitDiff.surfaces.externalAdded.map((e) => `\`${e}\``).join(", ")}.`);
  }
  const fragileTop = topFiles.find((f) => f.file.blastRadius >= 3 && f.coveragePct < 50);
  if (fragileTop && notes.length < 3) {
    notes.push(
      `High-blast-radius edit in \`${fragileTop.file.path}\` (**${fragileTop.file.blastRadius} callers**, ${Math.round(fragileTop.coveragePct)}% coverage, churn ${fragileTop.churn}).`,
    );
  }
  if (commitDiff.findings.resolved.length > 0 && notes.length < 3) {
    notes.push(`Resolves **${commitDiff.findings.resolved.length}** existing finding(s).`);
  }
  return notes.slice(0, 3);
}

export function buildShowMePrComment(params: {
  repoName: string;
  commitDiff: CommitArchDiff;
  preset: RankPreset;
  shots: ShowMeShotRecord[];
  topFiles: RankedChangedFile[];
  imageBaseUrl?: string;
}): string {
  const { repoName, commitDiff, preset, shots, topFiles, imageBaseUrl } = params;
  const notes = buildSpecialNotes(commitDiff, topFiles);
  const verdictEmoji = commitDiff.verdict === "risk" ? "🔴" : commitDiff.verdict === "caution" ? "🟡" : "🟢";
  const out: string[] = [
    "<!-- repospec-show-me -->",
    `# ${verdictEmoji} Architectural Show-Me · \`${repoName}\` (\`${commitDiff.baseSha}..${commitDiff.headSha}\`)`,
    "",
    "## Why the change",
    "",
    `${commitDiff.commitSubject} — ${commitDiff.verdictSummary}`,
    "",
    "## Special things to note",
    "",
    ...(notes.length > 0 ? notes.map((n) => `- ${n}`) : ["- None."]),
    "",
  ];

  if (shots.length > 0) {
    out.push(`## Architectural Diffs (ranked by \`--rank ${preset}\`)`, "");
    for (const shot of shots) {
      const imgFile = shot.pngFile ?? shot.svgFile;
      const reasonLine = shot.reasons.length > 0 ? shot.reasons.join(" · ") : "structural diff";
      const focusTag =
        shot.focused && shot.hiddenNodes > 0 ? ` · focused 1-hop (${shot.hiddenNodes} unchanged hidden)` : "";
      out.push(`### ${shot.rank}. [${shot.priority} · score ${shot.score}] ${shot.title}`);
      out.push(`> ${reasonLine}${focusTag}`);
      out.push("");
      if (imgFile) {
        out.push(`![${shot.title}](${joinImageUrl(imageBaseUrl, imgFile)})`);
        out.push("");
      }
    }
  }

  out.push("## Change outline", "");

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

  if (hasSurfaces) {
    out.push("Contract & runtime surface changes:", "```diff");
    for (const ep of commitDiff.surfaces.endpointsAdded.slice(0, 8)) out.push(`+ endpoint ${ep}`);
    for (const ep of commitDiff.surfaces.endpointsRemoved.slice(0, 8)) out.push(`- endpoint ${ep}`);
    for (const en of commitDiff.surfaces.entitiesAdded.slice(0, 6)) out.push(`+ entity   ${en}`);
    for (const en of commitDiff.surfaces.entitiesRemoved.slice(0, 6)) out.push(`- entity   ${en}`);
    for (const ex of commitDiff.surfaces.externalAdded.slice(0, 6)) out.push(`+ external ${ex}`);
    for (const ex of commitDiff.surfaces.externalRemoved.slice(0, 6)) out.push(`- external ${ex}`);
    for (const ev of commitDiff.surfaces.envAdded.slice(0, 6)) out.push(`+ env      ${ev}`);
    for (const ev of commitDiff.surfaces.envRemoved.slice(0, 6)) out.push(`- env      ${ev}`);
    out.push("```", "");
  }

  if (commitDiff.edgeChanges.added.length + commitDiff.edgeChanges.removed.length > 0) {
    out.push("Dependency & structural wire changes:", "```diff");
    for (const e of commitDiff.edgeChanges.added.slice(0, 10)) out.push(`+ ${e.from} -> ${e.to} (${e.kind})`);
    for (const e of commitDiff.edgeChanges.removed.slice(0, 10)) out.push(`- ${e.from} -> ${e.to} (${e.kind})`);
    out.push("```", "");
  }

  if (topFiles.length > 0) {
    out.push(
      `Highest-priority changed files (+${commitDiff.kpis.files.insertions}/-${commitDiff.kpis.files.deletions}):`,
      "```diff",
    );
    for (const tf of topFiles.slice(0, 12)) {
      const sig = tf.file.status === "added" ? "+" : tf.file.status === "deleted" ? "-" : "~";
      const meta = [
        tf.priority,
        `+${tf.file.insertions}/-${tf.file.deletions}`,
        tf.file.blastRadius > 0 ? `${tf.file.blastRadius} callers` : "",
        `${Math.round(tf.coveragePct)}% cov`,
        tf.churn > 0 ? `churn ${tf.churn}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      out.push(`${sig} ${tf.file.path} (${meta})`);
    }
    out.push("```", "");
  }

  out.push(
    "_Generated deterministically by RepoSpec (`repospec show-me`). Structural graph + coverage only; cross-repo wire contracts & behavioral semantics require runtime E2E/contract proofs._",
  );
  return out.join("\n");
}
