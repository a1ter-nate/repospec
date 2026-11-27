import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RepoSpecV4 } from "@repospec/plugin";
import { buildCommitArchDiff, resolveGitDiffRange, type CommitArchDiff } from "./commitDiff.ts";

export async function runCommitDiffWorktrees<T extends { spec: RepoSpecV4 }>(params: {
  repoDir: string;
  rangeArg?: string;
  headSqliteOut: string;
  generateFn: (dir: string, sqlitePath: string) => Promise<T>;
}): Promise<{ base: T; head: T; commitDiff: CommitArchDiff }> {
  const { repoDir, rangeArg, headSqliteOut, generateFn } = params;
  const absRepo = path.resolve(repoDir);
  const git = resolveGitDiffRange(absRepo, rangeArg);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-diff-"));
  const baseWt = path.join(tmpRoot, "base");
  const headWt = path.join(tmpRoot, "head");
  const baseDb = path.join(tmpRoot, "base.sqlite");
  let baseAdded = false;
  let headAdded = false;

  try {
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", baseWt, git.baseRef], { cwd: absRepo });
    baseAdded = true;
    const baseRes = await generateFn(baseWt, baseDb);

    let headRes: T;
    if (git.headRef === "WORKTREE") {
      headRes = await generateFn(absRepo, headSqliteOut);
    } else {
      const curSha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: absRepo, encoding: "utf8" }).trim();
      const isCleanHead =
        curSha === git.headSha &&
        execFileSync("git", ["status", "--porcelain"], { cwd: absRepo, encoding: "utf8" }).trim().length === 0;
      if (isCleanHead) {
        headRes = await generateFn(absRepo, headSqliteOut);
      } else {
        execFileSync("git", ["worktree", "add", "--detach", "--quiet", headWt, git.headRef], { cwd: absRepo });
        headAdded = true;
        headRes = await generateFn(headWt, headSqliteOut);
      }
    }

    const commitDiff = buildCommitArchDiff({ git, baseSpec: baseRes.spec, headSpec: headRes.spec });
    return { base: baseRes, head: headRes, commitDiff };
  } finally {
    if (baseAdded) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", baseWt], { cwd: absRepo });
      } catch (err) {
        process.stderr.write(`warn: failed to remove temp base worktree ${baseWt}: ${String(err)}\n`);
      }
    }
    if (headAdded) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", headWt], { cwd: absRepo });
      } catch (err) {
        process.stderr.write(`warn: failed to remove temp head worktree ${headWt}: ${String(err)}\n`);
      }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}
