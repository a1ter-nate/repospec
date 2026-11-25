import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RepoSpecV4 } from "../schema.ts";

export interface TimelinePoint {
  sha: string;
  date: string;
  author: string;
  subject: string;
  files: number;
  loc: number;
  failures: number;
  warnings: number;
  tangles: number;
  coveragePct: number;
  edges: number;
}

export interface ArchTimelineData {
  generatedFrom: string;
  commits: TimelinePoint[];
  trend: "improving" | "stable" | "drifting";
  summary: string;
}

export function extractGitChurnMap(repoDir: string, maxCommits = 200): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    const out = execFileSync(
      "git",
      ["log", `-n`, String(maxCommits), "--name-only", "--pretty=format:"],
      { cwd: repoDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const raw of out.split("\n")) {
      const f = raw.trim();
      if (!f) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  } catch {
    return counts;
  }
  return counts;
}

export function extractUnifiedDiffHunks(
  repoDir: string,
  baseRef: string,
  headRef: string,
  maxLinesPerFile = 90,
): Map<string, string> {
  const hunks = new Map<string, string>();
  try {
    const args =
      headRef === "WORKTREE"
        ? ["diff", "-U3", "--no-color", baseRef]
        : ["diff", "-U3", "--no-color", baseRef, headRef];
    const raw = execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      maxBuffer: 24 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sections = raw.split(/^diff --git /m);
    for (const sec of sections) {
      if (!sec.trim()) continue;
      const firstNl = sec.indexOf("\n");
      const header = firstNl >= 0 ? sec.slice(0, firstNl) : sec;
      const m = header.match(/^a\/(.+?)\s+b\/(.+)$/);
      const filePath = m?.[2] ?? m?.[1] ?? "";
      if (!filePath) continue;
      const atPos = sec.indexOf("\n@@ ");
      if (atPos < 0) continue;
      const body = sec.slice(atPos + 1).split("\n");
      const clipped = body.length > maxLinesPerFile
        ? [...body.slice(0, maxLinesPerFile), `... (${body.length - maxLinesPerFile} more diff lines)`]
        : body;
      hunks.set(filePath, clipped.join("\n"));
    }
  } catch {
    return hunks;
  }
  return hunks;
}

export async function buildArchTimeline<T extends { spec: RepoSpecV4 }>(params: {
  repoDir: string;
  count?: number;
  generateFn: (dir: string, sqlitePath: string) => Promise<T>;
}): Promise<ArchTimelineData> {
  const absRepo = path.resolve(params.repoDir);
  const limit = Math.max(2, Math.min(20, params.count ?? 8));
  const rawLog = execFileSync(
    "git",
    ["log", `-n`, String(limit), "--reverse", "--pretty=format:%H%x1f%h%x1f%cs%x1f%an%x1f%s"],
    { cwd: absRepo, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  ).trim();
  const entries = rawLog
    .split("\n")
    .filter(Boolean)
    .map((ln) => {
      const [fullSha = "", sha = "", date = "", author = "", subject = ""] = ln.split("\x1f");
      return { fullSha, sha, date, author, subject };
    });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-tl-"));
  const wtDir = path.join(tmpRoot, "wt");
  const dbPath = path.join(tmpRoot, "tl.sqlite");
  let wtAdded = false;
  const points: TimelinePoint[] = [];

  try {
    const first = entries[0];
    if (first) {
      execFileSync("git", ["worktree", "add", "--detach", "--quiet", wtDir, first.fullSha], { cwd: absRepo });
      wtAdded = true;
    }
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      if (!e) continue;
      if (i > 0) {
        execFileSync("git", ["checkout", "--detach", "--force", "--quiet", e.fullSha], { cwd: wtDir });
      }
      const res = await params.generateFn(wtDir, dbPath);
      const spec = res.spec;
      const tangleSet = new Set<string>();
      for (const m of spec.modules ?? []) {
        if (m.inTangle && m.tangleId) tangleSet.add(m.tangleId);
      }
      const totalLoc = (spec.modules ?? []).reduce((acc, m) => acc + m.lines, 0);
      points.push({
        sha: e.sha,
        date: e.date,
        author: e.author,
        subject: e.subject.slice(0, 96),
        files: spec.verification.totalSourceFiles,
        loc: totalLoc,
        failures: spec.verification.invariantsFailed,
        warnings: spec.verification.invariantsWarned,
        tangles: tangleSet.size,
        coveragePct: spec.verification.directTestCoveragePct,
        edges: spec.summary.indexedImportEdges,
      });
    }
  } finally {
    if (wtAdded) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", wtDir], { cwd: absRepo });
      } catch {
        process.stderr.write("");
      }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const head = points[points.length - 1];
  const base = points[0];
  let trend: ArchTimelineData["trend"] = "stable";
  let summary = `Analyzed ${points.length} commits.`;
  if (base && head) {
    const failD = head.failures - base.failures;
    const warnD = head.warnings - base.warnings;
    const covD = Math.round((head.coveragePct - base.coveragePct) * 10) / 10;
    const tangleD = head.tangles - base.tangles;
    if (failD > 0 || tangleD > 0 || warnD >= 2 || covD <= -3) trend = "drifting";
    else if (failD < 0 || tangleD < 0 || covD >= 2) trend = "improving";
    summary = `${base.sha} → ${head.sha} (${points.length} commits): failures ${base.failures}→${head.failures}, warnings ${base.warnings}→${head.warnings}, tangles ${base.tangles}→${head.tangles}, coverage ${base.coveragePct}%→${head.coveragePct}% (${covD >= 0 ? "+" : ""}${covD}%).`;
  }

  return {
    generatedFrom: `${base?.sha ?? ""}..${head?.sha ?? ""}`,
    commits: points,
    trend,
    summary,
  };
}
