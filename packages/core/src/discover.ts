import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Ecosystem, RepoContext, StorageMode } from "@repospec/plugin";
import { canonicalizeGitRemote, discoverUnits } from "@repospec/plugin";

const ALLOWED_DOT_DIRS = new Set([".github", ".verification", ".husky"]);

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "bin",
  "obj",
  "vendor",
  "venv",
  "Pods",
  "DerivedData",
  "__pycache__",
  "out",
  "output",
  "corpus",
  "reports",
  "feature-map-runs",
  "Claude outputs",
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
      if (entry.name.startsWith(".") && !ALLOWED_DOT_DIRS.has(entry.name)) continue;
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
  const nonTemplateFiles = allFiles.filter((f) => !/^(?:templates|examples|fixtures)\//i.test(f));
  const scanFiles = nonTemplateFiles.length > 0 ? nonTemplateFiles : allFiles;
  const hasTs = scanFiles.some((f) => /\.(ts|tsx|mts|cts)$/.test(f));
  const hasJs = scanFiles.some((f) => /\.(js|jsx|mjs|cjs)$/.test(f)) || (!hasTs && scanFiles.includes("package.json"));
  const hasRust = scanFiles.some((f) => f.endsWith(".rs")) || scanFiles.includes("Cargo.toml");
  const hasPython = scanFiles.some((f) => f.endsWith(".py")) || scanFiles.includes("pyproject.toml");
  const hasCsharp = scanFiles.some((f) => f.endsWith(".cs") || f.endsWith(".csproj") || f.endsWith(".slnx") || f.endsWith(".sln"));

  const languages: string[] = [];
  if (hasTs) languages.push("typescript");
  if (hasJs) languages.push("javascript");
  if (hasRust) languages.push("rust");
  if (hasPython) languages.push("python");
  if (hasCsharp) languages.push("csharp");
  if (scanFiles.some((f) => f.endsWith(".swift"))) languages.push("swift");
  if (scanFiles.some((f) => f.endsWith(".kt"))) languages.push("kotlin");
  if (scanFiles.some((f) => f.endsWith(".tf"))) languages.push("hcl");
  if (scanFiles.some((f) => f.endsWith(".sql") && /(?:^|\/)(?:migrations?|schema|db|sql)\//i.test(f))) {
    languages.push("sql");
  }
  if (scanFiles.some((f) => f.endsWith(".dfy") || f.endsWith(".qnt"))) languages.push("formal");

  const hasNode = hasTs || hasJs;
  const primaryCount = [hasNode, hasRust, hasPython, hasCsharp].filter(Boolean).length;
  let ecosystem: Ecosystem = hasTs ? "typescript" : "javascript";
  if (primaryCount > 1) {
    if (allFiles.includes("Cargo.toml") && !allFiles.includes("package.json") && !allFiles.includes("pyproject.toml")) {
      ecosystem = "rust";
    } else if (hasCsharp && !allFiles.includes("package.json") && !allFiles.includes("Cargo.toml") && !allFiles.includes("pyproject.toml")) {
      ecosystem = "csharp";
    } else if (allFiles.includes("pyproject.toml") && !allFiles.includes("package.json") && !allFiles.includes("Cargo.toml")) {
      ecosystem = "python";
    } else {
      ecosystem = "polyglot";
    }
  } else if (hasRust) {
    ecosystem = "rust";
  } else if (hasPython) {
    ecosystem = "python";
  } else if (hasCsharp) {
    ecosystem = "csharp";
  }

  return { ecosystem, languages: languages.sort() };
}

function readPyprojectName(rootDir: string): string | null {
  const pyPath = path.join(rootDir, "pyproject.toml");
  if (!fs.existsSync(pyPath)) return null;
  try {
    const text = fs.readFileSync(pyPath, "utf8");
    const m = text.match(/\[project\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m?.[1]) return m[1];
    const poetry = text.match(/\[tool\.poetry\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m);
    return poetry?.[1] ?? null;
  } catch {
    return null;
  }
}

function readCargoPackageName(rootDir: string): string | null {
  const cargoPath = path.join(rootDir, "Cargo.toml");
  if (!fs.existsSync(cargoPath)) return null;
  try {
    const text = fs.readFileSync(cargoPath, "utf8");
    const m = text.match(/\[package\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function discoverRepo(rootDir: string, storageMode: StorageMode): RepoContext {
  const resolved = path.resolve(rootDir);
  const { commitSha, branch, remote, scopeRoot, scopeRootRel } = readGitInfo(resolved);
  const excludedPrefixes = readCargoExcludes(resolved);
  const allFiles = walkFiles(resolved, excludedPrefixes).sort();
  const { ecosystem, languages } = detectEcosystemAndLanguages(allFiles);
  const units = discoverUnits(resolved, allFiles);

  const remoteRepoName = remote ? remote.split("/").pop() ?? null : null;
  let repoName = remoteRepoName ?? path.basename(resolved);
  const pkgPath = path.join(resolved, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name) repoName = pkg.name;
    } catch {
      repoName = remoteRepoName ?? path.basename(resolved);
    }
  } else {
    const pyName = readPyprojectName(resolved);
    const cargoName = readCargoPackageName(resolved);
    const slnx = allFiles.find((f) => f.endsWith(".slnx") || f.endsWith(".sln"));
    if (pyName) repoName = pyName;
    else if (cargoName) repoName = cargoName;
    else if (slnx && !allFiles.includes("Cargo.toml")) {
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
