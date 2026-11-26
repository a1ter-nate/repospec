import type { DrilldownIndex } from "../../studio/drilldown.ts";
import type { RankedChangedFile, RankedDiagram } from "./ranking.ts";
import type { TriageResult } from "./triage.ts";

export interface SelectedDiagramShot {
  kind: "diagram";
  ranked: RankedDiagram;
}

export interface SelectedSymbolShot {
  kind: "symbol";
  rankedFile: RankedChangedFile;
}

export interface SelectedIacShot {
  kind: "iac";
  primaryFile: RankedChangedFile;
}

export type SelectedShot = SelectedDiagramShot | SelectedSymbolShot | SelectedIacShot;

export interface SuppressedShot {
  id: string;
  reason: string;
}

export interface ShotSelectionPlan {
  heroShots: SelectedShot[];
  detailShots: SelectedShot[];
  suppressedShots: SuppressedShot[];
}

function diagramHasStructuralDelta(rd: RankedDiagram): boolean {
  if (rd.breakdown.changedEdges > 0) return true;
  if (rd.breakdown.findingsError > 0) return true;
  const changed = rd.overlay.nodes.filter((n) => n.diffStatus !== "unchanged");
  const hasAddedOrRemoved = changed.some((n) => n.diffStatus === "added" || n.diffStatus === "removed");
  if (hasAddedOrRemoved && rd.overlay.edges.length > 0) return true;
  if (changed.length >= 2 && rd.overlay.edges.length > 0) return true;
  return false;
}

export function selectShots(params: {
  triage: TriageResult;
  rankedDiagrams: RankedDiagram[];
  rankedFiles: RankedChangedFile[];
  drilldown?: DrilldownIndex;
  top: number;
  includeTopFile: boolean;
}): ShotSelectionPlan {
  const { triage, rankedDiagrams, rankedFiles, drilldown, top, includeTopFile } = params;
  const heroShots: SelectedShot[] = [];
  const detailShots: SelectedShot[] = [];
  const suppressedShots: SuppressedShot[] = [];
  const drillByPath = new Map((drilldown?.files ?? []).map((f) => [f.p, f]));

  const eligibleDiagrams: RankedDiagram[] = [];
  for (const rd of rankedDiagrams) {
    if (rd.bundle.changedCount === 0) continue;
    if (!diagramHasStructuralDelta(rd)) {
      suppressedShots.push({
        id: rd.bundle.id,
        reason: "No dependency or connected structural delta; suppressed to avoid empty/standalone diagram.",
      });
      continue;
    }
    eligibleDiagrams.push(rd);
  }

  const maxHeroes = Math.min(2, Math.max(1, top));
  for (const rd of eligibleDiagrams.slice(0, maxHeroes)) {
    heroShots.push({ kind: "diagram", ranked: rd });
  }
  for (const rd of eligibleDiagrams.slice(maxHeroes, top)) {
    detailShots.push({ kind: "diagram", ranked: rd });
  }

  if (heroShots.length === 0 && triage.archetype === "iac_sensitive") {
    const primaryIac =
      rankedFiles.find((f) => f.fileClass === "iac" && (f.file.path.endsWith(".tf") || f.file.path.endsWith(".hcl"))) ??
      rankedFiles.find((f) => f.fileClass === "iac");
    if (primaryIac) {
      heroShots.push({ kind: "iac", primaryFile: primaryIac });
    }
  }

  if (includeTopFile) {
    const topSource = rankedFiles.find((f) => {
      if (f.fileClass !== "source") return false;
      const df = drillByPath.get(f.file.path);
      return Boolean(df && df.m && df.m.length > 0);
    });
    if (topSource) {
      if (heroShots.length === 0 && triage.archetype === "symbol") {
        heroShots.push({ kind: "symbol", rankedFile: topSource });
      } else {
        detailShots.push({ kind: "symbol", rankedFile: topSource });
      }
    } else {
      const topAny = rankedFiles[0];
      if (topAny && topAny.fileClass !== "iac") {
        suppressedShots.push({
          id: `file:${topAny.file.path}`,
          reason: "No extracted symbol call graph for top changed file; omitted empty symbol card.",
        });
      }
    }
  }

  return { heroShots, detailShots, suppressedShots };
}
