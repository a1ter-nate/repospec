export function renderStageClientScript(): string {
  return `
  function render() {
    const rawDiag = activeDiagram();
    const diag = rawDiag && state.focusMode && state.selectedNodeId ? buildBowTieLayout(rawDiag, state.selectedNodeId) : rawDiag;
    const nextFitKey = diag ? diag.id + (state.focusMode ? ":f" : "") : null;
    if (diag && state.fittedDiagId !== nextFitKey) {
      state.justNavigated = state.fittedDiagId !== null;
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      syncCameraTargetImmediate();
      state.fittedDiagId = nextFitKey;
    } else {
      state.justNavigated = false;
    }

    const v = DATA.verification;
    const hasRealCov = v.realLineCoveragePct !== null && v.realLineCoveragePct !== undefined;
    const covHeaderLabel = hasRealCov
      ? v.realLineCoveragePct + "% line cov (" + esc(v.coverageSource || "report") + ")"
      : v.directTestCoveragePct + "% static 1-hop reach";
    const metaHtml =
      '<span class="header-meta" title="' + (hasRealCov ? "Execution line coverage ingested from " + esc(v.coverageReportFile || v.coverageSource || "coverage report") : "Static 1-hop test import reachability — not execution line/branch coverage") + '">' +
      DATA.summary.indexedSourceFiles + " files · " + covHeaderLabel +
      (DATA.repo.commitSha ? " @" + esc(DATA.repo.commitSha.slice(0, 7)) : "") +
      "</span>";

    const customTabs = DATA.customUi?.extraTabs || [];
    const flowCount = (DATA.flows?.workFlows?.length || 0) + (DATA.flows?.stateMachines?.length || 0) + (DATA.flows?.dataHubs?.length || 0);
    const hasSurfaces = DATA.entities.length > 0 || DATA.surfaces.endpoints.length > 0 || DATA.surfaces.envBindings.length > 0;
    const checkHealth =
      v.invariantsFailed > 0 || v.invariantsWarned > 0
        ? '<span class="tab-health">' +
          (v.invariantsFailed > 0 ? '<span class="tab-h-err">◆' + v.invariantsFailed + "</span>" : "") +
          (v.invariantsWarned > 0 ? '<span class="tab-h-warn">▲' + v.invariantsWarned + "</span>" : "") +
          "</span>"
        : '<span class="tab-health"><span class="tab-h-ok">●</span></span>';
    const tabs = [
      { id: "diff", label: "Diff", count: (DATA.commitDiff?.baseSha || "") + "→" + (DATA.commitDiff?.headSha || ""), show: Boolean(DATA.commitDiff) },
      { id: "map", label: "Map", count: "", show: Boolean(runtimeDiag) },
      { id: "flows", label: "Flows", count: String(DATA.flows?.workFlows?.length || 0), show: flowCount > 0 },
      { id: "data", label: "Surfaces", count: "", show: hasSurfaces },
      { id: "checks", label: "Checks", badgeHtml: checkHealth, count: "", show: (DATA.invariants || []).length > 0 },
      { id: "timeline", label: "Timeline", count: String(DATA.timeline?.commits?.length || 0), show: Boolean(DATA.timeline?.commits?.length) },
      ...customTabs.map((ct) => ({ id: "custom:" + ct.id, label: ct.label, count: "", show: true })),
    ].filter((t) => t.show);

    let subNav = "";
    if (state.tab === "map") {
      if (state.e2eTraceSeed) {
        subNav = '<div class="sub-toggles"><button class="crumb-btn" data-close-e2e="1">← Map</button><span class="crumb-sep">/</span><span class="crumb-cur">E2E · ' + esc(state.e2eTraceSeed.filePath.split("/").pop()) + "</span></div>";
      } else if (state.activeFileGraph) {
        const fgPath = state.activeFileGraph;
        const fIdx = ddIdxByPath.get(fgPath);
        const fObj = fIdx !== undefined ? DD_FILES[fIdx] : null;
        const crumbs = [
          ...(state.returnToChecks ? ['<button class="pill-btn active" data-return-to-checks="1">← Checks</button><span class="crumb-sep">/</span>'] : []),
          '<button class="crumb-btn" data-back-map="1">System</button>',
        ];
        if (fObj) {
          const unitModId = "modules:" + fObj.u;
          if (diagById.has(unitModId)) {
            crumbs.push('<span class="crumb-sep">/</span><button class="crumb-btn" data-open-layers="' + esc(unitModId) + '">' + esc(fObj.u) + "</button>");
          }
          const logical = ddLogicalRel(fObj, ddUnitPeelPrefix(fObj.u));
          const segs = logical.split("/").filter(Boolean);
          let acc = "";
          for (let si = 0; si < segs.length - 1; si += 1) {
            acc = acc ? acc + "/" + segs[si] : segs[si];
            crumbs.push('<span class="crumb-sep">/</span><button class="crumb-btn" data-open-folder="' + esc(fObj.u + "::" + acc) + '">' + esc(segs[si]) + "</button>");
          }
        }
        crumbs.push('<span class="crumb-sep">/</span><span class="crumb-cur">' + esc(fgPath.split("/").pop()) + "</span>");
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else if (state.activeFolder) {
        const af = state.activeFolder;
        const crumbs = [
          ...(state.returnToChecks ? ['<button class="pill-btn active" data-return-to-checks="1">← Checks</button><span class="crumb-sep">/</span>'] : []),
          '<button class="crumb-btn" data-back-map="1">System</button>',
        ];
        const unitModDiag = diagById.get("modules:" + af.unitSlug);
        const unitLayerDiag = diagById.get("layers:" + af.unitSlug);
        const unitReturnId = af.returnDiagId || unitModDiag?.id || unitLayerDiag?.id || null;
        if (unitReturnId) {
          crumbs.push('<span class="crumb-sep">/</span><button class="crumb-btn" data-open-layers="' + esc(unitReturnId) + '">' + esc(af.unitSlug) + "</button>");
        } else {
          crumbs.push('<span class="crumb-sep">/</span><span class="mono muted">' + esc(af.unitSlug) + "</span>");
        }
        const segs = af.folderPath.split("/").filter(Boolean);
        let acc = "";
        segs.forEach((seg, si) => {
          acc = acc ? acc + "/" + seg : seg;
          if (si < segs.length - 1) {
            crumbs.push('<span class="crumb-sep">/</span><button class="crumb-btn" data-open-folder="' + esc(af.unitSlug + "::" + acc) + '">' + esc(seg) + "</button>");
          } else {
            crumbs.push('<span class="crumb-sep">/</span><span class="crumb-cur">' + esc(seg) + "/</span>");
          }
        });
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else if (state.activeLayerDiagId) {
        const ld = diagById.get(state.activeLayerDiagId);
        const ownerModDiag = ld?.ownerId ? moduleDiagByOwner.get(ld.ownerId) : null;
        const ownerLayerDiag = ld?.ownerId ? layerDiagByOwner.get(ld.ownerId) : null;
        const parentDiag = ld?.parentDiagramId ? diagById.get(ld.parentDiagramId) : null;
        const crumbs = [];
        if (!isSingleUnitAtlas || runtimeDiag) {
          crumbs.push('<button class="crumb-btn" data-back-map="1">System</button>');
        }
        if (parentDiag) {
          crumbs.push('<span class="crumb-sep">/</span><button class="crumb-btn" data-open-layers="' + esc(parentDiag.id) + '">' + esc(parentDiag.id.replace(/^modules:/, "")) + "</button>");
        }
        if (ld) {
          const shortTitle = ld.category === "subsystem"
            ? ld.id.split(":").slice(2).join(":") + "/"
            : ld.id.replace(/^(?:modules|layers):/, "");
          crumbs.push('<span class="crumb-sep">/</span><span class="crumb-cur">' + esc(shortTitle) + "</span>");
        }
        if (ownerModDiag && ownerLayerDiag && ld && ld.category !== "subsystem") {
          crumbs.push('<span class="hud-sep"></span><span class="seg-group">' +
            '<button class="seg-btn' + (ld.category === "modules" ? " active" : "") + '" data-open-layers="' + esc(ownerModDiag.id) + '" title="Top-level module dependency graph ordered from entry points to foundations">Modules</button>' +
            '<button class="seg-btn' + (ld.category === "layers" ? " active" : "") + '" data-open-layers="' + esc(ownerLayerDiag.id) + '" title="Clean Architecture layers — red backward arrows highlight layer inversions">Layers</button>' +
            "</span>");
        }
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else {
        subNav = '<div class="sub-toggles">' +
          (moduleDiags.length === 1 ? '<button class="pill-btn" data-open-layers="' + esc(moduleDiags[0].id) + '" title="Drill into top-level module topology">Modules <span class="tab-n">' + moduleDiags[0].nodes.length + "</span></button>" : "") +
          '<button class="pill-btn' + (state.mapMode === "runtime" ? " active" : "") + '" data-map-mode="runtime" title="Apps, services, datastores, and external APIs flowing left-to-right">Runtime</button>' +
          (packagesDiag ? '<button class="pill-btn' + (state.mapMode === "packages" ? " active" : "") + '" data-map-mode="packages" title="Internal workspace package dependency graph">Packages</button>' : "") +
          (domainsDiag ? '<button class="pill-btn' + (state.mapMode === "domains" ? " active" : "") + '" data-map-mode="domains" title="Business domain coupling graph — red arrows show bidirectional coupling">Domains</button>' : "") +
          (deliveryDiag ? '<button class="pill-btn' + (state.mapMode === "delivery" ? " active" : "") + '" data-map-mode="delivery" title="CI workflows, builds, and IaC deployment resources">Delivery</button>' : "") +
          "</div>";
      }
    } else if (state.tab === "behavior" && behaviorDiags.length > 1) {
      subNav = '<div class="sub-toggles">' +
        behaviorDiags.slice(0, 8).map((b) => '<button class="pill-btn' + (state.activeBehaviorId === b.id ? " active" : "") + '" data-behavior-id="' + esc(b.id) + '">' + esc(b.title.split("—")[0]?.trim()) + "</button>").join("") +
        "</div>";
    }

    let bodyHtml = "";
    if (state.tab === "diff") {
      bodyHtml = renderDiffTab();
    } else if (state.tab === "timeline") {
      bodyHtml = renderTimelineTab();
    } else if (state.tab === "data") {
      bodyHtml = renderDataTab();
    } else if (state.tab === "flows") {
      bodyHtml = renderFlowsTab();
    } else if (state.tab === "checks") {
      bodyHtml = renderChecksTab();
    } else if (state.tab.startsWith("custom:")) {
      const cid = state.tab.slice(7);
      const customTab = customTabs.find((ct) => ct.id === cid);
      bodyHtml = '<div class="table-wrap">' + (customTab ? customTab.html : '<div class="muted">Custom tab not found.</div>') + "</div>";
    } else if (diag) {
      const canMatrix = supportsMatrix(diag) && !state.focusMode;
      const inMatrix = canMatrix && state.viewMode === "matrix";
      const detailCount = diag.edges.filter((e) => e.tier === "detail" && !e.violation).length;
      const visibleSpineCount = diag.edges.length - detailCount;

      const blastDrawerHtml = state.blastSeedId ? renderBlastRadiusPanel(diag) : "";
      const baseDrawerHtml = state.e2eTraceSeed
        ? renderE2eTraceDrawer(diag)
        : state.activeFileGraph
          ? renderFileCallGraphDrawer(state.activeFileGraph, diag)
          : state.selectedEdgeId
            ? renderEdgeInspector(diag, state.selectedEdgeId)
            : state.selectedNodeId
              ? renderNodeInspector(state.selectedNodeId)
              : renderBriefingDrawer();
      const drawerHtml = blastDrawerHtml + baseDrawerHtml;

      const viewToggleHtml = canMatrix
        ? '<span class="seg-group">' +
          '<button class="seg-btn' + (!inMatrix ? " active" : "") + '" data-view-mode="flow" title="Visual node-and-wire dependency flow">Flow</button>' +
          '<button class="seg-btn' + (inMatrix ? " active" : "") + '" data-view-mode="matrix" title="Design Structure Matrix: grid showing every dependency with zero crossing lines">Matrix</button>' +
          "</span>"
        : "";

      const wireToggleHtml = !inMatrix && detailCount > 0
        ? '<button class="tbtn' + (state.showAllEdges ? " active" : "") + '" data-toggle-wires="1" title="Showing key spine wires only — hover any card for its full neighborhood, or click to toggle all wires">' + (state.showAllEdges ? "All " + diag.edges.length : visibleSpineCount + "/" + diag.edges.length + " wires") + "</button>"
        : "";

      const canStepUp = Boolean(state.activeFileGraph || state.activeFolder || (state.activeLayerDiagId && !isSingleUnitAtlas));
      const hudTopLeft = subNav ? '<div class="hud-pill hud-top-left">' + subNav + "</div>" : "";
      const lensLabel = state.canvasLens === "coverage" ? (hasRealCov ? "Coverage" : "Reachability") : state.canvasLens === "churn" ? "Churn" : "Normal";
      const lensHtml = !inMatrix && !state.activeFileGraph && !state.e2eTraceSeed && DD_FILES.length > 0
        ? '<details class="more-wrap"><summary class="tbtn' + (state.canvasLens !== "default" ? " active" : "") + '" title="Heatmap lens overlay">Lens: ' + lensLabel + ' ▾</summary><div class="more-menu">' +
          '<button class="' + (state.canvasLens === "default" ? "active" : "") + '" data-lens="default">Normal</button>' +
          '<button class="' + (state.canvasLens === "coverage" ? "active" : "") + '" data-lens="coverage">' + (hasRealCov ? "Line Coverage" : "Static Reachability") + "</button>" +
          '<button class="' + (state.canvasLens === "churn" ? "active" : "") + '" data-lens="churn">Git Churn Hotspots</button>' +
          "</div></details>"
        : "";
      const rightParts = [
        viewToggleHtml,
        lensHtml,
        wireToggleHtml,
        state.selectedNodeId && !inMatrix ? '<button class="tbtn' + (state.focusMode ? " active" : "") + '" data-toggle-focus="1" title="Bow-Tie focus: isolate only direct callers and dependencies">Focus <span class="keycap">F</span></button>' : "",
        '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read this graph">?</button>',
      ].filter(Boolean);
      const hudTopRight = '<div class="hud-pill hud-top-right">' + rightParts.join('<span class="hud-sep"></span>') + "</div>";
      const hudBottomLeft = !inMatrix
        ? '<div class="hud-pill hud-bottom-left">' +
          '<button class="tbtn" data-zoom="out" title="Zoom out (-)">−</button>' +
          '<button class="zoom-pct" id="zoom-pct" data-zoom="fit" title="Reset zoom (0)">' + Math.round(state.scale * 100) + "%</button>" +
          '<button class="tbtn" data-zoom="in" title="Zoom in (+)">+</button>' +
          '<span class="hud-sep"></span>' +
          '<button class="tbtn" data-zoom="fit" title="Fit view (0)">Fit</button>' +
          (canStepUp ? '<span class="hud-sep"></span><button class="tbtn" data-step-up="1" title="Up one level (Backspace)">↑</button>' : "") +
          "</div>"
        : "";
      const unconnList = !inMatrix && diag.unconnectedNodes && diag.unconnectedNodes.length > 0 ? diag.unconnectedNodes : [];
      const legendPopHtml = state.legendOpen
        ? '<div class="hud-pop">' + renderLegend(diag).replace('<div class="legend">', "").replace("</div>", "") + '<span class="leg-item"><span class="keycap">2×</span> Double-click any card to drill in</span></div>'
        : "";
      const unconnPopHtml = state.unconnectedOpen && unconnList.length > 0
        ? '<div class="hud-pop is-right"><div class="sec-title">No static edges extracted (' + unconnList.length + ")</div>" +
          unconnList.map((u) => '<button class="hud-pop-row" data-select-node="' + esc(u.id) + '"><span class="fr-dot is-hollow"></span><span>' + esc(u.label) + "</span></button>").join("") +
          "</div>"
        : "";
      const hudLegend = !inMatrix
        ? '<div class="hud-pill hud-bottom-center">' +
          '<span class="hud-pop-wrap">' + legendPopHtml +
          '<button class="tbtn' + (state.legendOpen ? " active" : "") + '" data-toggle-legend="1" title="Toggle graph legend"><span class="hud-swatches"><i style="background:var(--accent)"></i><i style="background:var(--ok)"></i><i style="background:var(--err)"></i></span>Legend</button></span>' +
          (unconnList.length > 0
            ? '<span class="hud-sep"></span><span class="hud-pop-wrap">' + unconnPopHtml +
              '<button class="tbtn' + (state.unconnectedOpen ? " active" : "") + '" data-toggle-unconnected="1" title="Units indexed without static runtime edges">◌ ' + unconnList.length + " unconnected ▾</button></span>"
            : "") +
          "</div>"
        : "";

      const selNodeObj = state.selectedNodeId && diag ? diag.nodes.find((n) => n.id === state.selectedNodeId) : null;
      const selSpecNode = state.selectedNodeId ? nodeById.get(state.selectedNodeId) : null;
      const selModObj = state.selectedNodeId ? moduleById.get(state.selectedNodeId) : null;
      const isSingleFileSel = Boolean(
        state.selectedNodeId &&
        (state.selectedNodeId.startsWith("file:") ||
          (selNodeObj?.ctxMeta && Array.from(selNodeObj.ctxMeta.files || []).length === 1) ||
          (selSpecNode?.provenance?.file && ddIdxByPath.has(selSpecNode.provenance.file)) ||
          (selModObj && selModObj.files.length === 1 && ddIdxByPath.has(selModObj.files[0].file)) ||
          (selNodeObj?.provenance?.file && !selSpecNode && !selModObj && ddIdxByPath.has(selNodeObj.provenance.file)))
      );
      const wsStyle = !INLINE && state.drawerWidth && !state.drawerCollapsed ? ' style="--drawer-w:' + state.drawerWidth + 'px"' : "";
      const drawerKicker = state.e2eTraceSeed ? "E2E Trace" : state.activeFileGraph ? "Symbol & Code" : state.selectedNodeId || state.selectedEdgeId ? "Inspector" : "Overview";
      const drawerTopbar = !INLINE
        ? '<div class="drawer-topbar"><span class="drawer-kicker">' + drawerKicker + '</span><button class="tbtn" data-toggle-drawer="1" title="Collapse panel (])">⇥</button></div>'
        : "";
      const reopenBtn = !INLINE && state.drawerCollapsed
        ? '<button class="drawer-reopen-btn" data-toggle-drawer="1" title="Open panel (])">⇤ ' + drawerKicker + "</button>"
        : "";
      const resizerHtml = !INLINE
        ? '<div class="drawer-resizer" id="drawer-resizer" title="Drag to resize · Double-click to reset"></div>'
        : "";
      bodyHtml =
        '<div class="workspace' + (state.activeFileGraph || state.e2eTraceSeed || isSingleFileSel ? " code-open" : "") + (state.drawerCollapsed ? " drawer-collapsed" : "") + '" id="workspace"' + wsStyle + ">" +
        '<div class="canvas-panel">' +
        hudTopLeft +
        hudTopRight +
        reopenBtn +
        renderInfoPopoverHtml() +
        hudBottomLeft +
        hudLegend +
        (!inMatrix ? renderMinimapHtml(diag) : "") +
        '<div class="edge-tooltip" id="edge-tooltip"></div>' +
        '<div class="canvas-shell' + (inMatrix ? " matrix-mode" : "") + '" id="canvas-shell">' +
        (inMatrix ? renderMatrixView(diag) : renderDiagramSvg(diag)) +
        "</div>" +
        "</div>" +
        resizerHtml +
        '<div class="drawer" id="drawer">' + drawerTopbar + drawerHtml + "</div>" +
        "</div>";
    }

    document.getElementById("app").innerHTML =
      '<div class="studio-bar">' +
      '<div class="bar-left">' +
      '<div class="brand"><span class="brand-dot"></span><span>' + esc(DATA.customUi?.brandLabel || DATA.repo.name) + '</span><span class="brand-ver">v' + esc(DATA.schemaVersion) + '</span><span class="live-badge" id="live-watch-badge"' + (liveWatchConnected ? ' style="display:inline-flex"' : "") + '>LIVE</span></div>' +
      (DATA.customUi?.headerHtml || "") +
      '<div class="tabs">' +
      tabs.map((t) => '<button class="tab' + (state.tab === t.id ? " active" : "") + '" data-tab="' + esc(t.id) + '">' + esc(t.label) + (t.count ? '<span class="tab-n">' + esc(t.count) + "</span>" : "") + (t.badgeHtml || "") + "</button>").join("") +
      "</div>" +
      "</div>" +
      '<div class="bar-right">' +
      metaHtml +
      '<div class="search-wrap"><input class="search" id="global-search" placeholder="Jump to…" value="' + esc(state.search) + '" /><span class="search-kbd">⌘K</span>' + renderSearchDropdown() + "</div>" +
      '<details class="more-wrap"><summary class="tbtn" title="More actions">⋯</summary><div class="more-menu">' +
      '<button data-copy-share="1">Copy shareable link</button>' +
      (v.invariantsFailed > 0 ? '<button data-jump-checks-filter="fail">Jump to broken rules (' + v.invariantsFailed + ")</button>" : "") +
      "</div></details>" +
      "</div>" +
      "</div>" +
      bodyHtml;
    applyTransform();
    if (state.tab === "flows" && typeof applyFlowDiagramScale === "function") applyFlowDiagramScale();
    syncHashFromState();
    const focusEl = document.querySelector("#code-viewer-box .focus-line");
    if (focusEl && typeof focusEl.scrollIntoView === "function") {
      focusEl.scrollIntoView({ block: "center" });
    }
  }

  const appEl = document.getElementById("app");

  appEl.addEventListener("mouseover", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const hubNode = target.closest(".rs-hub-node");
    if (hubNode) { applyHubHoverSpotlight(hubNode); return; }
    const jrnNode = target.closest(".rs-jrn-node");
    if (jrnNode) { applyJourneyHoverSpotlight(jrnNode); return; }
    const svgNode = target.closest("[data-node]");
    if (svgNode) {
      const nid = svgNode.getAttribute("data-node");
      if (nid) applyNodeHoverSpotlight(nid);
      return;
    }
    const drawerLink = target.closest(".drawer [data-select-node]");
    if (drawerLink) {
      const nid = drawerLink.getAttribute("data-select-node");
      if (nid) applyNodeHoverSpotlight(nid);
      return;
    }
    const svgEdge = target.closest("g[data-edge]");
    if (svgEdge) {
      const rawDiag = activeDiagram();
      const diag = rawDiag && state.focusMode && state.selectedNodeId ? buildBowTieLayout(rawDiag, state.selectedNodeId) : rawDiag;
      const eid = svgEdge.getAttribute("data-edge");
      if (diag && eid) showEdgeTooltip(ev, diag, eid);
      return;
    }
    const dsmCell = target.closest("td[data-dsm-r]");
    if (dsmCell) {
      const r = dsmCell.getAttribute("data-dsm-r");
      const c = dsmCell.getAttribute("data-dsm-c");
      appEl.querySelectorAll(".dsm-row-th.hl,.dsm-col-th.hl").forEach((el) => el.classList.remove("hl"));
      appEl.querySelector('[data-dsm-row="' + r + '"]')?.classList.add("hl");
      appEl.querySelector('[data-dsm-col="' + c + '"]')?.classList.add("hl");
    }
  });

  appEl.addEventListener("mouseout", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".rs-hub-node")) {
      const rel = ev.relatedTarget;
      if (!(rel instanceof Element) || !rel.closest(".rs-hub-node")) clearHubHoverSpotlight();
    }
    if (target.closest(".rs-jrn-node")) {
      const rel = ev.relatedTarget;
      if (!(rel instanceof Element) || !rel.closest(".rs-jrn-node")) clearJourneyHoverSpotlight();
    }
    if (target.closest("[data-node]") || target.closest("g[data-edge]") || target.closest(".drawer [data-select-node]")) {
      const rel = ev.relatedTarget;
      if (!(rel instanceof Element) || (!rel.closest("[data-node]") && !rel.closest("g[data-edge]") && !rel.closest(".drawer [data-select-node]"))) {
        clearHoverSpotlight();
      }
    }
    if (target.closest("td[data-dsm-r]")) {
      appEl.querySelectorAll(".dsm-row-th.hl,.dsm-col-th.hl").forEach((el) => el.classList.remove("hl"));
    }
  });

  let lastNodeClickId = null;
  let lastNodeClickAt = 0;

  function drillIntoNode(id) {
    if (!id) return false;
    const curDiag = activeDiagram();
    const diagNode = curDiag?.nodes.find((n) => n.id === id);
    if (id.startsWith("e2e:") && diagNode?.e2eMeta?.filePath) {
      state.e2eTraceSeed = null;
      return openFileCodeView(diagNode.e2eMeta.filePath, diagNode.e2eMeta.line || 1, diagNode.e2eMeta.symIdx);
    }
    if (id.startsWith("file:")) {
      const fPath = id.slice(5);
      if (ddIdxByPath.has(fPath)) {
        state.tab = "map";
        state.activeFileGraph = fPath;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        state.focusMode = false;
        state.codeFocusLine = 1;
        state.codeFullFile = false;
        ensureFileSourcesLoaded();
        render();
        return true;
      }
    }
    if (id.startsWith("folder:")) {
      const rest = id.slice(7);
      const colon = rest.indexOf(":");
      const uSlug = rest.slice(0, colon);
      const fPath = rest.slice(colon + 1);
      state.tab = "map";
      state.activeFolder = { unitSlug: uSlug, folderPath: fPath, returnDiagId: state.activeFolder?.returnDiagId || state.activeLayerDiagId };
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    if (diagNode?.ctxMeta) {
      const ctxFiles = Array.from(diagNode.ctxMeta.files || []);
      if (ctxFiles.length === 1 && openFileCodeView(ctxFiles[0], 1, -1)) return true;
    }
    if (diagNode?.ctxMeta?.folderPath && diagNode.ctxMeta.unitSlug) {
      state.tab = "map";
      state.activeFolder = { unitSlug: diagNode.ctxMeta.unitSlug, folderPath: diagNode.ctxMeta.folderPath, returnDiagId: state.activeFolder?.returnDiagId || state.activeLayerDiagId };
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    const mod = moduleById.get(id);
    if (mod && mod.files.length === 1 && openFileCodeView(mod.files[0].file, 1, -1)) return true;
    if (mod && mod.kind === "directory") {
      if (unitHasFolderFiles(mod.unitSlug, mod.name) > 0) {
        state.tab = "map";
        state.activeFolder = { unitSlug: mod.unitSlug, folderPath: mod.name, returnDiagId: state.activeLayerDiagId };
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
        return true;
      }
      const subId = "subsystem:" + mod.unitSlug + ":" + mod.name;
      if (diagById.has(subId)) {
        state.tab = "map";
        state.activeFolder = null;
        state.activeLayerDiagId = subId;
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
        return true;
      }
    }
    const specNode = nodeById.get(id);
    if (specNode && specNode.kind === "code_layer" && specNode.group && unitHasFolderFiles(specNode.group, specNode.label) > 0) {
      state.tab = "map";
      state.activeFolder = { unitSlug: specNode.group, folderPath: specNode.label, returnDiagId: state.activeLayerDiagId };
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    const targetDiag = moduleDiagByOwner.get(id) || layerDiagByOwner.get(id) || null;
    if (targetDiag) {
      state.tab = "map";
      state.activeFolder = null;
      state.activeLayerDiagId = targetDiag.id;
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    if (specNode?.provenance?.file && openFileCodeView(specNode.provenance.file, specNode.provenance.line || 1, -1)) {
      return true;
    }
    return false;
  }

`;
}
