import type { RepoSpecV4 } from "./schema.ts";
import type { CommitArchDiff } from "./studio/commitDiff.ts";
import { renderDiffClientScript } from "./studio/diffClient.ts";
import type { DrilldownIndex } from "./studio/drilldown.ts";
import { renderDrilldownClientScript } from "./studio/drilldownClient.ts";
import { renderFileCallGraphClientScript } from "./studio/fileCallGraphClient.ts";
import { renderGuidesClientScript } from "./studio/guides.ts";
import { renderStudioCss } from "./studio/styles.ts";
import { renderSyntaxClientScript } from "./studio/syntaxClient.ts";
import { renderExplainClientScript } from "./ai/explainClient.ts";
import { renderStudioFeaturesClientScript } from "./ai/studioFeaturesClient.ts";
import { renderStudioVizClientScript } from "./ai/studioVizClient.ts";
import type { ArchTimelineData } from "./extractors/gitMetrics.ts";
import { renderClickClientScript } from "./internal/render/clickClient.ts";
import { renderEventsClientScript } from "./internal/render/eventsClient.ts";
import { renderFlowsClientScript } from "./internal/render/flowsClient.ts";
import { renderInspectorClientScript } from "./internal/render/inspectorClient.ts";
import { renderMapFlowsBridgeClientScript } from "./internal/render/mapFlowsBridgeClient.ts";
import { renderNodeInspectorClientScript } from "./internal/render/nodeInspectorClient.ts";
import { buildCompactRenderPayload, escapeHtml } from "./internal/render/payload.ts";
import { renderStageClientScript } from "./internal/render/stageClient.ts";

export interface ReportThemeTokens {
  readonly bg?: string;
  readonly surface?: string;
  readonly panel?: string;
  readonly border?: string;
  readonly text?: string;
  readonly muted?: string;
  readonly accent?: string;
  readonly fontSans?: string;
  readonly fontMono?: string;
}

export interface ReportRenderContext {
  readonly spec: RepoSpecV4;
  readonly digest: string;
  readonly inline: boolean;
  readonly drilldown?: DrilldownIndex;
  readonly commitDiff?: CommitArchDiff;
  readonly timeline?: ArchTimelineData;
}

export interface CustomStudioTab {
  readonly id: string;
  readonly label: string;
  readonly renderHtml: (ctx: ReportRenderContext) => string;
}

export interface ReportCustomization {
  readonly title?: string | ((ctx: ReportRenderContext) => string);
  readonly brandLabel?: string | ((ctx: ReportRenderContext) => string);
  readonly theme?: ReportThemeTokens;
  readonly customCss?: string | ((ctx: ReportRenderContext) => string);
  readonly customHeadHtml?: string | ((ctx: ReportRenderContext) => string);
  readonly customHeaderHtml?: string | ((ctx: ReportRenderContext) => string);
  readonly customBriefingHtml?: string | ((ctx: ReportRenderContext) => string);
  readonly extraTabs?: readonly CustomStudioTab[];
  readonly customClientScript?: string | ((ctx: ReportRenderContext) => string);
  readonly transformPayload?: (
    payload: Record<string, unknown>,
    ctx: ReportRenderContext,
  ) => Record<string, unknown>;
  readonly renderHtml?: (ctx: ReportRenderContext, fallback: () => string) => string;
}

function resolveMaybeFn(
  val: string | ((ctx: ReportRenderContext) => string) | undefined,
  ctx: ReportRenderContext,
): string {
  if (!val) return "";
  return typeof val === "function" ? val(ctx) : val;
}

function buildThemeOverrideCss(theme?: ReportThemeTokens): string {
  if (!theme) return "";
  const vars: string[] = [];
  if (theme.bg) vars.push(`--bg:${theme.bg};`);
  if (theme.surface) vars.push(`--surface:${theme.surface};`);
  if (theme.panel) vars.push(`--panel:${theme.panel};`);
  if (theme.border) vars.push(`--border:${theme.border};`);
  if (theme.text) vars.push(`--text:${theme.text};`);
  if (theme.muted) vars.push(`--muted:${theme.muted};`);
  if (theme.accent) vars.push(`--accent:${theme.accent};`);
  if (theme.fontSans) vars.push(`--font-sans:${theme.fontSans};`);
  if (theme.fontMono) vars.push(`--font-mono:${theme.fontMono};`);
  return vars.length > 0 ? `:root{${vars.join("")}}` : "";
}

