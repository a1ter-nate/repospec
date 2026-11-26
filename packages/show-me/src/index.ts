import { renderIacCardSvg } from "./internal/iacCardSvg.ts";
import { buildShowMePrComment } from "./internal/markdown.ts";
import { runShowMeBundle, type ShowMeCustomization } from "./internal/runner.ts";
import { selectShots } from "./internal/shots.ts";
import { rasterizeSvgToPng } from "./internal/svgPrimitives.ts";
import { renderDiffDiagramSvg } from "./internal/svgRenderer.ts";
import { triageCommitDiff } from "./internal/triage.ts";

export { rasterizeSvgToPng, renderDiffDiagramSvg, renderIacCardSvg, runShowMeBundle };

export const defaultShowMe = {
  triage: triageCommitDiff,
  selectShots,
  formatComment: buildShowMePrComment,
};

export function defineShowMe(customization: ShowMeCustomization): ShowMeCustomization {
  return customization;
}

export type { FileClass, IacBlockDelta } from "./internal/fileClass.ts";
export type { ShowMeShotRecord } from "./internal/markdown.ts";
export type { FocusMode, ImportanceBreakdown, RankedChangedFile, RankedDiagram, RankPreset } from "./internal/ranking.ts";
export type { ShowMeCustomization, ShowMeFormat, ShowMeHookContext, ShowMeManifest, ShowMeOptions } from "./internal/runner.ts";
export type { SelectedShot, ShotSelectionPlan, SuppressedShot } from "./internal/shots.ts";
export type { ShowMeTheme, ShowMeThemeMode, ThemePalette } from "./internal/svgPrimitives.ts";
export type { AttentionItem, PrArchetype, ReviewLevel, TriageResult } from "./internal/triage.ts";
