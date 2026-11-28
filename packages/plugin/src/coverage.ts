import fs from "node:fs";
import path from "node:path";
import type { VerificationCoverage } from "./schema.ts";

export interface RealCoverageReport {
  source: "lcov" | "istanbul" | "cobertura";
  reportFile: string;
  linePct: number;
  branchPct: number | null;
  fileLinePct: Map<string, number>;
}

function normalizeCoveragePath(rawPath: string, repoRoot: string): string {
  const unified = rawPath.replace(/\\/g, "/").trim();
  const rootUnified = path.resolve(repoRoot).replace(/\\/g, "/");
  if (unified.startsWith(`${rootUnified}/`)) {
    return unified.slice(rootUnified.length + 1);
  }
  return unified.replace(/^\.\//, "");
}

function roundPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function parseLcov(text: string, repoRoot: string, reportFile: string): RealCoverageReport | null {
  let currentFile: string | null = null;
  let curLf = 0;
  let curLh = 0;
  let totalLf = 0;
  let totalLh = 0;
  let totalBrf = 0;
  let totalBrh = 0;
  const fileLinePct = new Map<string, number>();

  const flushFile = (): void => {
    if (!currentFile) return;
    if (curLf > 0) {
      fileLinePct.set(currentFile, roundPct((curLh / curLf) * 100));
    }
    currentFile = null;
    curLf = 0;
    curLh = 0;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      flushFile();
      currentFile = normalizeCoveragePath(line.slice(3), repoRoot);
    } else if (line.startsWith("LF:")) {
      const n = Number.parseInt(line.slice(3), 10) || 0;
      curLf += n;
      totalLf += n;
    } else if (line.startsWith("LH:")) {
      const n = Number.parseInt(line.slice(3), 10) || 0;
      curLh += n;
      totalLh += n;
    } else if (line.startsWith("BRF:")) {
      totalBrf += Number.parseInt(line.slice(4), 10) || 0;
    } else if (line.startsWith("BRH:")) {
      totalBrh += Number.parseInt(line.slice(4), 10) || 0;
    } else if (line === "end_of_record") {
      flushFile();
    }
  }
  flushFile();

  if (totalLf === 0 && fileLinePct.size === 0) return null;
  const linePct = totalLf > 0 ? roundPct((totalLh / totalLf) * 100) : 0;
  const branchPct = totalBrf > 0 ? roundPct((totalBrh / totalBrf) * 100) : null;
  return { source: "lcov", reportFile, linePct, branchPct, fileLinePct };
}

function parseIstanbulSummary(text: string, repoRoot: string, reportFile: string): RealCoverageReport | null {
  try {
    const parsed = JSON.parse(text) as Record<
      string,
      { lines?: { pct?: number }; branches?: { pct?: number } }
    >;
    const total = parsed.total;
    if (!total || typeof total.lines?.pct !== "number") return null;
    const fileLinePct = new Map<string, number>();
    for (const [k, v] of Object.entries(parsed)) {
      if (k === "total") continue;
      if (typeof v?.lines?.pct === "number") {
        fileLinePct.set(normalizeCoveragePath(k, repoRoot), roundPct(v.lines.pct));
      }
    }
    return {
      source: "istanbul",
      reportFile,
      linePct: roundPct(total.lines.pct),
      branchPct: typeof total.branches?.pct === "number" ? roundPct(total.branches.pct) : null,
      fileLinePct,
    };
  } catch {
    return null;
  }
}

