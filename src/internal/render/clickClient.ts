export function renderClickClientScript(): string {
  return `
  appEl.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (state.search && !target.closest(".search-wrap")) {
      state.search = "";
      const dd = document.getElementById("search-dd");
      if (dd) dd.classList.remove("open");
    }

    const tabBtn = target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.getAttribute("data-tab") || "map";
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.activeFileGraph = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const mapModeBtn = target.closest("[data-map-mode]");
    if (mapModeBtn) {
      state.mapMode = mapModeBtn.getAttribute("data-map-mode") || "runtime";
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.activeFileGraph = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const viewModeBtn = target.closest("[data-view-mode]");
    if (viewModeBtn) {
      state.viewMode = viewModeBtn.getAttribute("data-view-mode") || "flow";
      state.focusMode = false;
      render();
      return;
    }

    if (target.closest("[data-toggle-wires]")) {
      state.showAllEdges = !state.showAllEdges;
      render();
      return;
    }

    const behBtn = target.closest("[data-behavior-id]");
    if (behBtn) {
      state.activeBehaviorId = behBtn.getAttribute("data-behavior-id");
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return;
    }

    function stepUpLevel() {
      if (state.activeFileGraph) {
        const prevFile = state.activeFileGraph;
        state.activeFileGraph = null;
        state.selectedNodeId = "file:" + prevFile;
        state.selectedEdgeId = null;
        state.focusMode = false;
        render();
        return;
      }
      if (state.activeFolder) {
        const parts = state.activeFolder.folderPath.split("/").filter(Boolean);
        if (parts.length > 1) {
          state.activeFolder = { ...state.activeFolder, folderPath: parts.slice(0, -1).join("/") };
        } else {
          const retId = state.activeFolder.returnDiagId || ("modules:" + state.activeFolder.unitSlug);
          state.activeFolder = null;
          state.activeLayerDiagId = diagById.has(retId) ? retId : null;
        }
      } else if (state.activeLayerDiagId) {
        const cur = diagById.get(state.activeLayerDiagId);
        state.activeLayerDiagId = cur?.parentDiagramId && diagById.has(cur.parentDiagramId) ? cur.parentDiagramId : null;
      }
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      render();
    }

    if (target.closest("[data-step-up]")) {
      stepUpLevel();
      return;
    }

    if (target.closest("[data-back-map]")) {
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.activeFileGraph = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const openFileGraphBtn = target.closest("[data-open-file-graph]");
    if (openFileGraphBtn) {
      const fPath = openFileGraphBtn.getAttribute("data-open-file-graph") || "";
      const jumpSym = openFileGraphBtn.getAttribute("data-jump-sym");
      const p = jumpSym ? jumpSym.split(":") : [];
      openFileCodeView(fPath, p.length >= 3 ? Number(p[2]) : 1, p.length >= 3 ? Number(p[1]) : -1);
      return;
    }

    const jumpSymBtn = target.closest("[data-jump-sym]");
    if (jumpSymBtn) {
      const p = (jumpSymBtn.getAttribute("data-jump-sym") || "").split(":");
      if (p.length >= 3) {
        state.selectedNodeId = "sym:" + p[0] + ":" + p[1];
        state.selectedEdgeId = null;
        state.codeFocusLine = Number(p[2]) || 1;
        ensureFileSourcesLoaded();
        render();
      }
      return;
    }

    const jumpLineBtn = target.closest("[data-jump-line]");
    if (jumpLineBtn) {
      state.codeFocusLine = Number(jumpLineBtn.getAttribute("data-jump-line")) || 1;
      ensureFileSourcesLoaded();
      render();
      return;
    }

    if (handleExplainClick(target)) return;
    if (handleFeatureClick(target)) return;

    const copyCodeBtn = target.closest("[data-copy-code]");
    if (copyCodeBtn) {
      copyCurrentCodeToClipboard(copyCodeBtn);
      return;
    }

    const codeFullBtn = target.closest("[data-code-full]");
    if (codeFullBtn) {
      state.codeFullFile = codeFullBtn.getAttribute("data-code-full") === "1";
      ensureFileSourcesLoaded();
      render();
      return;
    }

    const openFolderBtn = target.closest("[data-open-folder]");
    if (openFolderBtn) {
      const raw = openFolderBtn.getAttribute("data-open-folder") || "";
      const sep = raw.indexOf("::");
      if (sep > 0) {
        const uSlug = raw.slice(0, sep);
        const fPath = raw.slice(sep + 2);
        const prevReturn = state.activeFolder?.returnDiagId || state.activeLayerDiagId;
        state.tab = "map";
        state.activeFileGraph = null;
        state.activeFolder = { unitSlug: uSlug, folderPath: fPath, returnDiagId: prevReturn };
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
      }
      return;
    }

    const openFileBtn = target.closest("[data-open-file]");
    if (openFileBtn) {
      const fPath = openFileBtn.getAttribute("data-open-file") || "";
      const fLine = Number(openFileBtn.getAttribute("data-open-file-line")) || 1;
      openFileCodeView(fPath, fLine, -1);
      return;
    }

    const openLayerBtn = target.closest("[data-open-layers]");
    if (openLayerBtn) {
      state.tab = "map";
      state.activeFileGraph = null;
      state.activeFolder = null;
      state.activeLayerDiagId = openLayerBtn.getAttribute("data-open-layers");
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return;
    }

    if (target.closest("[data-toggle-focus]")) {
      state.focusMode = !state.focusMode;
      render();
      return;
    }

    if (target.closest("[data-clear-sel]")) {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      state.blastSeedId = null;
      state.activeTraceId = null;
      render();
      return;
    }

    const zoomBtn = target.closest("[data-zoom]");
    if (zoomBtn) {
      zoomByButton(zoomBtn.getAttribute("data-zoom") || "fit");
      return;
    }

    const traceCard = target.closest("[data-trace]");
    if (traceCard) {
      const tid = traceCard.getAttribute("data-trace");
      if (state.activeTraceId === tid) {
        state.activeTraceId = null;
      } else {
        state.activeTraceId = tid;
        const t = DATA.traces.find((x) => x.id === tid);
        if (t) {
          const d = diagById.get(t.diagramId);
          if (d) {
            state.viewMode = "flow";
            if (d.category === "layers" || d.category === "modules" || d.category === "subsystem") { state.tab = "map"; state.activeLayerDiagId = d.id; }
            else if (d.category === "behavior") { state.tab = "behavior"; state.activeBehaviorId = d.id; }
            else { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "runtime"; }
          }
        }
      }
      render();
      return;
    }

    const showInvBtn = target.closest("[data-show-inv]");
    if (showInvBtn) {
      const invId = showInvBtn.getAttribute("data-show-inv");
      const inv = invById.get(invId);
      const anchor = inv?.evidence?.find((e) => e.anchors && e.anchors.length > 0)?.anchors?.[0];
      if (anchor) {
        const d = diagById.get(anchor.diagramId);
        if (d) {
          state.focusMode = false;
          state.activeTraceId = null;
          if (d.category === "layers") { state.tab = "map"; state.activeLayerDiagId = d.id; }
          else if (d.category === "domains") { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "domains"; }
          else if (d.category === "delivery") { state.tab = "delivery"; }
          else { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "runtime"; }
          state.selectedEdgeId = anchor.edgeIds[0] || null;
          state.selectedNodeId = state.selectedEdgeId ? null : (anchor.nodeIds[0] || null);
          render();
        }
      }
      return;
    }

    if (target.closest("[data-toggle-guide]")) {
      state.showGuide = !state.showGuide;
      render();
      return;
    }

    const copyInvBtn = target.closest("[data-copy-inv]");
    if (copyInvBtn) {
      const inv = invById.get(copyInvBtn.getAttribute("data-copy-inv"));
      if (inv && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(buildFixBriefMarkdown(inv)).catch(() => {});
      }
      copyInvBtn.textContent = "Copied ✓";
      setTimeout(() => { copyInvBtn.textContent = "Copy Fix Brief"; }, 1400);
      return;
    }

    if (target.closest("[data-dsm-viol-only]")) {
      state.dsmViolOnly = !state.dsmViolOnly;
      render();
      return;
    }

    if (target.closest("[data-open-viol-matrix]")) {
      state.viewMode = "matrix";
      state.dsmViolOnly = true;
      state.focusMode = false;
      render();
      return;
    }

    if (target.closest("[data-data-issues]")) {
      state.dataIssuesOnly = !state.dataIssuesOnly;
      render();
      return;
    }

    const diffModeBtn = target.closest("[data-diff-mode]");
    if (diffModeBtn) {
      state.diffMode = diffModeBtn.getAttribute("data-diff-mode") || "overlay";
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      syncCameraTargetImmediate();
      render();
      return;
    }

    const diffDiagBtn = target.closest("[data-diff-diag]");
    if (diffDiagBtn) {
      state.diffDiagramId = diffDiagBtn.getAttribute("data-diff-diag");
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      syncCameraTargetImmediate();
      render();
      return;
    }

    const jumpFilterBtn = target.closest("[data-jump-checks-filter]");
    if (jumpFilterBtn) {
      state.tab = "checks";
      state.checksFilter = jumpFilterBtn.getAttribute("data-jump-checks-filter") || "active";
      state.showGuide = false;
      render();
      return;
    }

    if (target.closest("[data-jump-checks]")) {
      state.tab = "checks";
      state.checksFilter = "active";
      render();
      return;
    }

    const dataSub = target.closest("[data-data-sub]");
    if (dataSub) {
      state.dataSubtab = dataSub.getAttribute("data-data-sub") || "entities";
      state.dataIssuesOnly = false;
      render();
      return;
    }

    const factsKindBtn = target.closest("[data-facts-kind]");
    if (factsKindBtn) {
      state.factsKindFilter = factsKindBtn.getAttribute("data-facts-kind") || "";
      render();
      return;
    }

    const checksF = target.closest("[data-checks-filter]");
    if (checksF) {
      state.checksFilter = checksF.getAttribute("data-checks-filter") || "active";
      render();
      return;
    }

    const searchItem = target.closest("[data-search-action]");
    if (searchItem) {
      const act = searchItem.getAttribute("data-search-action");
      const id = searchItem.getAttribute("data-search-id") || "";
      state.search = "";
      if (act === "sym") {
        const p = id.split("::");
        if (p.length >= 3) openFileCodeView(p[0], Number(p[2]) || 1, Number(p[1]));
        return;
      } else if (act === "file") {
        openFileCodeView(id, 1, -1);
        return;
      } else if (act === "module") {
        const mod = moduleById.get(id);
        state.tab = "map";
        state.activeFolder = null;
        state.activeLayerDiagId = mod ? "modules:" + mod.unitSlug : state.activeLayerDiagId;
        state.selectedNodeId = id;
        state.selectedEdgeId = null;
      } else if (act === "node") {
        state.tab = "map";
        state.activeLayerDiagId = null;
        state.mapMode = "runtime";
        state.selectedNodeId = id;
        state.selectedEdgeId = null;
      } else if (act === "endpoints") {
        state.tab = "data";
        state.dataSubtab = "endpoints";
        state.dataFilter = id;
      } else if (act === "entity") {
        state.tab = "data";
        state.dataSubtab = "entities";
        state.dataFilter = id;
      }
      const selAfterSearch = state.selectedNodeId;
      render();
      if (selAfterSearch) centerCameraOnNode(selAfterSearch);
      return;
    }

    const selNodeEl = target.closest("[data-select-node]");
    if (selNodeEl) {
      state.selectedNodeId = selNodeEl.getAttribute("data-select-node");
      state.selectedEdgeId = null;
      render();
      return;
    }

    const flowSubBtn = target.closest("[data-flows-sub]");
    if (flowSubBtn) {
      state.flowsSubtab = flowSubBtn.getAttribute("data-flows-sub") || "workflows";
      render();
      return;
    }

    const selFlowBtn = target.closest("[data-select-flow]");
    if (selFlowBtn) {
      state.activeFlowId = selFlowBtn.getAttribute("data-select-flow");
      render();
      return;
    }

    const svgNode = target.closest("[data-node]");
    if (svgNode) {
      const id = svgNode.getAttribute("data-node");
      const now = Date.now();
      const isDouble = Boolean(id && (ev.detail >= 2 || (lastNodeClickId === id && now - lastNodeClickAt <= 420)));
      lastNodeClickId = id;
      lastNodeClickAt = now;
      if (isDouble && drillIntoNode(id)) {
        lastNodeClickId = null;
        lastNodeClickAt = 0;
        return;
      }
      state.selectedNodeId = id;
      state.selectedEdgeId = null;
      render();
      return;
    }

    const svgEdge = target.closest("[data-edge]");
    if (svgEdge) {
      state.selectedEdgeId = svgEdge.getAttribute("data-edge");
      state.selectedNodeId = null;
      render();
      return;
    }
  });

`;
}