export function renderVisualHtml(
  spec: RepoSpecV4,
  digest: string,
  options?: {
    inline?: boolean;
    drilldown?: DrilldownIndex;
    commitDiff?: CommitArchDiff;
    timeline?: ArchTimelineData;
    ui?: ReportCustomization;
  },
): string {
  const inline = options?.inline ?? false;
  const ctx: ReportRenderContext = {
    spec,
    digest,
    inline,
    drilldown: options?.drilldown,
    commitDiff: options?.commitDiff,
    timeline: options?.timeline,
  };
  const ui = options?.ui;

  const renderDefault = (): string => {
    const basePayload = buildCompactRenderPayload(
      spec,
      digest,
      inline,
      options?.drilldown,
      options?.commitDiff,
      options?.timeline,
    );
    const resolvedTabs = (ui?.extraTabs ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      html: t.renderHtml(ctx),
    }));
    const customUi = {
      brandLabel: resolveMaybeFn(ui?.brandLabel, ctx) || undefined,
      headerHtml: resolveMaybeFn(ui?.customHeaderHtml, ctx) || undefined,
      briefingHtml: resolveMaybeFn(ui?.customBriefingHtml, ctx) || undefined,
      extraTabs: resolvedTabs,
    };
    const withUi = { ...basePayload, customUi };
    const payload = ui?.transformPayload ? ui.transformPayload(withUi, ctx) : withUi;
    const embeddedJson = JSON.stringify(payload).replace(/</g, "\\u003c");
    const includeSrcBlob = Boolean(
      options?.drilldown?.sourcesGzipBase64 && (!inline || (options?.drilldown?.files.length ?? 0) <= 160),
    );
    const srcScriptTag = includeSrcBlob
      ? `\n<script id="repospec-src" type="application/octet-stream">${options?.drilldown?.sourcesGzipBase64}</script>`
      : "";
    const pageTitle = resolveMaybeFn(ui?.title, ctx) || `RepoSpec v${spec.schemaVersion} · ${spec.repo.name}`;
    const extraCss = `${buildThemeOverrideCss(ui?.theme)}\n${resolveMaybeFn(ui?.customCss, ctx)}`.trim();
    const extraHead = resolveMaybeFn(ui?.customHeadHtml, ctx);
    const extraScript = resolveMaybeFn(ui?.customClientScript, ctx);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(pageTitle)}</title>
