import type { RepoSpecV4 } from "../../schema.ts";
import type { ChangedFileEntry, CommitArchDiff } from "../../studio/commitDiff.ts";
import type { DiffDiagramBundle, DiffDiagramEdge, DiffDiagramNode } from "../../studio/diffOverlay.ts";
import type { DrilldownFile, DrilldownIndex } from "../../studio/drilldown.ts";

export type RankPreset = "risk" | "hotspot" | "contract" | "blast";
export type FocusMode = "auto" | "always" | "off";
export type PriorityTier = "P0" | "P1" | "P2" | "P3";
export type RankingSpecSlice = Pick<RepoSpecV4, "verification" | "modules">;

export interface ImportanceBreakdown {
  preset: RankPreset;
  findingsError: number;
  findingsWarn: number;
  tangleCount: number;
  blastRadius: number;
  coveragePct: number;
  coverageGapPct: number;
  churn: number;
  locDelta: number;
  contractDelta: number;
  ioRisk: number;
  changedNodes: number;
  changedEdges: number;
  reasons: string[];
}

export interface CroppedOverlayResult {
  overlay: DiffDiagramBundle["overlay"];
  focused: boolean;
  hiddenNodes: number;
}

export interface RankedDiagram {
  bundle: DiffDiagramBundle;
  score: number;
  priority: PriorityTier;
  breakdown: ImportanceBreakdown;
  focused: boolean;
  hiddenNodes: number;
  overlay: DiffDiagramBundle["overlay"];
}

export interface RankedChangedFile {
  file: ChangedFileEntry;
  score: number;
  priority: PriorityTier;
  churn: number;
  coveragePct: number;
  capabilities: string[];
  findingsCount: number;
  reasons: string[];
}

interface ScoreSignals {
  findingsError: number;
  findingsWarn: number;
  tangleCount: number;
  blastRadius: number;
  coveragePct: number;
  churn: number;
  locDelta: number;
  contractDelta: number;
  ioRisk: number;
  changedNodes: number;
  changedEdges: number;
}

const STATEFUL_CAPS = new Set(["DB", "HTTP", "PROC", "NET", "WS"]);

export function parseRankPreset(raw?: string): RankPreset {
  if (raw === "hotspot" || raw === "contract" || raw === "blast" || raw === "risk") return raw;
  return "risk";
}

