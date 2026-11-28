import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ExtractorPlugin, FactRecord, GraphFragment, MetricRecord, RepoContext } from "@repospec/plugin";
import { isExcludedCodePath } from "@repospec/plugin";

const EXTRACTOR_ID = "arch.git-evolution.v1";
const MAX_COMMITS = 200;
const MAX_FILES_PER_COMMIT = 30;
const BUG_FIX_RE = /\b(?:fix(?:ed|es|ing)?|bug|hotfix|revert|patch|crash|regression|panic|broken)\b/i;

interface CommitRecord {
  author: string;
  isBugFix: boolean;
  files: Array<{ file: string; added: number; deleted: number }>;
}

function parseGitNumstat(rootDir: string): CommitRecord[] {
  let raw = "";
  try {
    raw = execFileSync(
      "git",
      ["log", "-n", String(MAX_COMMITS), "--numstat", "--no-renames", "--pretty=format:__RS_C__%H%x1f%an%x1f%s"],
      { cwd: rootDir, encoding: "utf8", maxBuffer: 24 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return [];
  }
  const commits: CommitRecord[] = [];
  let current: CommitRecord | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("__RS_C__")) {
      if (current && current.files.length > 0 && current.files.length <= MAX_FILES_PER_COMMIT) {
        commits.push(current);
      }
      const [, author = "unknown", subject = ""] = line.slice(8).split("\x1f");
      current = { author: author.trim() || "unknown", isBugFix: BUG_FIX_RE.test(subject), files: [] };
      continue;
    }
    if (!current || !line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addNum = Number.parseInt(parts[0] ?? "0", 10);
    const delNum = Number.parseInt(parts[1] ?? "0", 10);
    const rel = (parts[2] ?? "").trim().replace(/\\/g, "/");
    if (!rel) continue;
    current.files.push({
      file: rel,
      added: Number.isFinite(addNum) ? addNum : 0,
      deleted: Number.isFinite(delNum) ? delNum : 0,
    });
  }
  if (current && current.files.length > 0 && current.files.length <= MAX_FILES_PER_COMMIT) {
    commits.push(current);
  }
  return commits;
}

function countLinesSafe(absPath: string): number {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    return Math.max(1, text.split("\n").length);
  } catch {
    return 1;
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export const gitEvolutionExtractor: ExtractorPlugin = {
  id: EXTRACTOR_ID,
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const commits = parseGitNumstat(ctx.rootDir);
    if (commits.length === 0) {
      return { nodes: [], edges: [], rules: [] };
    }

    const existingSet = new Set(ctx.allFiles.filter((f) => !isExcludedCodePath(f)));
    const fileStats = new Map<
      string,
      { commits: number; added: number; deleted: number; bugFixes: number; authors: Map<string, number> }
    >();
    const pairCounts = new Map<string, number>();

    for (const c of commits) {
      const touched: string[] = [];
      for (const entry of c.files) {
        if (!existingSet.has(entry.file)) continue;
        touched.push(entry.file);
        const st = fileStats.get(entry.file) ?? {
          commits: 0,
          added: 0,
          deleted: 0,
          bugFixes: 0,
          authors: new Map<string, number>(),
        };
        st.commits += 1;
        st.added += entry.added;
        st.deleted += entry.deleted;
        if (c.isBugFix) st.bugFixes += 1;
        st.authors.set(c.author, (st.authors.get(c.author) ?? 0) + 1);
        fileStats.set(entry.file, st);
      }
      const uniqueTouched = Array.from(new Set(touched)).sort();
      for (let i = 0; i < uniqueTouched.length; i += 1) {
        const a = uniqueTouched[i];
        if (!a) continue;
        for (let j = i + 1; j < uniqueTouched.length; j += 1) {
          const b = uniqueTouched[j];
          if (!b) continue;
          const key = `${a}\0${b}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const facts: FactRecord[] = [];
    const totalCommits = commits.length;

    const sortedFiles = Array.from(fileStats.entries()).sort(([a], [b]) => a.localeCompare(b));
    let highChurnFiles = 0;
    for (const [file, st] of sortedFiles) {
      const loc = countLinesSafe(path.join(ctx.rootDir, file));
      const relChurn = round3((st.added + st.deleted) / loc);
      if (relChurn >= 0.5 && st.commits >= 3) highChurnFiles += 1;
      const authorEntries = Array.from(st.authors.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const major = authorEntries[0];
      const majorPct = major ? round3((major[1] / st.commits) * 100) : 100;
      const minorAuthors = authorEntries.filter(([, cnt]) => cnt / st.commits < 0.1).length;
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "file_churn",
        key: file,
        file,
        line: 1,
        unit: "repo",
        payload: {
          commits: st.commits,
          addedLines: st.added,
          deletedLines: st.deleted,
          relativeChurn: relChurn,
          bugFixCommits: st.bugFixes,
          authorCount: authorEntries.length,
          majorAuthor: major?.[0] ?? null,
          majorOwnerPct: majorPct,
          minorAuthors,
        },
      });
    }

    const coChangePairs: Array<{ fileA: string; fileB: string; coCommits: number; support: number; confidence: number }> = [];
    for (const [key, coCommits] of pairCounts) {
      if (coCommits < 2) continue;
      const [fileA = "", fileB = ""] = key.split("\0");
      const countA = fileStats.get(fileA)?.commits ?? 1;
      const countB = fileStats.get(fileB)?.commits ?? 1;
      const confidence = round3(coCommits / Math.max(1, Math.min(countA, countB)));
      const support = round3(coCommits / Math.max(1, totalCommits));
      if (confidence < 0.35) continue;
      coChangePairs.push({ fileA, fileB, coCommits, support, confidence });
    }
    coChangePairs.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.coCommits - a.coCommits ||
        a.fileA.localeCompare(b.fileA) ||
        a.fileB.localeCompare(b.fileB),
    );

    for (const pair of coChangePairs.slice(0, 400)) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "co_change",
        key: `${pair.fileA}<->${pair.fileB}`,
        file: pair.fileA,
        line: 1,
        unit: "repo",
        payload: {
          fileA: pair.fileA,
          fileB: pair.fileB,
          coCommits: pair.coCommits,
          support: pair.support,
          confidence: pair.confidence,
        },
      });
    }

    const metrics: MetricRecord[] = [
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "git_commits_mined", valueNum: totalCommits },
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "co_change_pairs_count", valueNum: coChangePairs.length },
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "high_relative_churn_files", valueNum: highChurnFiles },
    ];

    return { nodes: [], edges: [], rules: [], facts, metrics };
  },
};
