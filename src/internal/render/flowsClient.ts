export function renderFlowsClientScript(): string {
  return `
  function flowMethodCls(m) {
    const u = String(m || "").toUpperCase();
    if (u === "GET") return "m-get";
    if (u === "POST") return "m-post";
    if (u === "PUT") return "m-put";
    if (u === "PATCH") return "m-patch";
    if (u === "DELETE") return "m-del";
    return "m-other";
  }

  function renderFlowsTab() {
    const fl = DATA.flows || { workFlows: [], dataHubs: [], stateMachines: [], asyncHandoffs: [], asyncHandoffsSvg: "", asyncCount: 0, hazards: [] };
    const sub = state.flowsSubtab || "workflows";
    const backMapBtn = state.flowReturnFromMap
      ? '<button class="pill-btn" data-return-to-map="1" title="Return to your previous Map / file location">← Map</button><span class="crumb-sep">/</span>'
      : "";
    const navStepBtns =
      '<span class="seg-group">' +
      '<button class="seg-btn" data-flow-step-nav="-1" title="Previous (k)">‹</button>' +
      '<button class="seg-btn" data-flow-step-nav="1" title="Next (j)">›</button>' +
      "</span>";
    const zoomBtns =
      '<span class="seg-group">' +
      '<button class="seg-btn" data-flow-zoom="out" title="Zoom diagram out">−</button>' +
      '<button class="seg-btn" id="fx-zoom-pct" data-flow-zoom="fit" title="Toggle Fit / 100%">100%</button>' +
      '<button class="seg-btn" data-flow-zoom="in" title="Zoom diagram in">+</button>' +
      "</span>";
    const inspToggleBtn =
      '<button class="tbtn' + (state.flowInspectorOpen ? " active" : "") + '" data-toggle-flow-inspector="1" title="Open or close Flow Inspector & Code (])">' +
      (state.flowInspectorOpen ? "Hide Code" : "Code & Details") + "</button>";
    const guideBtn = '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read this view">?</button>';

    let stageHead = "";
    let legendStrip = "";
    let stageBody = "";
    let drawerHtml = "";

    if (sub === "workflows") {
      if (fl.workFlows.length === 0) {
        stageHead = '<div class="fx-stage-head"><div class="fx-head-l">' + backMapBtn + '<span class="crumb-cur">Swimlanes</span></div><div class="fx-head-r">' + guideBtn + "</div></div>";
        stageBody = '<div class="fx-empty">No work flows extracted. Add entrypoints or .repospec/flows.yaml.</div>';
        drawerHtml = '<div class="drawer-body"><div class="muted">Select a work flow to inspect triggers, steps, DDIA tradeoffs, and source code.</div></div>';
      } else {
        const filtered = getFilteredWorkFlows(fl);
        const wf = filtered.find((w) => w.id === state.activeFlowId) || filtered[0] || fl.workFlows[0];
        const mode = state.flowMode === "optimized" ? "optimized" : "current";
        const up = findFlowUpstreamRefs(wf.file);
        const firstRoute = up.routes[0] || null;
        const routeBadge = firstRoute
          ? '<span class="fx-route-tag"><span class="surf-meth mono ' + flowMethodCls(firstRoute.method) + '">' + esc(firstRoute.method) + '</span><span class="fx-route-path" title="' + esc(firstRoute.path) + '">' + esc(firstRoute.path) + "</span></span>"
          : "";
        const modeBtns =
          '<span class="seg-group">' +
          '<button class="seg-btn' + (mode === "current" ? " active" : "") + '" data-flow-mode="current">Current</button>' +
          '<button class="seg-btn' + (mode === "optimized" ? " active" : "") + '" data-flow-mode="optimized">What-If</button>' +
          "</span>";
        stageHead =
          '<div class="fx-stage-head">' +
          '<div class="fx-head-l">' + backMapBtn +
          '<span class="muted" style="font-size:12px">' + esc(flowGroupName(wf)) + '</span><span class="crumb-sep">/</span>' +
          '<span class="crumb-cur">' + esc(wf.name) + "</span>" +
          routeBadge +
          flowPipsHtml(wf.serialAwaitCount) +
          (wf.hazardCount > 0 ? '<span class="fr-hz' + (wf.hasError ? " is-err" : "") + '" title="' + wf.hazardCount + ' DDIA flags">' + wf.hazardCount + "</span>" : "") +
          "</div>" +
          '<div class="fx-head-r">' + modeBtns + zoomBtns + inspToggleBtn + navStepBtns + guideBtn + "</div>" +
          "</div>";
        stageBody = mode === "optimized" && wf.optimizedSvg ? wf.optimizedSvg : wf.svg;

        const selStep = state.flowSelectedStepIdx !== null && state.flowSelectedStepIdx !== undefined
          ? (wf.steps || []).find((s) => s.index === state.flowSelectedStepIdx) || null
          : null;
        const focusFile = state.flowCodeFile || selStep?.file || wf.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : (selStep?.line || wf.line);
        const callees = selStep ? findStepCalleeFiles(wf.file, selStep.fn) : [];

        const upHtml = (up.routes.length > 0 || up.callers.length > 0)
          ? '<div class="sec"><div class="sec-title">What Makes It Happen</div>' +
            up.routes.map((ep) => '<div class="row"><span class="surf-meth mono ' + flowMethodCls(ep.method) + '">' + esc(ep.method) + '</span><span class="mono" style="overflow:hidden;text-overflow:ellipsis">' + esc(ep.path) + "</span></div>").join("") +
            up.callers.map((c) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(c.file) + '" data-flow-jump-line="' + c.line + '"><span class="mono">' + esc(c.file.split("/").pop()) + '</span><span class="mono muted">:' + c.line + " →</span></div>").join("") +
            "</div>"
          : "";

        const stepBox = selStep
          ? '<div class="fx-step-box">' +
            '<div class="mono" style="font-weight:700;color:var(--accent)">Step #' + (selStep.index + 1) + " · " + esc(selStep.fn) + "</div>" +
            '<div class="sub-toggles"><span class="badge b-info">' + esc(selStep.op) + '</span><span class="badge b-na">' + esc(selStep.lane) + '</span><span class="badge b-na">' + (selStep.afterResponse ? "post-response" : "blocking") + "</span>" +
            (selStep.bestEffort ? '<span class="badge b-warn">best-effort</span>' : "") + "</div>" +
            (callees.length > 0
              ? '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="muted" style="font-size:11px">Callees:</span>' +
                callees.map((cf) => '<button class="tbtn" data-flow-jump-file="' + esc(cf.file) + '" data-flow-jump-line="1">' + esc(cf.file.split("/").pop()) + " →</button>").join("") +
                "</div>"
              : "") +
            "</div>"
          : "";

        const hazHtml = (wf.hazards || []).length > 0
          ? '<div class="sec"><div class="sec-title">DDIA Tradeoffs (' + wf.hazards.length + ")</div>" +
            wf.hazards.map((h) =>
              '<div class="fx-haz-card' + (h.severity === "error" ? " is-err" : "") + '" data-flow-jump-file="' + esc(h.file) + '" data-flow-jump-line="' + h.line + '">' +
              '<div class="mono" style="font-weight:600;color:' + (h.severity === "error" ? "var(--err)" : "var(--warn)") + '">' + esc(h.kind) + ' <span class="muted">:' + h.line + "</span></div>" +
              '<div style="font-size:12px;color:var(--text-2);margin-top:3px">' + esc(h.summary) + "</div></div>",
            ).join("") + "</div>"
          : "";

        const ctxCount = up.routes.length + up.callers.length + (wf.hazards || []).length;
        const flSub = state.drawerSubtab === "context" && ctxCount > 0 ? "context" : "code";
        const flTabs = ctxCount > 0
          ? '<div class="drawer-tabs">' +
            '<button class="drawer-tab' + (flSub === "code" ? " active" : "") + '" data-drawer-sub="code">Code</button>' +
            '<button class="drawer-tab' + (flSub === "context" ? " active" : "") + '" data-drawer-sub="context">Triggers &amp; Tradeoffs (' + ctxCount + ")</button>" +
            "</div>"
          : "";
        const flBody = flSub === "context"
          ? (upHtml + hazHtml)
          : (stepBox + renderFlowCodeSnippet(focusFile, focusLine));

        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(wf.name) + '</div><div class="drawer-sub">' + esc(wf.file) + ":" + wf.line + '</div></div>' +
          '<button class="tbtn" data-copy-flow-ctx="' + esc(wf.id) + '" title="Copy DDIA flow brief for an agent">Copy Context</button></div>' +
          flTabs +
          '<div class="drawer-body">' + flBody + "</div>";
      }
    } else if (sub === "hubs") {
      const hubs = getFilteredHubs(fl);
      const targetEntity = state.activeHubEntity || (state.flowSelectedHubField ? String(state.flowSelectedHubField).split("::")[0] : "") || hubs[0]?.entity;
      const hub = hubs.find((h) => h.entity === targetEntity) || hubs[0] || null;
      stageHead =
        '<div class="fx-stage-head">' +
        '<div class="fx-head-l">' + backMapBtn +
        '<span class="muted" style="font-size:12px">Data Hubs</span><span class="crumb-sep">/</span>' +
        '<span class="crumb-cur">' + esc(hub ? hub.entity : "None") + "</span>" +
        (hub ? '<span class="mono muted" style="font-size:12px">' + hub.fieldCount + " fields" + (hub.writerCount ? " · " + hub.writerCount + " writers" : "") + "</span>" : "") +
        "</div>" +
        '<div class="fx-head-r">' + zoomBtns + inspToggleBtn + navStepBtns + guideBtn + "</div>" +
        "</div>";
      legendStrip =
        '<div class="fx-legend-strip">' +
        '<span class="fx-legend-chip">Writers → Field → Readers</span>' +
        '<span class="fx-legend-chip"><span class="fr-dot is-warn"></span>Amber = multi-writer risk</span>' +
        '<span class="fx-legend-chip">┄ Dashed = derived on read</span>' +
        "</div>";
      stageBody = hub ? hub.svg : '<div class="fx-empty">No multi-site entity field lifecycles extracted.</div>';

      const fields = hub?.fields || [];
      const selKey = state.flowSelectedHubField || "";
      const selField = fields.find((f) => (hub.entity + "::" + f.field) === selKey) || fields[0] || null;
      if (!hub || !selField) {
        drawerHtml = '<div class="drawer-body"><div class="muted">Click any field row to inspect its writers, readers, and source code.</div></div>';
      } else {
        const focusFile = state.flowCodeFile || selField.writers?.[0]?.file || selField.readers?.[0]?.file || ".";
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : (selField.writers?.[0]?.line || selField.readers?.[0]?.line || 1);
        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(hub.entity + "." + selField.field) + '</div><div class="drawer-sub">' + (selField.multiWriterRisk ? "Multi-writer SSOT risk" : selField.derivedOnRead ? "Read-time derived" : "Tracked entity field") + "</div></div></div>" +
          '<div class="drawer-body">' +
          '<div class="sec"><div class="sec-title">Writers (' + (selField.writers?.length || 0) + ")</div>" +
          (selField.writers || []).map((w) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(w.file) + '" data-flow-jump-line="' + w.line + '"><span class="mono">' + esc(w.fn) + '</span><span class="mono muted">' + esc(w.mode) + " · " + esc(w.file.split("/").pop()) + ":" + w.line + "</span></div>").join("") +
          "</div>" +
          '<div class="sec"><div class="sec-title">Readers &amp; Derivations (' + (selField.readers?.length || 0) + ")</div>" +
          ((selField.readers || []).length > 0
            ? selField.readers.map((r) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(r.file) + '" data-flow-jump-line="' + r.line + '"><span class="mono">' + esc(r.fn) + '</span><span class="mono muted">' + (r.derived ? "derived · " : "") + esc(r.file.split("/").pop()) + ":" + r.line + "</span></div>").join("")
            : '<div class="muted" style="font-size:12px">Direct document reads.</div>') +
          "</div>" +
          '<div class="sec"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    } else if (sub === "machines") {
      const parts = String(state.flowSelectedSmState || "").split("::");
      const targetSmId = state.activeSmId || parts[0] || fl.stateMachines[0]?.id;
      const sm = fl.stateMachines.find((m) => m.id === targetSmId) || fl.stateMachines[0] || null;
      stageHead =
        '<div class="fx-stage-head">' +
        '<div class="fx-head-l">' + backMapBtn +
        '<span class="muted" style="font-size:12px">Statecharts</span><span class="crumb-sep">/</span>' +
        '<span class="crumb-cur">' + esc(sm ? sm.name : "None") + "</span>" +
        (sm ? '<span class="mono muted" style="font-size:12px">' + sm.stateCount + " states · " + sm.transitionCount + " transitions</span>" : "") +
        "</div>" +
        '<div class="fx-head-r">' + zoomBtns + inspToggleBtn + navStepBtns + guideBtn + "</div>" +
        "</div>";
      stageBody = sm ? sm.svg : '<div class="fx-empty">No declared state machines extracted.</div>';

      if (!sm) {
        drawerHtml = '<div class="drawer-body"><div class="muted">Click any state node to inspect transitions, guards, and callers.</div></div>';
      } else {
        const activeSt = (parts[0] === sm.id ? parts[1] : "") || sm.states?.[0] || "";
        const outTr = (sm.transitions || []).filter((t) => t.from === activeSt);
        const inTr = (sm.transitions || []).filter((t) => t.to === activeSt);
        const up = findFlowUpstreamRefs(sm.file);
        const focusFile = state.flowCodeFile || sm.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : sm.line;
        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(sm.name) + ' · ' + esc(activeSt) + '</div><div class="drawer-sub">' + esc(sm.file) + ":" + sm.line + "</div></div></div>" +
          '<div class="drawer-body">' +
          '<div class="sec"><div class="sec-title">Outgoing Transitions (' + outTr.length + ")</div>" +
          (outTr.length > 0 ? outTr.map((t) => '<div class="row"><span class="mono">→ ' + esc(t.to) + '</span><span class="badge b-na">' + esc(t.guard ? "guard: " + t.guard : t.event) + "</span></div>").join("") : '<div class="muted" style="font-size:12px">Terminal state.</div>') +
          "</div>" +
          '<div class="sec"><div class="sec-title">Incoming Transitions (' + inTr.length + ")</div>" +
          (inTr.length > 0 ? inTr.map((t) => '<div class="row"><span class="mono">' + esc(t.from) + ' →</span><span class="mono muted">' + esc(t.event) + "</span></div>").join("") : '<div class="muted" style="font-size:12px">Initial state.</div>') +
          "</div>" +
          (up.callers.length > 0
            ? '<div class="sec"><div class="sec-title">Files Using This Machine (' + up.callers.length + ")</div>" +
              up.callers.map((c) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(c.file) + '" data-flow-jump-line="' + c.line + '"><span class="mono">' + esc(c.file.split("/").pop()) + '</span><span class="mono muted">:' + c.line + " →</span></div>").join("") + "</div>"
            : "") +
          '<div class="sec"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    } else {
      const ah = (fl.asyncHandoffs || [])[state.flowSelectedAsyncIdx ?? 0];
      stageHead =
        '<div class="fx-stage-head">' +
        '<div class="fx-head-l">' + backMapBtn +
        '<span class="muted" style="font-size:12px">Async Handoffs</span><span class="crumb-sep">/</span>' +
        '<span class="crumb-cur">' + esc(ah ? ah.channel : (fl.asyncCount + " channels")) + "</span>" +
        (ah ? '<span class="badge b-purple">' + esc(ah.transport) + "</span>" : "") +
        "</div>" +
        '<div class="fx-head-r">' + zoomBtns + inspToggleBtn + navStepBtns + guideBtn + "</div>" +
        "</div>";
      stageBody = fl.asyncHandoffsSvg || '<div class="fx-empty">No cross-boundary async handoffs extracted.</div>';
      if (!ah) {
        drawerHtml = '<div class="drawer-body"><div class="muted">Click any async handoff row to inspect producer, channel semantics, and consumer code.</div></div>';
      } else {
        const focusFile = state.flowCodeFile || ah.producer.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : ah.producer.line;
        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(ah.channel) + '</div><div class="drawer-sub">' + esc(ah.transport) + " · " + esc(ah.delivery) + "</div></div></div>" +
          '<div class="drawer-body">' +
          '<div class="sec"><div class="sec-title">Endpoints</div>' +
          '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ah.producer.file) + '" data-flow-jump-line="' + ah.producer.line + '"><span class="mono">Producer: ' + esc(ah.producer.fn) + '</span><span class="mono muted">:' + ah.producer.line + " →</span></div>" +
          (ah.consumer
            ? '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ah.consumer.file) + '" data-flow-jump-line="' + ah.consumer.line + '"><span class="mono">Consumer: ' + esc(ah.consumer.fn) + '</span><span class="mono muted">:' + ah.consumer.line + " →</span></div>"
            : '<div class="muted" style="font-size:12px;margin-top:6px">Consumer lives outside this repository or uses dynamic subscription.</div>') +
          "</div>" +
          '<div class="sec"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    }

    const drawerTopbar =
      '<div class="drawer-topbar"><span class="drawer-kicker">Flow Inspector</span><button class="tbtn" data-toggle-flow-inspector="1" title="Close inspector (Esc)">✕</button></div>';
    const inspectorOverlay = state.flowInspectorOpen
      ? '<aside class="fx-inspector" id="drawer">' + drawerTopbar + drawerHtml + "</aside>"
      : "";
    return (
      '<div class="workspace flows-full" id="workspace">' +
      '<div class="canvas-panel fx' + (state.flowRailHidden ? " rail-off" : "") + '">' +
      renderFlowRail(fl, sub) +
      '<section class="fx-stage">' + stageHead + legendStrip + renderInfoPopoverHtml() +
      '<div class="fx-stage-body" id="fx-stage-body"><div class="fx-svg-wrap" id="fx-svg-wrap">' + stageBody + "</div></div>" +
      inspectorOverlay +
      "</section>" +
      "</div>" +
      "</div>"
    );
  }

  function renderFlowCodeSnippet(filePath, focusLine) {
    if (!filePath || filePath === ".") return '<div class="muted mono">No source file mapped.</div>';
    const fIdx = ddIdxByPath.get(filePath);
    if (fIdx === undefined) return '<div class="mono muted">' + esc(filePath) + ":" + (focusLine || 1) + "</div>";
    if (!FILE_SOURCES) {
      ensureFileSourcesLoaded();
      return '<div class="mono muted">Loading source for ' + esc(filePath) + ":" + (focusLine || 1) + "…</div>";
    }
    const raw = FILE_SOURCES[fIdx];
    if (!raw) return '<div class="mono muted">' + esc(filePath) + ":" + (focusLine || 1) + " (source not embedded in inline mode)</div>";
    const lines = raw.split("\\n");
    const ln = Math.max(1, Math.min(lines.length, Number(focusLine) || 1));
    const start = state.codeFullFile ? 0 : Math.max(0, ln - 8);
    const end = state.codeFullFile ? Math.min(lines.length, start + 140) : Math.min(lines.length, ln + 10);
    const rows = [];
    for (let i = start; i < end; i += 1) {
      const isHi = i + 1 === ln;
      rows.push(
        '<div class="code-line' + (isHi ? " focus-line" : "") + '">' +
        '<span class="code-ln">' + (i + 1) + "</span>" +
        '<span class="code-tx">' + highlightCodeLine(lines[i] || "", filePath) + "</span></div>",
      );
    }
    return (
      '<div class="code-frame">' +
      '<div class="code-chrome">' +
      '<div class="code-chrome-left"><span class="code-fname" title="' + esc(filePath) + '">' + esc(filePath.split("/").pop()) + '</span><span class="code-range">:' + ln + '</span><span class="badge b-na">' + langChipForPath(filePath) + "</span></div>" +
      '<div class="code-chrome-right">' +
      '<button class="tbtn" data-code-full="' + (state.codeFullFile ? "0" : "1") + '">' + (state.codeFullFile ? "Excerpt" : "Full") + "</button>" +
      '<button class="tbtn" data-open-file="' + esc(filePath) + '" data-open-file-line="' + ln + '">Call Graph →</button>' +
      "</div></div>" +
      '<div class="code-box" style="max-height:420px">' + rows.join("") + "</div></div>"
    );
  }

  function findFlowUpstreamRefs(filePath) {
    const routes = (DATA.surfaces?.endpoints || []).filter((ep) => ep.handlerFile === filePath).slice(0, 6);
    const idx = ddIdxByPath.get(filePath);
    const callers = idx !== undefined
      ? (ddInByIdx.get(idx) || []).slice(0, 8).map((c) => ({ file: DD_FILES[c.from]?.p || "", line: c.line })).filter((x) => x.file)
      : [];
    return { routes, callers };
  }

  function findStepCalleeFiles(filePath, fnExpr) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return [];
    const tokens = String(fnExpr || "").split(/[^a-zA-Z0-9]+/).map((t) => t.toLowerCase()).filter((t) => t.length >= 4);
    const out = ddOutByIdx.get(idx) || [];
    const matched = [];
    for (const edge of out) {
      const target = DD_FILES[edge.to];
      if (!target) continue;
      const hay = target.p.toLowerCase();
      if (tokens.some((tok) => hay.includes(tok.replace(/services?$|dao$/, "")))) {
        matched.push({ file: target.p, line: edge.line });
      }
    }
    return matched.slice(0, 5);
  }

  function handleFlowClick(target) {
    const flowSubBtn = target.closest("[data-flows-sub]");
    if (flowSubBtn) {
      state.flowsSubtab = flowSubBtn.getAttribute("data-flows-sub") || "workflows";
      state.flowFilterChip = "all";
      state.flowSearch = "";
      state.flowCodeFile = null;
      render();
      return true;
    }
    if (target.closest("[data-toggle-flow-rail]")) {
      state.flowRailHidden = !state.flowRailHidden;
      render();
      return true;
    }
    if (target.closest("[data-toggle-flow-inspector]")) {
      state.flowInspectorOpen = !state.flowInspectorOpen;
      if (state.flowInspectorOpen) ensureFileSourcesLoaded();
      render();
      return true;
    }
    const fzBtn = target.closest("[data-flow-zoom]");
    if (fzBtn) {
      const dir = fzBtn.getAttribute("data-flow-zoom");
      const cur = typeof state.flowZoom === "number" ? state.flowZoom : 1.05;
      if (dir === "in") state.flowZoom = Math.min(2.4, Number((cur + 0.2).toFixed(2)));
      else if (dir === "out") state.flowZoom = Math.max(0.65, Number((cur - 0.2).toFixed(2)));
      else state.flowZoom = state.flowZoom === "fit" ? 1.05 : "fit";
      applyFlowDiagramScale();
      return true;
    }
    const grpBtn = target.closest("[data-flow-group]");
    if (grpBtn) {
      const k = grpBtn.getAttribute("data-flow-group") || "";
      state.flowRailClosed = state.flowRailClosed || {};
      state.flowRailClosed[k] = !state.flowRailClosed[k];
      rerenderFlowRail();
      return true;
    }
    const chipBtn = target.closest("[data-flow-chip]");
    if (chipBtn) {
      state.flowFilterChip = chipBtn.getAttribute("data-flow-chip") || "all";
      render();
      return true;
    }
    const navBtn = target.closest("[data-flow-step-nav]");
    if (navBtn) {
      stepFlowSelection(Number(navBtn.getAttribute("data-flow-step-nav")) || 1);
      return true;
    }
    const selFlowBtn = target.closest("[data-select-flow]");
    if (selFlowBtn) {
      state.activeFlowId = selFlowBtn.getAttribute("data-select-flow");
      state.flowSelectedStepIdx = null;
      state.flowCodeFile = null;
      render();
      return true;
    }
    const selHubBtn = target.closest("[data-select-hub]");
    if (selHubBtn) {
      const ent = selHubBtn.getAttribute("data-select-hub") || "";
      state.activeHubEntity = ent;
      const hub = (DATA.flows?.dataHubs || []).find((h) => h.entity === ent);
      state.flowSelectedHubField = ent + "::" + (hub?.fields?.[0]?.field || "");
      state.flowCodeFile = null;
      render();
      return true;
    }
    const selSmBtn = target.closest("[data-select-sm]");
    if (selSmBtn) {
      const smId = selSmBtn.getAttribute("data-select-sm") || "";
      state.activeSmId = smId;
      const sm = (DATA.flows?.stateMachines || []).find((m) => m.id === smId);
      state.flowSelectedSmState = smId + "::" + (sm?.states?.[0] || "");
      state.flowCodeFile = null;
      render();
      return true;
    }
    const modeBtn = target.closest("[data-flow-mode]");
    if (modeBtn) {
      state.flowMode = modeBtn.getAttribute("data-flow-mode") || "current";
      render();
      return true;
    }
    const stepEl = target.closest("[data-flow-step]");
    if (stepEl) {
      state.flowSelectedStepIdx = Number(stepEl.getAttribute("data-flow-step"));
      state.flowCodeFile = null;
      state.flowInspectorOpen = true;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const hubEl = target.closest("[data-hub-field]");
    if (hubEl) {
      const key = hubEl.getAttribute("data-hub-field") || "";
      state.flowSelectedHubField = key;
      if (key.includes("::")) state.activeHubEntity = key.split("::")[0];
      state.flowCodeFile = null;
      state.flowInspectorOpen = true;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const smEl = target.closest("[data-sm-state]");
    if (smEl) {
      const key = smEl.getAttribute("data-sm-state") || "";
      state.flowSelectedSmState = key;
      if (key.includes("::")) state.activeSmId = key.split("::")[0];
      state.flowCodeFile = null;
      state.flowInspectorOpen = true;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const asyncEl = target.closest("[data-async-idx]");
    if (asyncEl) {
      state.flowSelectedAsyncIdx = Number(asyncEl.getAttribute("data-async-idx"));
      state.flowCodeFile = null;
      state.flowInspectorOpen = true;
      ensureFileSourcesLoaded();
      render();
      const row = document.querySelector('#fx-stage-body [data-async-idx="' + state.flowSelectedAsyncIdx + '"]');
      if (row) {
        row.classList.add("is-sel");
        if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center" });
      }
      return true;
    }
    const jumpEl = target.closest("[data-flow-jump-file]");
    if (jumpEl) {
      state.flowCodeFile = jumpEl.getAttribute("data-flow-jump-file");
      state.flowCodeLine = Number(jumpEl.getAttribute("data-flow-jump-line")) || 1;
      state.flowInspectorOpen = true;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const copyFlowBtn = target.closest("[data-copy-flow-ctx]");
    if (copyFlowBtn) {
      const fid = copyFlowBtn.getAttribute("data-copy-flow-ctx");
      const wf = (DATA.flows?.workFlows || []).find((w) => w.id === fid);
      if (wf && navigator.clipboard) {
        const lines = [
          "# Work Flow: " + wf.name + " (" + wf.file + ":" + wf.line + ")",
          "Serial awaits: " + wf.serialAwaitCount,
          "## Steps",
          ...(wf.steps || []).map((s) => "- [" + s.op + "/" + s.lane + "] " + s.fn + " (" + s.file + ":" + s.line + ")"),
          "## DDIA Hazards",
          ...(wf.hazards || []).map((h) => "- [" + h.kind + "] " + h.summary),
        ];
        navigator.clipboard.writeText(lines.join("\\n")).catch(() => {});
        copyFlowBtn.textContent = "Copied ✓";
        setTimeout(() => { copyFlowBtn.textContent = "Copy Context"; }, 1400);
      }
      return true;
    }
    return false;
  }
`;
}