<style>${renderStudioCss(inline)}${extraCss ? `\n${extraCss}` : ""}</style>${extraHead ? `\n${extraHead}` : ""}
</head>
<body>
<div class="app" id="app"></div>
<script id="repospec-data" type="application/json">${embeddedJson}</script>${srcScriptTag}
<script>
(() => {
  const DATA = JSON.parse(document.getElementById("repospec-data").textContent);
  const INLINE = ${inline ? "true" : "false"};

  const nodeById = new Map(DATA.nodes.map((n) => [n.id, n]));
  const diagById = new Map(DATA.diagrams.map((d) => [d.id, d]));
  const invById = new Map(DATA.invariants.map((i) => [i.id, i]));
  const moduleById = new Map((DATA.modules || []).map((m) => [m.id, m]));
  const layerDiagByOwner = new Map();
  const moduleDiagByOwner = new Map();
  for (const d of DATA.diagrams) {
    if (d.category === "layers" && d.ownerId) layerDiagByOwner.set(d.ownerId, d);
    if (d.category === "modules" && d.ownerId) moduleDiagByOwner.set(d.ownerId, d);
  }
  const moduleDiags = DATA.diagrams.filter((d) => d.category === "modules");
  const behaviorDiags = DATA.diagrams.filter((d) => d.category === "behavior");
  const deliveryDiag = DATA.diagrams.find((d) => d.category === "delivery") || null;
  const runtimeDiag = DATA.diagrams.find((d) => d.category === "runtime") || DATA.diagrams[0] || null;
  const packagesDiag = DATA.diagrams.find((d) => d.category === "packages") || null;
  const domainsDiag = DATA.diagrams.find((d) => d.category === "domains") || null;

  const nonTestUnits = DATA.nodes.filter((n) => n.kind === "app" || n.kind === "package" || n.kind === "native_app");
  const isSingleUnitAtlas = nonTestUnits.length <= 1 && moduleDiags.length >= 1;
  const isLibraryDefault =
    !isSingleUnitAtlas &&
    behaviorDiags.length > 0 &&
    DATA.entities.length === 0 &&
    DATA.nodes.filter((n) => n.kind === "app").length <= 1;

  const state = {
    tab: DATA.commitDiff ? "diff" : isLibraryDefault && (DATA.flows?.stateMachines?.length || 0) > 0 ? "flows" : "map",
    mapMode: "runtime",
    viewMode: "flow",
    showAllEdges: false,
    dsmViolOnly: false,
    dataIssuesOnly: false,
    showGuide: false,
    diffMode: "overlay",
    diffDiagramId: DATA.commitDiff?.diagrams?.[0]?.id || null,
    activeLayerDiagId: isSingleUnitAtlas ? moduleDiags[0].id : null,
    activeFolder: null,
    activeFileGraph: null,
    e2eTraceSeed: null,
    canvasLens: "default",
    blastSeedId: null,
    diffSelectedFile: null,
    timelineIdx: null,
    codeFocusLine: 1,
    codeFullFile: false,
    activeBehaviorId: behaviorDiags[0]?.id || null,
    selectedNodeId: null,
    selectedEdgeId: null,
    focusMode: false,
    activeTraceId: null,
    dataFilter: "",
    dataSubtab: (DATA.surfaces?.endpoints?.length || 0) > 0 ? "endpoints" : "entities",
    flowsSubtab: isLibraryDefault && (DATA.flows?.workFlows?.length || 0) === 0 && (DATA.flows?.stateMachines?.length || 0) > 0 ? "machines" : "workflows",
    activeFlowId: null,
    flowMode: "current",
    flowSelectedStepIdx: null,
    flowSelectedHubField: null,
    flowSelectedSmState: null,
    flowSelectedAsyncIdx: null,
    flowHazardsOnly: false,
    flowSearch: "",
    flowCodeFile: null,
    flowCodeLine: 1,
    flowReturnFromMap: false,
    drawerCollapsed: (() => { try { return localStorage.getItem("repospec:drawer-collapsed") === "1"; } catch { return false; } })(),
    drawerWidth: (() => { try { const w = Number(localStorage.getItem("repospec:drawer-w")); return Number.isFinite(w) && w >= 280 ? w : null; } catch { return null; } })(),
    drawerSubtab: null,
    factsKindFilter: "",
    checksFilter: "active",
    search: "",
    tx: 0,
    ty: 0,
    scale: 1,
    fittedDiagId: null,
    justNavigated: false,
  };
  ${renderDrilldownClientScript()}
  ${renderSyntaxClientScript()}
  ${renderExplainClientScript()}
  ${renderFileCallGraphClientScript()}
  ${renderGuidesClientScript()}
  ${renderDiffClientScript()}
  ${renderStudioFeaturesClientScript()}
  ${renderStudioVizClientScript()}

  ${renderInspectorClientScript()}
  ${renderNodeInspectorClientScript()}
  ${renderFlowsClientScript()}
  ${renderMapFlowsBridgeClientScript()}
  ${renderStageClientScript()}
  ${renderClickClientScript()}
  ${renderEventsClientScript()}
  ${extraScript}
  restoreStateFromHash();
  initLiveWatchStream();
  render();
})();
</script>
</body>
</html>`;
  };

  return ui?.renderHtml ? ui.renderHtml(ctx, renderDefault) : renderDefault();
}