function parseCoberturaXml(text: string, repoRoot: string, reportFile: string): RealCoverageReport | null {
  const covTag = text.match(/<coverage\b[^>]*>/i)?.[0];
  if (!covTag) return null;
  const lineRateMatch = covTag.match(/\bline-rate\s*=\s*["']([0-9.]+)["']/i);
  const branchRateMatch = covTag.match(/\bbranch-rate\s*=\s*["']([0-9.]+)["']/i);
  if (!lineRateMatch?.[1]) return null;
  const lineRate = Number.parseFloat(lineRateMatch[1]);
  if (Number.isNaN(lineRate)) return null;

  const fileLinePct = new Map<string, number>();
  for (const m of text.matchAll(/<class\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const tag = m[0];
    const filename = m[1];
    const clsRate = tag.match(/\bline-rate\s*=\s*["']([0-9.]+)["']/i)?.[1];
    if (filename && clsRate) {
      const rate = Number.parseFloat(clsRate);
      if (!Number.isNaN(rate)) {
        fileLinePct.set(normalizeCoveragePath(filename, repoRoot), roundPct(rate * 100));
      }
    }
  }

  const branchPct =
    branchRateMatch?.[1] && !Number.isNaN(Number.parseFloat(branchRateMatch[1]))
      ? roundPct(Number.parseFloat(branchRateMatch[1]) * 100)
      : null;

  return {
    source: "cobertura",
    reportFile,
    linePct: roundPct(lineRate * 100),
    branchPct,
    fileLinePct,
  };
}

function findNestedCobertura(rootDir: string, depthMax = 4): string | null {
  const skip = new Set([".git", "node_modules", "dist", "target", ".next"]);
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
  const matches: Array<{ rel: string; mtimeMs: number }> = [];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    if (!cur) break;
    const abs = cur.rel ? path.join(rootDir, cur.rel) : rootDir;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = cur.rel ? `${cur.rel}/${entry.name}` : entry.name;
      if (entry.isFile() && /^coverage\.cobertura\.xml$|^cobertura-coverage\.xml$/i.test(entry.name)) {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(path.join(rootDir, rel)).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        matches.push({ rel, mtimeMs });
      }
      if (entry.isDirectory() && cur.depth < depthMax && !skip.has(entry.name)) {
        queue.push({ rel, depth: cur.depth + 1 });
      }
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel));
  return matches[0]?.rel ?? null;
}

export function discoverRealCoverageReport(repoRoot: string): RealCoverageReport | null {
  const lcovCandidates = ["coverage/lcov.info", "lcov.info"];
  for (const rel of lcovCandidates) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) {
      const parsed = parseLcov(fs.readFileSync(abs, "utf8"), repoRoot, rel);
      if (parsed) return parsed;
    }
  }

  const istanbulCandidates = ["coverage/coverage-summary.json", "coverage-summary.json"];
  for (const rel of istanbulCandidates) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) {
      const parsed = parseIstanbulSummary(fs.readFileSync(abs, "utf8"), repoRoot, rel);
      if (parsed) return parsed;
    }
  }

  const coberturaRel = findNestedCobertura(repoRoot);
  if (coberturaRel) {
    const abs = path.join(repoRoot, coberturaRel);
    if (fs.existsSync(abs)) {
      const parsed = parseCoberturaXml(fs.readFileSync(abs, "utf8"), repoRoot, coberturaRel);
      if (parsed) return parsed;
    }
  }

  return null;
}

export function resolveCoveragePctForFile(
  filePath: string,
  realCoverage: RealCoverageReport | null | undefined,
): number | undefined {
  if (!realCoverage) return undefined;
  const exact = realCoverage.fileLinePct.get(filePath);
  if (exact !== undefined) return exact;
  for (const [covKey, pct] of realCoverage.fileLinePct) {
    if (filePath.endsWith(`/${covKey}`) || covKey.endsWith(`/${filePath}`)) {
      return pct;
    }
  }
  return undefined;
}

export function buildVerificationScopeSummary(v: VerificationCoverage): {
  coverage: {
    source: string;
    realLineCoveragePct: number | null;
    realBranchCoveragePct: number | null;
    staticReachability1HopPct: number;
    reportFile: string | null;
  };
  invariants: {
    fail: number;
    warn: number;
    pass: number;
    na: number;
    total: number;
  };
  note: string;
} {
  const source = v.coverageSource ?? "static_reachability_1hop";
  const realLine = v.realLineCoveragePct ?? null;
  const realBranch = v.realBranchCoveragePct ?? null;
  const total = v.invariantsFailed + v.invariantsWarned + v.invariantsPassed + v.invariantsNa;
  const parts: string[] = [];
  if (realLine !== null) {
    parts.push(`Ingested ${source} execution coverage (${realLine}% lines${realBranch !== null ? `, ${realBranch}% branches` : ""}).`);
  } else {
    parts.push(`No runtime coverage report ingested; reporting static 1-hop test import reachability (${v.directTestCoveragePct}%) only.`);
  }
  if (v.invariantsNa > 0) {
    parts.push(`${v.invariantsNa} of ${total} structural invariants were N/A (${v.invariantsPassed} passed, ${v.invariantsWarned} warned, ${v.invariantsFailed} failed).`);
  }
  parts.push("Structural graph + coverage only; cross-repo wire contracts & behavioral semantics require runtime E2E/contract proofs.");
  return {
    coverage: {
      source,
      realLineCoveragePct: realLine,
      realBranchCoveragePct: realBranch,
      staticReachability1HopPct: v.directTestCoveragePct,
      reportFile: v.coverageReportFile ?? null,
    },
    invariants: {
      fail: v.invariantsFailed,
      warn: v.invariantsWarned,
      pass: v.invariantsPassed,
      na: v.invariantsNa,
      total,
    },
    note: parts.join(" "),
  };
}
