import type { RepoSpecV4 } from "@repospec/plugin";
import type { ChangedFileEntry, CommitArchDiff } from "@repospec/plugin-studio";
import type { DiffDiagramBundle } from "@repospec/plugin-studio";
import type { DrilldownFile, DrilldownIndex } from "@repospec/plugin-studio";
import { classifyFile, detectTestedInPr, type FileClass } from "./fileClass.ts";
import { buildCompactDeltaGraph } from "./layoutFit.ts";

export type RankPreset = "risk" | "hotspot" | "contract" | "blast";
export type FocusMode = "auto" | "always" | "off";
export type RankingSpecSlice = Pick<RepoSpecV4, "verification" | "modules">;

export interface ImportanceBreakdown {
  preset: RankPreset;
  findingsError: number;
  findingsWarn: number;
  tangleCount: number;
  blastRadius: number;
  coveragePct?: number;
  coverageKnown: boolean;
  churn: number;
  locDelta: number;
  contractDelta: number;
  ioRisk: number;
  changedNodes: number;
  changedEdges: number;
  addedEdges: number;
  removedEdges: number;
  reasons: string[];
}

export interface RankedDiagram {
  bundle: DiffDiagramBundle;
  score: number;
  breakdown: ImportanceBreakdown;
  focused: boolean;
  hiddenNodes: number;
  foldedByLane: Record<string, number>;
  overlay: DiffDiagramBundle["overlay"];
}

export interface RankedChangedFile {
  file: ChangedFileEntry;
  fileClass: FileClass;
  score: number;
  churn: number;
  coveragePct?: number;
  coverageKnown: boolean;
  noDirectTest: boolean;
  testedInPr: boolean;
  preexistingDependents: number;
  newWiring: number;
  capabilities: string[];
  findingsCount: number;
  reasons: string[];
}

interface ScoreSignals {
  findingsError: number;
  findingsWarn: number;
  tangleCount: number;
  blastRadius: number;
  coveragePct?: number;
  coverageKnown: boolean;
  churn: number;
  locDelta: number;
  contractDelta: number;
  ioRisk: number;
  changedNodes: number;
  changedEdges: number;
  addedEdges: number;
  removedEdges: number;
}

const STATEFUL_CAPS = new Set(["DB", "HTTP", "PROC", "NET", "WS"]);

