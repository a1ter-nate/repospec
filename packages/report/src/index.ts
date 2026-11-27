import {
  renderVisualHtml,
  type CustomStudioTab,
  type ReportCustomization,
  type ReportRenderContext,
  type ReportThemeTokens,
} from "@repospec/plugin-studio";

export { renderVisualHtml };
export type { CustomStudioTab, ReportCustomization, ReportRenderContext, ReportThemeTokens };

export const defaultReport: ReportCustomization = {};

export function defineReport(customization: ReportCustomization): ReportCustomization {
  return customization;
}

export function renderReportHtml(
  ctx: ReportRenderContext,
  customization?: ReportCustomization,
): string {
  return renderVisualHtml(ctx.spec, ctx.digest, {
    inline: ctx.inline,
    drilldown: ctx.drilldown,
    commitDiff: ctx.commitDiff,
    timeline: ctx.timeline,
    ui: customization,
  });
}
