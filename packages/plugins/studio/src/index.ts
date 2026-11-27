import { Plugin, type AstIndexData, type RealCoverageReport, type RepoSpecV4, type UnitDescriptor } from "@repospec/plugin";
import { startStudioServer } from "./ai/studioServer.ts";
import { buildArchTimeline, extractGitChurnMap, extractUnifiedDiffHunks, type ArchTimelineData } from "./gitMetrics.ts";
import { buildChecksModel, classifyCheckTier, FIX_NEXT_HIT_LIMIT, type ChecksSpecInput } from "./render/checksModel.ts";
import {
  buildSurfacesModel,
  classifyEndpointGuard,
  normalizeEntityKey,
  type SurfacesSpecInput,
} from "./render/surfacesModel.ts";
import {
  renderVisualHtml,
  type CustomStudioTab,
  type ReportCustomization,
  type ReportRenderContext,
  type ReportThemeTokens,
} from "./render.ts";
import {
  buildCommitArchDiff,
  resolveGitDiffRange,
  type ChangedFileEntry,
  type CommitArchDiff,
  type FindingDeltaItem,
} from "./studio/commitDiff.ts";
import {
  buildOverlayBundle,
  type DiffDiagramBundle,
  type DiffDiagramEdge,
  type DiffDiagramNode,
} from "./studio/diffOverlay.ts";
import { runCommitDiffWorktrees } from "./studio/diffRunner.ts";
import { buildDrilldownIndex, type DrilldownFile, type DrilldownIndex } from "./studio/drilldown.ts";
import { extractFileCallGraph, packSourceArchiveBase64, type FileSymbolTuple } from "./studio/fileSymbols.ts";

export {
  buildArchTimeline,
  buildChecksModel,
  buildCommitArchDiff,
  buildDrilldownIndex,
  buildOverlayBundle,
  buildSurfacesModel,
  classifyCheckTier,
  classifyEndpointGuard,
  extractFileCallGraph,
  extractGitChurnMap,
  extractUnifiedDiffHunks,
  FIX_NEXT_HIT_LIMIT,
  normalizeEntityKey,
  packSourceArchiveBase64,
  renderVisualHtml,
  resolveGitDiffRange,
  runCommitDiffWorktrees,
  startStudioServer,
};

export type {
  ArchTimelineData,
  ChangedFileEntry,
  ChecksSpecInput,
  CommitArchDiff,
  CustomStudioTab,
  DiffDiagramBundle,
  DiffDiagramEdge,
  DiffDiagramNode,
  DrilldownFile,
  DrilldownIndex,
  FileSymbolTuple,
  FindingDeltaItem,
  ReportCustomization,
  ReportRenderContext,
  ReportThemeTokens,
  SurfacesSpecInput,
};

export const studioPlugin = Plugin.define({
  id: "repospec.studio",
  async setup(ctx) {
    await ctx.studio.transform((ed) => {
      ed.setRenderer?.({
        id: "repospec.studio.html",
        renderVisualHtml: (spec: RepoSpecV4, digest: string, opts?: Record<string, unknown>) =>
          renderVisualHtml(spec, digest, opts as Parameters<typeof renderVisualHtml>[2]),
        buildDrilldownIndex: (
          units: UnitDescriptor[],
          ast: AstIndexData,
          rootDir: string,
          realCoverage: unknown,
          extraFiles?: readonly string[],
        ) => buildDrilldownIndex(units, ast, rootDir, (realCoverage ?? null) as RealCoverageReport | null, extraFiles),
      });
    });
  },
});

export default studioPlugin;