export function parseRankPreset(raw?: string): RankPreset {
  if (raw === "hotspot" || raw === "contract" || raw === "blast" || raw === "risk") return raw;
  return "risk";
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function computePresetScore(preset: RankPreset, s: ScoreSignals): number {
  const covGap = s.coverageKnown && s.coveragePct !== undefined ? Math.max(0, 1 - s.coveragePct / 100) : 0.25;
  const logChurn = Math.log2(1 + Math.max(0, s.churn));
  const logLoc = Math.log2(1 + Math.max(0, s.locDelta));

  if (preset === "hotspot") {
    return Math.round(
      (1 + logChurn) * (1 + logLoc) * (0.4 + covGap) * 6 +
        s.blastRadius * 4 +
        s.findingsError * 25 +
        s.findingsWarn * 10 +
        s.changedNodes * 3,
    );
  }
  if (preset === "contract") {
    return Math.round(
      s.contractDelta * 45 +
        s.findingsError * 40 +
        s.findingsWarn * 20 +
        s.changedEdges * 14 +
        s.ioRisk * 12 +
        s.changedNodes * 4 +
        s.blastRadius * 3,
    );
  }
  if (preset === "blast") {
    return Math.round(
      s.blastRadius * 18 +
        s.changedEdges * 12 +
        s.tangleCount * 22 +
        s.changedNodes * 8 +
        s.findingsError * 18 +
        s.findingsWarn * 8,
    );
  }
  return Math.round(
    s.findingsError * 45 +
      s.findingsWarn * 20 +
      s.tangleCount * 18 +
      s.changedEdges * 8 +
      s.blastRadius * (0.35 + covGap) * 6 +
      s.contractDelta * 18 +
      s.ioRisk * 8 +
      logChurn * logLoc * 2.5 +
      s.changedNodes * 6,
  );
}

function buildReasons(s: ScoreSignals): string[] {
  const reasons: string[] = [];
  if (s.findingsError > 0) reasons.push(`${s.findingsError} new violation${s.findingsError === 1 ? "" : "s"}`);
  if (s.findingsWarn > 0) reasons.push(`${s.findingsWarn} new warning${s.findingsWarn === 1 ? "" : "s"}`);
  if (s.tangleCount > 0) reasons.push(`${s.tangleCount} cycle${s.tangleCount === 1 ? "" : "s"}`);
  if (s.contractDelta > 0) reasons.push(`${s.contractDelta} contract change${s.contractDelta === 1 ? "" : "s"}`);
  if (s.addedEdges > 0) reasons.push(`${s.addedEdges} new dep${s.addedEdges === 1 ? "" : "s"}`);
  if (s.removedEdges > 0) reasons.push(`${s.removedEdges} removed dep${s.removedEdges === 1 ? "" : "s"}`);
  if (s.blastRadius > 0) reasons.push(`${s.blastRadius} dependent${s.blastRadius === 1 ? "" : "s"}`);
  if (s.coverageKnown && s.coveragePct !== undefined && s.coveragePct < 50 && s.blastRadius > 0) {
    reasons.push(`${Math.round(s.coveragePct)}% line cov`);
  }
  if (s.ioRisk > 0) reasons.push("stateful IO");
  return reasons.slice(0, 3);
}

function resolveMeasuredCoverage(df: DrilldownFile | undefined, fileClass: FileClass): number | undefined {
  if (fileClass !== "source" || !df) return undefined;
  if (typeof df.fc === "number") return clampPct(df.fc);
  return undefined;
}

export function rankChangedFiles(params: {
  commitDiff: CommitArchDiff;
  headSpec: RankingSpecSlice;
  drilldown?: DrilldownIndex;
  preset: RankPreset;
}): RankedChangedFile[] {
  const { commitDiff, headSpec, drilldown, preset } = params;
  const drillByPath = new Map((drilldown?.files ?? []).map((f) => [f.p, f]));
  const modById = new Map((headSpec.modules ?? []).map((m) => [m.id, m]));
  const testedSet = detectTestedInPr(commitDiff.changedFiles, drilldown);

  const findingsByFile = new Map<string, { err: number; warn: number }>();
  for (const f of commitDiff.findings.introduced) {
    const cur = findingsByFile.get(f.file) ?? { err: 0, warn: 0 };
    if (f.severity === "error") cur.err += 1;
    else cur.warn += 1;
    findingsByFile.set(f.file, cur);
  }

  const ranked = commitDiff.changedFiles.map((cf): RankedChangedFile => {
    const fileClass = classifyFile(cf.path);
    const df = drillByPath.get(cf.path);
    const mod = cf.moduleId ? modById.get(cf.moduleId) : undefined;
    const fStats = findingsByFile.get(cf.path) ?? { err: 0, warn: 0 };
    const isCode = fileClass === "source";
    const isRiskBearing = fileClass === "source" || fileClass === "iac" || fileClass === "contract" || fileClass === "fixture";

    const capabilities = isCode && df ? df.c : [];
    const ioRisk = isCode ? capabilities.filter((c) => STATEFUL_CAPS.has(c)).length : 0;
    const testedInPr = testedSet.has(cf.path);
    const coveragePct = resolveMeasuredCoverage(df, fileClass);
    const coverageKnown = coveragePct !== undefined;
    const noDirectTest = isCode && !testedInPr && df?.tc === 0 && !coverageKnown;

    const preexistingDependents = cf.status === "added" ? 0 : cf.blastRadius;
    const newWiring = cf.status === "added" ? cf.blastRadius : 0;
    const churn = isCode || fileClass === "iac" ? (df?.ch ?? 0) : 0;
    const locDelta = isCode || fileClass === "iac" ? cf.insertions + cf.deletions : 0;
    const contractDelta =
      fileClass === "contract" || fileClass === "fixture"
        ? 1
        : isCode && ((df?.t.length ?? 0) > 0 || (df?.x.length ?? 0) > 0)
          ? 1
          : 0;

    const signals: ScoreSignals = {
      findingsError: fStats.err,
      findingsWarn: fStats.warn,
      tangleCount: isCode && mod?.inTangle ? 1 : 0,
      blastRadius: preexistingDependents,
      coveragePct,
      coverageKnown,
      churn,
      locDelta,
      contractDelta,
      ioRisk,
      changedNodes: isRiskBearing ? 1 : 0,
      changedEdges: 0,
      addedEdges: 0,
      removedEdges: 0,
    };

    const rawScore = isRiskBearing ? computePresetScore(preset, signals) : 0;
    const score = fileClass === "source" && cf.status === "added" ? rawScore + Math.min(12, newWiring * 2) : rawScore;

    return {
      file: cf,
      fileClass,
      score,
      churn,
      coveragePct,
      coverageKnown,
      noDirectTest,
      testedInPr,
      preexistingDependents,
      newWiring,
      capabilities,
      findingsCount: fStats.err + fStats.warn,
      reasons: buildReasons(signals),
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.preexistingDependents !== a.preexistingDependents) return b.preexistingDependents - a.preexistingDependents;
    return a.file.path.localeCompare(b.file.path);
  });
  return ranked;
}

export function rankDiffDiagrams(params: {
  commitDiff: CommitArchDiff;
  headSpec: RankingSpecSlice;
  drilldown?: DrilldownIndex;
  preset: RankPreset;
  focusMode: FocusMode;
  topFileHint?: { moduleId: string | null; fileName: string };
}): RankedDiagram[] {
  const { commitDiff, headSpec, drilldown, preset, focusMode, topFileHint } = params;
  const drillByPath = new Map((drilldown?.files ?? []).map((f) => [f.p, f]));
  const modById = new Map((headSpec.modules ?? []).map((m) => [m.id, m]));

  const surfaceContractDelta =
    commitDiff.surfaces.endpointsAdded.length +
    commitDiff.surfaces.endpointsRemoved.length +
    commitDiff.surfaces.entitiesAdded.length +
    commitDiff.surfaces.entitiesRemoved.length +
    commitDiff.surfaces.externalAdded.length +
    commitDiff.surfaces.externalRemoved.length +
    commitDiff.surfaces.envAdded.length +
    commitDiff.surfaces.envRemoved.length;

  const ranked = commitDiff.diagrams.map((bundle): RankedDiagram => {
    const changedNodes = bundle.overlay.nodes.filter((n) => n.diffStatus !== "unchanged");
    const addedEdges = bundle.overlay.edges.filter((e) => e.diffStatus === "added").length;
    const removedEdges = bundle.overlay.edges.filter((e) => e.diffStatus === "removed").length;
    const changedEdges = addedEdges + removedEdges;
    const changedNodeIds = new Set(changedNodes.map((n) => n.id));
    const isRuntime = bundle.id === "diff:runtime";
    const unitSlug = bundle.id.startsWith("diff:modules:") ? bundle.id.slice("diff:modules:".length) : "";

    const matchingFiles = commitDiff.changedFiles.filter((cf) => {
      if (isRuntime) return true;
      if (cf.moduleId && changedNodeIds.has(cf.moduleId)) return true;
      return Boolean(unitSlug && cf.unitSlug === unitSlug);
    });
    const matchingPaths = new Set(matchingFiles.map((f) => f.path));

    let findingsError = 0;
    let findingsWarn = 0;
    for (const f of commitDiff.findings.introduced) {
      if (isRuntime || matchingPaths.has(f.file)) {
        if (f.severity === "error") findingsError += 1;
        else findingsWarn += 1;
      }
    }

    let tangleCount = 0;
    let maxBlast = 0;
    let ioRisk = 0;
    const seenTangles = new Set<string>();
    for (const n of changedNodes) {
      const mod = modById.get(n.id);
      if (!mod) continue;
      if (mod.inTangle && mod.tangleId && !seenTangles.has(mod.tangleId)) {
        seenTangles.add(mod.tangleId);
        tangleCount += 1;
      }
    }

    let churnTotal = 0;
    let locDelta = 0;
    let covSum = 0;
    let covCount = 0;
    let fileContractHits = 0;
    for (const cf of matchingFiles) {
      const cls = classifyFile(cf.path);
      const df = drillByPath.get(cf.path);
      const fileSurfaceRefs = (df?.t.length ?? 0) + (df?.x.length ?? 0);
      if (cls === "contract" || cls === "fixture" || (cls === "source" && fileSurfaceRefs > 0)) {
        fileContractHits += 1;
      }
      if (cls !== "source" && cls !== "iac") continue;
      if (cf.status !== "added") maxBlast = Math.max(maxBlast, cf.blastRadius);
      churnTotal += df?.ch ?? 0;
      locDelta += cf.insertions + cf.deletions;
      if (cls === "source" && df) {
        ioRisk += df.c.filter((c) => STATEFUL_CAPS.has(c)).length;
        if (typeof df.fc === "number") {
          covSum += clampPct(df.fc);
          covCount += 1;
        }
      }
    }

    const coverageKnown = covCount > 0;
    const coveragePct = coverageKnown ? clampPct(covSum / covCount) : undefined;
    const boundedSurfaceDelta = Math.min(surfaceContractDelta, fileContractHits);
    const contractDelta = (isRuntime ? surfaceContractDelta : boundedSurfaceDelta) + fileContractHits;

    const signals: ScoreSignals = {
      findingsError,
      findingsWarn,
      tangleCount,
      blastRadius: maxBlast,
      coveragePct,
      coverageKnown,
      churn: churnTotal,
      locDelta,
      contractDelta,
      ioRisk,
      changedNodes: changedNodes.length,
      changedEdges,
      addedEdges,
      removedEdges,
    };

    const score = bundle.changedCount === 0 ? 0 : computePresetScore(preset, signals);
    const compact = buildCompactDeltaGraph(bundle.overlay, focusMode, topFileHint);

    return {
      bundle,
      score,
      breakdown: {
        preset,
        ...signals,
        reasons: buildReasons(signals),
      },
      focused: compact.focused,
      hiddenNodes: compact.hiddenNodes,
      foldedByLane: compact.foldedByLane,
      overlay: compact.overlay,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.bundle.changedCount !== a.bundle.changedCount) return b.bundle.changedCount - a.bundle.changedCount;
    return a.bundle.id.localeCompare(b.bundle.id);
  });
  return ranked;
}
