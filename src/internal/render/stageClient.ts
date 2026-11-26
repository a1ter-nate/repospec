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
    const statusHtml =
      '<button class="s-dot ' + (v.invariantsFailed > 0 ? "err status-fail" : "ok status-pass") + '" data-jump-checks-filter="fail" title="Failing structural invariants (' + v.invariantsPassed + " pass, " + v.invariantsNa + ' N/A)">' + v.invariantsFailed + " fail</button>" +
      (v.invariantsWarned > 0 ? '<button class="s-dot warn status-warn" data-jump-checks-filter="warn" title="Click to view architectural warnings">' + v.invariantsWarned + " warn</button>" : "") +
      '<span title="' + (hasRealCov ? "Execution line coverage ingested from " + esc(v.coverageReportFile || v.coverageSource || "coverage report") : "Static 1-hop test import reachability — not execution line/branch coverage") + '">' + DATA.summary.indexedSourceFiles + " files · " + covHeaderLabel + "</span>" +
      (DATA.repo.commitSha ? "<span>@" + esc(DATA.repo.commitSha.slice(0, 7)) + "</span>" : "");

    const customFacts = DATA.extensions?.facts || [];
    const customTabs = DATA.customUi?.extraTabs || [];
    const tabs = [
      { id: "diff", label: "Diff (" + (DATA.commitDiff?.baseSha || "") + "→" + (DATA.commitDiff?.headSha || "") + ")", show: Boolean(DATA.commitDiff) },
      { id: "map", label: "Map", show: Boolean(runtimeDiag) },
      { id: "behavior", label: "Behavior (" + behaviorDiags.length + ")", show: behaviorDiags.length > 0 },
      { id: "data", label: "Data (" + DATA.entities.length + ")", show: DATA.entities.length > 0 || DATA.surfaces.endpoints.length > 0 || DATA.surfaces.envBindings.length > 0 },
      { id: "facts", label: "Facts (" + customFacts.length + ")", show: customFacts.length > 0 },
      { id: "delivery", label: "Delivery", show: Boolean(deliveryDiag) },
      { id: "timeline", label: "Timeline (" + (DATA.timeline?.commits?.length || 0) + ")", show: Boolean(DATA.timeline?.commits?.length) },
      { id: "checks", label: "Checks (" + (v.invariantsFailed + v.invariantsWarned) + ")", show: true },
      ...customTabs.map((ct) => ({ id: "custom:" + ct.id, label: ct.label, show: true })),
    ].filter((t) => t.show);

    let subNav = "";
    if (state.tab === "map") {
      if (state.e2eTraceSeed) {
        subNav = '<div class="sub-toggles"><button class="pill-btn" data-close-e2e="1">← Back to Map</button><span class="crumb-sep">›</span><span class="crumb-cur">E2E Trace · ' + esc(state.e2eTraceSeed.filePath.split("/").pop()) + "</span></div>";
      } else if (state.activeFileGraph) {
        const fgPath = state.activeFileGraph;
        const fIdx = ddIdxByPath.get(fgPath);
        const fObj = fIdx !== undefined ? DD_FILES[fIdx] : null;
        const crumbs = ['<button class="pill-btn" data-back-map="1">System</button>'];
        if (fObj) {
          const unitModId = "modules:" + fObj.u;
          if (diagById.has(unitModId)) {
            crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(unitModId) + '">' + esc(fObj.u) + "</button>");
          }
          const logical = ddLogicalRel(fObj, ddUnitPeelPrefix(fObj.u));
          const segs = logical.split("/").filter(Boolean);
          let acc = "";
          for (let si = 0; si < segs.length - 1; si += 1) {
            acc = acc ? acc + "/" + segs[si] : segs[si];
            crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-folder="' + esc(fObj.u + "::" + acc) + '">' + esc(segs[si]) + "/</button>");
          }
        }
        crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(fgPath.split("/").pop()) + "</span>");
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else if (state.activeFolder) {
        const af = state.activeFolder;
        const crumbs = ['<button class="pill-btn" data-back-map="1">System</button>'];
        const unitModDiag = diagById.get("modules:" + af.unitSlug);
        const unitLayerDiag = diagById.get("layers:" + af.unitSlug);
        const unitReturnId = af.returnDiagId || unitModDiag?.id || unitLayerDiag?.id || null;
        if (unitReturnId) {
          crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(unitReturnId) + '">' + esc(af.unitSlug) + "</button>");
        } else {
          crumbs.push('<span class="crumb-sep">›</span><span class="mono muted">' + esc(af.unitSlug) + "</span>");
        }
        const segs = af.folderPath.split("/").filter(Boolean);
        let acc = "";
        segs.forEach((seg, si) => {
          acc = acc ? acc + "/" + seg : seg;
          if (si < segs.length - 1) {
            crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-folder="' + esc(af.unitSlug + "::" + acc) + '">' + esc(seg) + "/</button>");
          } else {
            crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(seg) + "/</span>");
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
          crumbs.push('<button class="pill-btn" data-back-map="1">System</button>');
        }
        if (parentDiag) {
          crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(parentDiag.id) + '">' + esc(parentDiag.id.replace(/^modules:/, "")) + "</button>");
        }
        if (ld) {
          const shortTitle = ld.category === "subsystem"
            ? ld.id.split(":").slice(2).join(":") + "/"
            : ld.id.replace(/^(?:modules|layers):/, "");
          crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(shortTitle) + "</span>");
        }
        if (ownerModDiag && ownerLayerDiag && ld && ld.category !== "subsystem") {
          crumbs.push('<span class="seg-group" style="margin-left:4px">' +
            '<button class="seg-btn' + (ld.category === "modules" ? " active" : "") + '" data-open-layers="' + esc(ownerModDiag.id) + '" title="Top-level module dependency graph ordered from entry points to foundations">Modules</button>' +
            '<button class="seg-btn' + (ld.category === "layers" ? " active" : "") + '" data-open-layers="' + esc(ownerLayerDiag.id) + '" title="Clean Architecture layers — red backward arrows highlight layer inversions">Layers</button>' +
            "</span>");
        }
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else {
        subNav = '<div class="sub-toggles">' +
          (moduleDiags.length === 1 ? '<button class="pill-btn" data-open-layers="' + esc(moduleDiags[0].id) + '" title="Drill into top-level module topology">Modules (' + moduleDiags[0].nodes.length + ")</button>" : "") +
          '<button class="pill-btn' + (state.mapMode === "runtime" ? " active" : "") + '" data-map-mode="runtime" title="Apps, services, datastores, and external APIs flowing left-to-right">Runtime</button>' +
          (packagesDiag ? '<button class="pill-btn' + (state.mapMode === "packages" ? " active" : "") + '" data-map-mode="packages" title="Internal workspace package dependency graph">Packages</button>' : "") +
          (domainsDiag ? '<button class="pill-btn' + (state.mapMode === "domains" ? " active" : "") + '" data-map-mode="domains" title="Business domain coupling graph — red arrows show bidirectional coupling">Domains</button>' : "") +
          "</div>";
      }
    } else if (state.tab === "behavior" && behaviorDiags.length > 1) {
      subNav = '<div class="sub-toggles">' +
        behaviorDiags.slice(0, 8).map((b) => '<button class="pill-btn' + (state.activeBehaviorId === b.id ? " active" : "") + '" data-behavior-id="' + esc(b.id) + '">' + esc(b.title.split("—")[0]?.trim()) + "</button>").join("") +
        "</div>";
    }

    function renderFactsTab() {
      const kinds = Array.from(new Set(customFacts.map((f) => f.kind))).sort();
      const activeKind = state.factsKindFilter || "";
      const shown = customFacts.filter((f) => !activeKind || f.kind === activeKind);
      const pills =
        '<button class="pill-btn' + (!activeKind ? " active" : "") + '" data-facts-kind="">All (' + customFacts.length + ")</button>" +
        kinds.map((k) => {
          const cnt = customFacts.filter((f) => f.kind === k).length;
          return '<button class="pill-btn' + (activeKind === k ? " active" : "") + '" data-facts-kind="' + esc(k) + '">' + esc(k) + " (" + cnt + ")</button>";
        }).join("");
      const rows = shown.slice(0, 300).map((f) => {
        const openBtn = ddIdxByPath.has(f.file)
          ? ' <button class="tbtn" data-open-file="' + esc(f.file) + '" data-open-file-line="' + (f.line || 1) + '">Code</button>'
          : "";
        return '<tr><td><span class="badge">' + esc(f.kind) + '</span></td><td class="mono">' + esc(f.key) + '</td><td class="mono muted">' + esc(f.file) + ":" + (f.line || 1) + openBtn + '</td><td class="mono muted">' + esc(JSON.stringify(f.payload || {})) + "</td></tr>";
      }).join("");
      return '<div class="table-wrap"><div class="table-head"><div><strong>Extracted Facts (' + shown.length + ')</strong></div><div class="sub-toggles">' + pills + '</div></div><table class="data-table"><thead><tr><th>Kind</th><th>Key</th><th>Location</th><th>Payload</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    }

    let bodyHtml = "";
    if (state.tab === "diff") {
      bodyHtml = renderDiffTab();
    } else if (state.tab === "timeline") {
      bodyHtml = renderTimelineTab();
    } else if (state.tab === "data") {
      bodyHtml = renderDataTab();
    } else if (state.tab === "facts") {
      bodyHtml = renderFactsTab();
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

      const trayHtml = !inMatrix && diag.unconnectedNodes && diag.unconnectedNodes.length > 0
        ? '<div class="tray" title="Units indexed without static runtime edges to the core graph — click any chip to inspect"><span>No edges extracted:</span>' +
          diag.unconnectedNodes.map((u) => '<span class="tray-chip" data-select-node="' + esc(u.id) + '">' + esc(u.label) + "</span>").join("") +
          "</div>"
        : "";

      const viewToggleHtml = canMatrix
        ? '<span class="seg-group">' +
          '<button class="seg-btn' + (!inMatrix ? " active" : "") + '" data-view-mode="flow" title="Visual node-and-wire dependency flow">Flow</button>' +
          '<button class="seg-btn' + (inMatrix ? " active" : "") + '" data-view-mode="matrix" title="Design Structure Matrix: grid showing every dependency with zero crossing lines">Matrix (DSM)</button>' +
          "</span>"
        : "";

      const wireToggleHtml = !inMatrix && detailCount > 0
        ? '<button class="tbtn' + (state.showAllEdges ? " active" : "") + '" data-toggle-wires="1" title="Showing key spine wires only — hover any card for its full neighborhood, or click to toggle all wires">' + (state.showAllEdges ? "All wires (" + diag.edges.length + ")" : "Key wires (" + visibleSpineCount + "/" + diag.edges.length + ")") + "</button>"
        : "";

      const canStepUp = Boolean(state.activeFileGraph || state.activeFolder || (state.activeLayerDiagId && !isSingleUnitAtlas));
      const hudTopLeft = subNav ? '<div class="hud-pill hud-top-left">' + subNav + "</div>" : "";
      const lensHtml = !inMatrix && !state.activeFileGraph && !state.e2eTraceSeed && DD_FILES.length > 0
        ? '<span class="seg-group" title="Heatmap lens overlay">' +
          '<button class="seg-btn' + (state.canvasLens === "default" ? " active" : "") + '" data-lens="default">Normal</button>' +
          '<button class="seg-btn' + (state.canvasLens === "coverage" ? " active" : "") + '" data-lens="coverage" title="' + (hasRealCov ? "Tint modules & files by real line coverage %" : "Tint modules & files by static 1-hop test import reachability (no coverage report ingested)") + '">' + (hasRealCov ? "Coverage" : "Reachability") + "</button>" +
          '<button class="seg-btn' + (state.canvasLens === "churn" ? " active" : "") + '" data-lens="churn" title="Tint modules & files by git commit churn hotspots">Churn</button>' +
          "</span>"
        : "";
      const hudTopRight =
        '<div class="hud-pill hud-top-right">' +
        lensHtml +
        viewToggleHtml +
        wireToggleHtml +
        (state.selectedNodeId && !inMatrix ? '<button class="tbtn' + (state.focusMode ? " active" : "") + '" data-toggle-focus="1" title="Bow-Tie focus: isolate only direct callers and dependencies of the selected card">Focus <span class="keycap">F</span></button>' : "") +
        '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read this graph">?</button>' +
        "</div>";
      const hudBottomLeft = !inMatrix
        ? '<div class="hud-pill hud-bottom-left">' +
          '<button class="tbtn" data-zoom="in" title="Zoom in (+)">+</button>' +
          '<button class="zoom-pct" id="zoom-pct" data-zoom="fit" title="Reset zoom (0)">' + Math.round(state.scale * 100) + "%</button>" +
          '<button class="tbtn" data-zoom="out" title="Zoom out (-)">−</button>' +
          '<button class="tbtn" data-zoom="fit" title="Fit view (0)">Fit</button>' +
          (canStepUp ? '<button class="tbtn" data-step-up="1" title="Up one level (Backspace)">↑</button>' : "") +
          "</div>"
        : "";
      const hudLegend = !inMatrix
        ? '<div class="hud-pill hud-bottom-center">' + renderLegend(diag).replace('<div class="legend">', "").replace("</div>", "") + '<span class="leg-item"><span class="keycap">2×</span> Drill in</span></div>'
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
      bodyHtml =
        '<div class="workspace' + (state.activeFileGraph || state.e2eTraceSeed || isSingleFileSel ? " code-open" : "") + '">' +
        '<div class="canvas-panel">' +
        hudTopLeft +
        hudTopRight +
        renderInfoPopoverHtml() +
        hudBottomLeft +
        hudLegend +
        (!inMatrix ? renderMinimapHtml(diag) : "") +
        trayHtml +
        '<div class="edge-tooltip" id="edge-tooltip"></div>' +
        '<div class="canvas-shell' + (inMatrix ? " matrix-mode" : "") + '" id="canvas-shell">' +
        (inMatrix ? renderMatrixView(diag) : renderDiagramSvg(diag)) +
        "</div>" +
        "</div>" +
        '<div class="drawer" id="drawer">' + drawerHtml + "</div>" +
        "</div>";
    }

    document.getElementById("app").innerHTML =
      '<div class="studio-bar">' +
      '<div class="bar-left">' +
      '<div class="brand"><span class="brand-dot"></span><span>' + esc(DATA.customUi?.brandLabel || DATA.repo.name) + '</span><span class="brand-ver">v' + esc(DATA.schemaVersion) + '</span><span class="live-badge" id="live-watch-badge"' + (liveWatchConnected ? ' style="display:inline-flex"' : "") + '>LIVE</span></div>' +
      (DATA.customUi?.headerHtml || "") +
      '<div class="tabs">' +
      tabs.map((t) => '<button class="tab' + (state.tab === t.id ? " active" : "") + '" data-tab="' + esc(t.id) + '">' + esc(t.label) + "</button>").join("") +
      "</div>" +
      "</div>" +
      '<div class="bar-right">' +
      '<div class="status-pills">' + statusHtml + "</div>" +
      '<button class="tbtn" data-copy-share="1" title="Copy shareable URL to current view & symbol">Share</button>' +
      '<div class="search-wrap"><input class="search" id="global-search" placeholder="Jump to module, file, symbol..." value="' + esc(state.search) + '" /><span class="search-kbd">/</span>' + renderSearchDropdown() + "</div>" +
      "</div>" +
      "</div>" +
      bodyHtml;
    applyTransform();
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
