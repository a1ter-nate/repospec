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
import { renderInspectorClientScript } from "./internal/render/inspectorClient.ts";
import { renderNodeInspectorClientScript } from "./internal/render/nodeInspectorClient.ts";
import { buildCompactRenderPayload, escapeHtml } from "./internal/render/payload.ts";
import { renderStageClientScript } from "./internal/render/stageClient.ts";

export function renderVisualHtml(
  spec: RepoSpecV4,
  digest: string,
  options?: { inline?: boolean; drilldown?: DrilldownIndex; commitDiff?: CommitArchDiff; timeline?: ArchTimelineData },
): string {
  const inline = options?.inline ?? false;
  const payload = buildCompactRenderPayload(spec, digest, inline, options?.drilldown, options?.commitDiff, options?.timeline);
  const embeddedJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  const includeSrcBlob = Boolean(options?.drilldown?.sourcesGzipBase64 && (!inline || (options?.drilldown?.files.length ?? 0) <= 160));
  const srcScriptTag = includeSrcBlob
    ? `\n<script id="repospec-src" type="application/octet-stream">${options?.drilldown?.sourcesGzipBase64}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RepoSpec v${escapeHtml(spec.schemaVersion)} · ${escapeHtml(spec.repo.name)}</title>
<style>${renderStudioCss(inline)}</style>
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
    tab: DATA.commitDiff ? "diff" : isLibraryDefault ? "behavior" : "map",
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
    dataSubtab: "entities",
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
  ${renderStageClientScript()}
  ${renderClickClientScript()}
  ${renderEventsClientScript()}
  restoreStateFromHash();
  initLiveWatchStream();
  render();
})();
</script>
</body>
</html>`;
}
