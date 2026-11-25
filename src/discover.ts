import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Ecosystem, RepoContext, StorageMode } from "./schema.ts";
import { canonicalizeGitRemote, discoverUnits } from "./taxonomy.ts";

const IGNORED_DIRS = new Set([
  ".git",
  ".claude",
  ".codex",
  ".cursor",
  ".t3",
  ".worktrees",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "target",
  "bin",
  "obj",
  "vendor",
  ".venv",
  ".pytest_cache",
  "Pods",
  "DerivedData",
  ".gradle",
]);

function readCargoExcludes(rootDir: string): Set<string> {
  const excludes = new Set<string>();
  const cargoPath = path.join(rootDir, "Cargo.toml");
  if (!fs.existsSync(cargoPath)) return excludes;
  try {
    const text = fs.readFileSync(cargoPath, "utf8");
    const m = text.match(/exclude\s*=\s*\[([\s\S]*?)\]/);
    if (m?.[1]) {
      for (const item of m[1].matchAll(/"([^"]+)"/g)) {
        if (item[1]) excludes.add(item[1].replace(/\/+$/, ""));
      }
    }
  } catch {
    return excludes;
  }
  return excludes;
}

function walkFiles(rootDir: string, excludedPrefixes: Set<string>, relBase = "", out: string[] = []): string[] {
  const absDir = relBase ? path.join(rootDir, relBase) : rootDir;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (excludedPrefixes.has(rel)) continue;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkFiles(rootDir, excludedPrefixes, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function runGit(rootDir: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", ["-C", rootDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function readGitInfo(rootDir: string): {
  commitSha: string | null;
  branch: string | null;
  remote: string | null;
  scopeRoot: string;
  scopeRootRel: string;
} {
  const commitSha = runGit(rootDir, ["rev-parse", "HEAD"]);
  const branch = runGit(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const topLevel = runGit(rootDir, ["rev-parse", "--show-toplevel"]);
  const scopeRoot = topLevel ? path.resolve(topLevel) : rootDir;
  const relFromTop = path.relative(scopeRoot, rootDir).replace(/\\/g, "/");
  const scopeRootRel = relFromTop && !relFromTop.startsWith("..") ? relFromTop : ".";

  let rawRemote = runGit(rootDir, ["remote", "get-url", "origin"]);
  if (!rawRemote) {
    const remotes = (runGit(rootDir, ["remote"]) ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    if (remotes[0]) {
      rawRemote = runGit(rootDir, ["remote", "get-url", remotes[0]]);
    }
  }
  const remote = canonicalizeGitRemote(rawRemote);

  return { commitSha, branch, remote, scopeRoot, scopeRootRel };
}

function detectEcosystemAndLanguages(allFiles: string[]): { ecosystem: Ecosystem; languages: string[] } {
  const hasTs = allFiles.some((f) => /\.(ts|tsx|mts|cts)$/.test(f)) || allFiles.includes("package.json");
  const hasRust = allFiles.some((f) => f.endsWith(".rs")) || allFiles.includes("Cargo.toml");
  const hasCsharp = allFiles.some((f) => f.endsWith(".cs") || f.endsWith(".csproj") || f.endsWith(".slnx") || f.endsWith(".sln"));

  const languages: string[] = [];
  if (hasTs) languages.push("typescript");
  if (hasRust) languages.push("rust");
  if (hasCsharp) languages.push("csharp");
  if (allFiles.some((f) => f.endsWith(".swift"))) languages.push("swift");
  if (allFiles.some((f) => f.endsWith(".kt"))) languages.push("kotlin");
  if (allFiles.some((f) => f.endsWith(".tf"))) languages.push("hcl");
  if (allFiles.some((f) => f.endsWith(".sql"))) languages.push("sql");
  if (allFiles.some((f) => f.endsWith(".dfy") || f.endsWith(".qnt"))) languages.push("formal");

  const primaryCount = [hasTs, hasRust, hasCsharp].filter(Boolean).length;
  let ecosystem: Ecosystem = "typescript";
  if (primaryCount > 1) {
    if (allFiles.includes("Cargo.toml") && !allFiles.includes("package.json")) ecosystem = "rust";
    else if (hasCsharp && !allFiles.includes("package.json") && !allFiles.includes("Cargo.toml")) ecosystem = "csharp";
    else ecosystem = "polyglot";
  } else if (hasRust) {
    ecosystem = "rust";
  } else if (hasCsharp) {
    ecosystem = "csharp";
  }

  return { ecosystem, languages: languages.sort() };
}

export function discoverRepo(rootDir: string, storageMode: StorageMode): RepoContext {
  const resolved = path.resolve(rootDir);
  const { commitSha, branch, remote, scopeRoot, scopeRootRel } = readGitInfo(resolved);
  const excludedPrefixes = readCargoExcludes(resolved);
  const allFiles = walkFiles(resolved, excludedPrefixes).sort();
  const { ecosystem, languages } = detectEcosystemAndLanguages(allFiles);
  const units = discoverUnits(resolved, allFiles);

  let repoName = path.basename(resolved);
  const pkgPath = path.join(resolved, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name) repoName = pkg.name;
    } catch {
      repoName = path.basename(resolved);
    }
  } else {
    const slnx = allFiles.find((f) => f.endsWith(".slnx") || f.endsWith(".sln"));
    if (slnx && !allFiles.includes("Cargo.toml")) {
      repoName = path.posix.basename(slnx).replace(/\.slnx?$/, "");
    }
  }

  return {
    rootDir: resolved,
    scopeRoot,
    scopeRootRel,
    repoName,
    ecosystem,
    languages,
    commitSha,
    branch,
    remote,
    storageMode,
    allFiles,
    units,
  };
}