export function priorityTierForScore(score: number): PriorityTier {
  if (score >= 80) return "P0";
  if (score >= 45) return "P1";
  if (score >= 20) return "P2";
  return "P3";
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function computePresetScore(preset: RankPreset, s: ScoreSignals): number {
  const covGap = Math.max(0, 1 - s.coveragePct / 100);
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
  if (s.findingsError > 0) reasons.push(`${s.findingsError} new error${s.findingsError === 1 ? "" : "s"}`);
  if (s.findingsWarn > 0) reasons.push(`${s.findingsWarn} new warn${s.findingsWarn === 1 ? "" : "s"}`);
  if (s.tangleCount > 0) reasons.push(`${s.tangleCount} tangle${s.tangleCount === 1 ? "" : "s"}`);
  if (s.contractDelta > 0) reasons.push(`${s.contractDelta} contract/surface delta`);
  if (s.blastRadius > 0) reasons.push(`${s.blastRadius} caller${s.blastRadius === 1 ? "" : "s"}`);
  if (s.coveragePct < 50 && (s.blastRadius > 0 || s.locDelta > 10)) reasons.push(`${Math.round(s.coveragePct)}% cov`);
  if (s.churn >= 3) reasons.push(`churn ${s.churn}`);
  if (s.ioRisk > 0) reasons.push("stateful IO");
  if (s.changedEdges > 0) reasons.push(`${s.changedEdges} wire delta`);
  if (reasons.length === 0 && s.locDelta > 0) reasons.push(`${s.locDelta} LOC delta`);
  return reasons.slice(0, 4);
}

function resolveFileCoveragePct(df: DrilldownFile | undefined, fallbackPct: number): number {
  if (!df) return clampPct(fallbackPct);
  if (typeof df.fc === "number") return clampPct(df.fc);
  if (df.tc === 1) return 100;
  if (df.tc === 0) return 0;
  return clampPct(fallbackPct);
}

export function cropFocusedSubgraph(
  overlay: DiffDiagramBundle["overlay"],
  focusMode: FocusMode,
  autoThreshold = 14,
): CroppedOverlayResult {
  const changedIds = new Set(overlay.nodes.filter((n) => n.diffStatus !== "unchanged").map((n) => n.id));
  const shouldFocus =
    changedIds.size > 0 &&
    (focusMode === "always" || (focusMode === "auto" && overlay.nodes.length > autoThreshold));
  if (!shouldFocus) return { overlay, focused: false, hiddenNodes: 0 };

  const keptIds = new Set<string>(changedIds);
  for (const e of overlay.edges) {
    if (changedIds.has(e.from) || changedIds.has(e.to)) {
      keptIds.add(e.from);
      keptIds.add(e.to);
    }
  }

  const keptNodes = overlay.nodes.filter((n) => keptIds.has(n.id));
  const hiddenNodes = overlay.nodes.length - keptNodes.length;
  if (hiddenNodes <= 0 || keptNodes.length === 0) return { overlay, focused: false, hiddenNodes: 0 };

  const keptEdges = overlay.edges.filter((e) => changedIds.has(e.from) || changedIds.has(e.to));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const n of keptNodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  for (const e of keptEdges) {
    for (const pt of e.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }

  const padX = 44;
  const padTop = 54;
  const shiftX = padX - minX;
  const shiftY = padTop - minY;

  const shiftedNodes: DiffDiagramNode[] = keptNodes.map((n) => ({
    ...n,
    x: Math.round((n.x + shiftX) * 10) / 10,
    y: Math.round((n.y + shiftY) * 10) / 10,
  }));
  const shiftedEdges: DiffDiagramEdge[] = keptEdges.map((e) => ({
    ...e,
    points: e.points.map((pt) => ({
      x: Math.round((pt.x + shiftX) * 10) / 10,
      y: Math.round((pt.y + shiftY) * 10) / 10,
    })),
  }));

  const laneBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const n of shiftedNodes) {
    if (!n.lane) continue;
    const cur = laneBounds.get(n.lane) ?? {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    };
    cur.minX = Math.min(cur.minX, n.x - n.w / 2);
    cur.minY = Math.min(cur.minY, n.y - n.h / 2);
    cur.maxX = Math.max(cur.maxX, n.x + n.w / 2);
    cur.maxY = Math.max(cur.maxY, n.y + n.h / 2);
    laneBounds.set(n.lane, cur);
  }

  const shiftedLanes = (overlay.lanes ?? [])
    .filter((l) => laneBounds.has(l.id))
    .map((l) => {
      const b = laneBounds.get(l.id);
      if (!b) return l;
      return {
        ...l,
        x: Math.max(8, Math.round(b.minX - 16)),
        y: Math.max(8, Math.round(b.minY - 34)),
        w: Math.round(b.maxX - b.minX + 32),
        h: Math.round(b.maxY - b.minY + 52),
      };
    });

  return {
    overlay: {
      ...overlay,
      width: Math.max(360, Math.round(maxX - minX + padX * 2)),
      height: Math.max(220, Math.round(maxY - minY + padTop + 36)),
      lanes: shiftedLanes,
      nodes: shiftedNodes,
      edges: shiftedEdges,
    },
    focused: true,
    hiddenNodes,
  };
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
  const fallbackCov = headSpec.verification.realLineCoveragePct ?? headSpec.verification.directTestCoveragePct;

  const findingsByFile = new Map<string, { err: number; warn: number }>();
  for (const f of commitDiff.findings.introduced) {
    const cur = findingsByFile.get(f.file) ?? { err: 0, warn: 0 };
    if (f.severity === "error") cur.err += 1;
    else cur.warn += 1;
    findingsByFile.set(f.file, cur);
  }

  const ranked = commitDiff.changedFiles.map((cf): RankedChangedFile => {
    const df = drillByPath.get(cf.path);
    const mod = cf.moduleId ? modById.get(cf.moduleId) : undefined;
    const fStats = findingsByFile.get(cf.path) ?? { err: 0, warn: 0 };
    const capabilities = df?.c ?? mod?.capabilities ?? ["PURE"];
    const signals: ScoreSignals = {
      findingsError: fStats.err,
      findingsWarn: fStats.warn,
      tangleCount: mod?.inTangle ? 1 : 0,
      blastRadius: cf.blastRadius,
      coveragePct: resolveFileCoveragePct(df, fallbackCov),
      churn: df?.ch ?? 0,
      locDelta: cf.insertions + cf.deletions,
      contractDelta: (df?.t.length ?? 0) > 0 || (df?.x.length ?? 0) > 0 ? 1 : 0,
      ioRisk: capabilities.filter((c) => STATEFUL_CAPS.has(c)).length,
      changedNodes: 1,
      changedEdges: 0,
    };
    const score = computePresetScore(preset, signals);
    return {
      file: cf,
      score,
      priority: priorityTierForScore(score),
      churn: signals.churn,
      coveragePct: signals.coveragePct,
      capabilities,
      findingsCount: fStats.err + fStats.warn,
      reasons: buildReasons(signals),
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.file.blastRadius !== a.file.blastRadius) return b.file.blastRadius - a.file.blastRadius;
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
}): RankedDiagram[] {
  const { commitDiff, headSpec, drilldown, preset, focusMode } = params;
  const drillByPath = new Map((drilldown?.files ?? []).map((f) => [f.p, f]));
  const modById = new Map((headSpec.modules ?? []).map((m) => [m.id, m]));
  const fallbackCov = headSpec.verification.realLineCoveragePct ?? headSpec.verification.directTestCoveragePct;

  const totalContractDelta =
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
    const changedEdges = bundle.overlay.edges.filter((e) => e.diffStatus !== "unchanged");
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
      maxBlast = Math.max(maxBlast, mod.fanIn);
      if (mod.inTangle && mod.tangleId && !seenTangles.has(mod.tangleId)) {
        seenTangles.add(mod.tangleId);
        tangleCount += 1;
      }
      ioRisk += mod.capabilities.filter((c) => STATEFUL_CAPS.has(c)).length;
    }

    let churnTotal = 0;
    let locDelta = 0;
    let covSum = 0;
    for (const cf of matchingFiles) {
      const df = drillByPath.get(cf.path);
      maxBlast = Math.max(maxBlast, cf.blastRadius);
      churnTotal += df?.ch ?? 0;
      locDelta += cf.insertions + cf.deletions;
      covSum += resolveFileCoveragePct(df, fallbackCov);
    }
    const coveragePct = matchingFiles.length > 0 ? clampPct(covSum / matchingFiles.length) : clampPct(fallbackCov);
    const contractDelta = isRuntime
      ? totalContractDelta
      : Math.min(
          totalContractDelta,
          matchingFiles.filter((f) => (drillByPath.get(f.path)?.t.length ?? 0) > 0 || (drillByPath.get(f.path)?.x.length ?? 0) > 0)
            .length,
        );

    const signals: ScoreSignals = {
      findingsError,
      findingsWarn,
      tangleCount,
      blastRadius: maxBlast,
      coveragePct,
      churn: churnTotal,
      locDelta,
      contractDelta,
      ioRisk,
      changedNodes: changedNodes.length,
      changedEdges: changedEdges.length,
    };
    const score = bundle.changedCount === 0 ? 0 : computePresetScore(preset, signals);
    const cropped = cropFocusedSubgraph(bundle.overlay, focusMode);

    return {
      bundle,
      score,
      priority: priorityTierForScore(score),
      breakdown: {
        preset,
        ...signals,
        coverageGapPct: clampPct(100 - coveragePct),
        reasons: buildReasons(signals),
      },
      focused: cropped.focused,
      hiddenNodes: cropped.hiddenNodes,
      overlay: cropped.overlay,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.bundle.changedCount !== a.bundle.changedCount) return b.bundle.changedCount - a.bundle.changedCount;
    return a.bundle.id.localeCompare(b.bundle.id);
  });
  return ranked;
}
