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
      ? '<button class="pill-btn" data-return-to-map="1" title="Return to your previous Map / file location">← Map</button>'
      : "";
    const subNav = renderFlowSubNav(fl, sub);
    const navStepBtns =
      '<span class="seg-group">' +
      '<button class="seg-btn" data-flow-step-nav="-1" title="Previous (k)">‹</button>' +
      '<button class="seg-btn" data-flow-step-nav="1" title="Next (j)">›</button>' +
      "</span>";
    const zoomBtns =
      '<span class="seg-group">' +
      '<button class="seg-btn" data-flow-zoom="out" title="Zoom out (-)">−</button>' +
      '<button class="seg-btn" id="fx-zoom-pct" data-flow-zoom="reset" title="Reset to 100%">100%</button>' +
      '<button class="seg-btn" data-flow-zoom="in" title="Zoom in (+)">+</button>' +
      '<button class="seg-btn" data-flow-zoom="fit" title="Fit diagram to canvas (0)">Fit</button>' +
      "</span>";
    const dockToggleBtn =
      '<button class="tbtn' + (!state.flowDockCollapsed ? " active" : "") + '" data-toggle-flow-dock="1" title="Collapse or expand bottom workbench (])">' +
      (state.flowDockCollapsed ? "▴ Panel" : "▾ Panel") + "</button>";
    const guideBtn = '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read this view">?</button>';

    let stageHead = "";
    let legendStrip = "";
    let stageBody = "";
    let ctxTitle = "Details";
    let ctxAction = "";
    let ctxHtml = '<div class="muted" style="font-size:12px">Select an item below to inspect triggers, tradeoffs, and code.</div>';
    let codeHtml = '<div class="muted mono" style="padding:12px">No source file mapped.</div>';

    if (sub === "journeys") {
      const jv = renderJourneyView(backMapBtn, subNav, zoomBtns, dockToggleBtn, navStepBtns, guideBtn);
      stageHead = jv.stageHead; legendStrip = jv.legendStrip; stageBody = jv.stageBody; ctxTitle = jv.ctxTitle; ctxAction = jv.ctxAction; ctxHtml = jv.ctxHtml; codeHtml = jv.codeHtml;
    } else if (sub === "workflows") {
      if (fl.workFlows.length === 0) {
        stageHead = '<div class="fx-stage-head"><div class="fx-head-l">' + backMapBtn + subNav + '</div><div class="fx-head-r">' + dockToggleBtn + guideBtn + "</div></div>";
        stageBody = '<div class="fx-empty">No work flows extracted. Add entrypoints or .repospec/flows.yaml.</div>';
      } else {
        const grouped = groupFilteredWorkFlows(fl);
        const flatOrdered = grouped.flatMap((g) => g[1]);
        const wf = flatOrdered.find((w) => w.id === state.activeFlowId) || flatOrdered[0] || fl.workFlows[0];
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
          '<div class="fx-head-l">' + backMapBtn + subNav +
          '<span class="hud-sep"></span>' +
          '<span class="muted" style="font-size:12px">' + esc(flowGroupName(wf)) + '</span><span class="crumb-sep">/</span>' +
          '<span class="crumb-cur">' + esc(wf.name) + "</span>" +
          routeBadge + flowPipsHtml(wf.serialAwaitCount) +
          (wf.hazardCount > 0 ? '<span class="fr-hz' + (wf.hasError ? " is-err" : "") + '">' + wf.hazardCount + "</span>" : "") +
          "</div>" +
          '<div class="fx-head-r">' + modeBtns + zoomBtns + dockToggleBtn + navStepBtns + guideBtn + "</div>" +
          "</div>";
        stageBody = mode === "optimized" && wf.optimizedSvg ? wf.optimizedSvg : wf.svg;

        const selStep = state.flowSelectedStepIdx !== null && state.flowSelectedStepIdx !== undefined
          ? (wf.steps || []).find((s) => s.index === state.flowSelectedStepIdx) || null
          : null;
        const focusFile = state.flowCodeFile || selStep?.file || wf.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : (selStep?.line || wf.line);
        const callees = selStep ? findStepCalleeFiles(wf.file, selStep.fn) : [];

        const stepBox = selStep
          ? '<div class="fx-step-box">' +
            '<div class="mono" style="font-weight:700;color:var(--accent)">Step #' + (selStep.index + 1) + " · " + esc(selStep.fn) + "</div>" +
            '<div class="sub-toggles"><span class="badge b-info">' + esc(selStep.op) + '</span><span class="badge b-na">' + esc(selStep.lane) + '</span><span class="badge b-na">' + (selStep.afterResponse ? "post-response" : "blocking") + "</span>" +
            (selStep.bestEffort ? '<span class="badge b-warn">best-effort</span>' : "") + "</div>" +
            (callees.length > 0
              ? '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center"><span class="muted" style="font-size:11px">Callees:</span>' +
                callees.map((cf) => '<button class="tbtn" data-flow-jump-file="' + esc(cf.file) + '" data-flow-jump-line="1">' + esc(cf.file.split("/").pop()) + " →</button>").join("") +
                "</div>"
              : "") +
            "</div>"
          : "";

        const upHtml = (up.routes.length > 0 || up.callers.length > 0)
          ? '<div><div class="sec-title" style="margin-bottom:4px">What Makes It Happen</div>' +
            up.routes.map((ep) => '<div class="row"><span class="surf-meth mono ' + flowMethodCls(ep.method) + '">' + esc(ep.method) + '</span><span class="mono" style="overflow:hidden;text-overflow:ellipsis">' + esc(ep.path) + "</span></div>").join("") +
            up.callers.map((c) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(c.file) + '" data-flow-jump-line="' + c.line + '"><span class="mono">' + esc(c.file.split("/").pop()) + '</span><span class="mono muted">:' + c.line + " →</span></div>").join("") +
            "</div>"
          : "";

        const hazHtml = (wf.hazards || []).length > 0
          ? '<div><div class="sec-title" style="margin-bottom:5px">DDIA Tradeoffs (' + wf.hazards.length + ")</div>" +
            '<div style="display:flex;flex-direction:column;gap:6px">' +
            wf.hazards.map((h) =>
              '<div class="fx-haz-card' + (h.severity === "error" ? " is-err" : "") + '" data-flow-jump-file="' + esc(h.file) + '" data-flow-jump-line="' + h.line + '">' +
              '<div class="mono" style="font-weight:600;color:' + (h.severity === "error" ? "var(--err)" : "var(--warn)") + '">' + esc(h.kind) + ' <span class="muted">:' + h.line + "</span></div>" +
              '<div style="font-size:12px;color:var(--text-2);margin-top:2px">' + esc(h.summary) + "</div></div>",
            ).join("") + "</div></div>"
          : "";

        ctxTitle = esc(wf.name) + ' <span class="mono muted" style="font-weight:400">' + wf.serialAwaitCount + " awaits</span>";
        ctxAction = '<button class="tbtn" data-copy-flow-ctx="' + esc(wf.id) + '" title="Copy DDIA flow brief for an agent">Copy Context</button>';
        ctxHtml = (stepBox + hazHtml + upHtml) || '<div class="muted" style="font-size:12px">Click any step bar above to inspect callees and exact line code.</div>';
        codeHtml = renderFlowCodeSnippet(focusFile, focusLine);
      }
    } else if (sub === "hubs") {
      const hubs = getFilteredHubs(fl);
      const targetEntity = state.activeHubEntity || (state.flowSelectedHubField ? String(state.flowSelectedHubField).split("::")[0] : "") || hubs[0]?.entity;
      const hub = hubs.find((h) => h.entity === targetEntity) || hubs[0] || null;
      stageHead =
        '<div class="fx-stage-head">' +
        '<div class="fx-head-l">' + backMapBtn + subNav +
        '<span class="hud-sep"></span><span class="crumb-cur">' + esc(hub ? hub.entity : "None") + "</span>" +
        (hub ? '<span class="mono muted" style="font-size:12px">' + hub.fieldCount + " fields" + (hub.writerCount ? " · " + hub.writerCount + " writers" : "") + "</span>" : "") +
        "</div>" +
        '<div class="fx-head-r">' + zoomBtns + dockToggleBtn + navStepBtns + guideBtn + "</div>" +
        "</div>";
      legendStrip =
        '<div class="fx-legend-strip">' +
        '<span class="fx-legend-chip">Who changes it → Field on model → Who reads it</span>' +
        '<span class="fx-legend-chip"><span class="fr-dot is-warn"></span>Amber = 3+ separate backend files edit this field</span>' +
        '<span class="fx-legend-chip">┄ Dashed = computed on read (not stored)</span>' +
        "</div>";
      stageBody = hub ? hub.svg : '<div class="fx-empty">No multi-site entity field lifecycles extracted.</div>';

      const fields = hub?.fields || [];
      const selKey = state.flowSelectedHubField || "";
      const selField = fields.find((f) => (hub.entity + "::" + f.field) === selKey) || fields[0] || null;
      if (hub && selField) {
        const focusFile = state.flowCodeFile || selField.writers?.[0]?.file || selField.readers?.[0]?.file || ".";
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : (selField.writers?.[0]?.line || selField.readers?.[0]?.line || 1);
        ctxTitle = '<span class="mono">' + esc(hub.entity + "." + selField.field) + "</span>";
        ctxAction =
          '<span style="display:inline-flex;align-items:center;gap:6px">' +
          (selField.multiWriterRisk ? '<span class="badge b-warn">3+ files edit</span>' : selField.derivedOnRead ? '<span class="badge b-info">computed</span>' : '<span class="badge b-pass">clean owner</span>') +
          '<button class="tbtn" data-copy-hub-ctx="' + esc(hub.entity) + '">Copy Context</button></span>';
        ctxHtml =
          '<div><div class="sec-title" style="margin-bottom:4px">Edited By (' + (selField.writers?.length || 0) + ")</div>" +
          (selField.writers || []).map((w) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(w.file) + '" data-flow-jump-line="' + w.line + '"><span class="mono">' + esc(w.fn) + '</span><span class="mono muted">' + esc(w.mode) + " · " + esc(w.file.split("/").pop()) + ":" + w.line + "</span></div>").join("") +
          "</div>" +
          '<div><div class="sec-title" style="margin-bottom:4px">Read By (' + (selField.readers?.length || 0) + ")</div>" +
          ((selField.readers || []).length > 0
            ? selField.readers.map((r) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(r.file) + '" data-flow-jump-line="' + r.line + '"><span class="mono">' + esc(r.fn) + '</span><span class="mono muted">' + (r.derived ? "formula · " : "") + esc(r.file.split("/").pop()) + ":" + r.line + "</span></div>").join("")
            : '<div class="muted" style="font-size:12px">Read as part of the whole document (no field-specific projection).</div>') +
          "</div>";
        codeHtml = renderFlowCodeSnippet(focusFile, focusLine);
      }
    } else if (sub === "machines") {
      const parts = String(state.flowSelectedSmState || "").split("::");
      const targetSmId = state.activeSmId || parts[0] || fl.stateMachines[0]?.id;
      const sm = fl.stateMachines.find((m) => m.id === targetSmId) || fl.stateMachines[0] || null;
      stageHead =
        '<div class="fx-stage-head">' +
        '<div class="fx-head-l">' + backMapBtn + subNav +
        '<span class="hud-sep"></span><span class="crumb-cur">' + esc(sm ? sm.name : "None") + "</span>" +
        (sm ? '<span class="mono muted" style="font-size:12px">' + sm.stateCount + " states · " + sm.transitionCount + " transitions</span>" : "") +
        "</div>" +
        '<div class="fx-head-r">' + zoomBtns + dockToggleBtn + navStepBtns + guideBtn + "</div>" +
        "</div>";
      stageBody = sm ? sm.svg : '<div class="fx-empty">No declared state machines extracted.</div>';

      if (sm) {
        const activeSt = (parts[0] === sm.id ? parts[1] : "") || sm.states?.[0] || "";
        const outTr = (sm.transitions || []).filter((t) => t.from === activeSt);
        const inTr = (sm.transitions || []).filter((t) => t.to === activeSt);
        const up = findFlowUpstreamRefs(sm.file);
        const focusFile = state.flowCodeFile || sm.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : sm.line;
        ctxTitle = esc(sm.name) + ' · <span class="mono">' + esc(activeSt) + "</span>";
        ctxHtml =
          '<div><div class="sec-title" style="margin-bottom:4px">Outgoing (' + outTr.length + ")</div>" +
          (outTr.length > 0 ? outTr.map((t) => '<div class="row"><span class="mono">→ ' + esc(t.to) + '</span><span class="badge b-na">' + esc(t.guard ? "guard: " + t.guard : t.event) + "</span></div>").join("") : '<div class="muted" style="font-size:12px">Terminal state.</div>') +
          "</div>" +
          '<div><div class="sec-title" style="margin-bottom:4px">Incoming (' + inTr.length + ")</div>" +
          (inTr.length > 0 ? inTr.map((t) => '<div class="row"><span class="mono">' + esc(t.from) + ' →</span><span class="mono muted">' + esc(t.event) + "</span></div>").join("") : '<div class="muted" style="font-size:12px">Initial state.</div>') +
          "</div>" +
          (up.callers.length > 0
            ? '<div><div class="sec-title" style="margin-bottom:4px">Callers (' + up.callers.length + ")</div>" +
              up.callers.map((c) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(c.file) + '" data-flow-jump-line="' + c.line + '"><span class="mono">' + esc(c.file.split("/").pop()) + '</span><span class="mono muted">:' + c.line + " →</span></div>").join("") + "</div>"
            : "");
        codeHtml = renderFlowCodeSnippet(focusFile, focusLine);
      }
    } else {
      const ah = (fl.asyncHandoffs || [])[state.flowSelectedAsyncIdx ?? 0];
      stageHead =
        '<div class="fx-stage-head">' +
        '<div class="fx-head-l">' + backMapBtn + subNav +
        '<span class="hud-sep"></span><span class="crumb-cur">' + esc(ah ? ah.channel : (fl.asyncCount + " channels")) + "</span>" +
        (ah ? '<span class="badge b-purple">' + esc(ah.transport) + "</span>" : "") +
        "</div>" +
        '<div class="fx-head-r">' + zoomBtns + dockToggleBtn + navStepBtns + guideBtn + "</div>" +
        "</div>";
      legendStrip =
        '<div class="fx-legend-strip">' +
        '<span class="fx-legend-chip">What fires it → Background channel → What handles it</span>' +
        '<span class="fx-legend-chip">Shows cron jobs, push notifications &amp; queues that import arrows cannot see</span>' +
        "</div>";
      stageBody = fl.asyncHandoffsSvg || '<div class="fx-empty">No cross-boundary async handoffs extracted.</div>';
      if (ah) {
        const focusFile = state.flowCodeFile || ah.producer.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : ah.producer.line;
        ctxTitle = '<span class="mono">' + esc(ah.channel) + "</span>";
        ctxAction = '<span class="badge b-purple">' + esc(ah.delivery) + "</span>";
        ctxHtml =
          '<div><div class="sec-title" style="margin-bottom:4px">Background Handoff</div>' +
          '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ah.producer.file) + '" data-flow-jump-line="' + ah.producer.line + '"><span class="mono">Fired by: ' + esc(ah.producer.fn) + '</span><span class="mono muted">:' + ah.producer.line + " →</span></div>" +
          (ah.consumer
            ? '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ah.consumer.file) + '" data-flow-jump-line="' + ah.consumer.line + '"><span class="mono">Handled by: ' + esc(ah.consumer.fn) + '</span><span class="mono muted">:' + ah.consumer.line + " →</span></div>"
            : '<div class="muted" style="font-size:12px;margin-top:6px">' + (ah.transport === "fcm" ? "Delivered to the mobile app via Firebase Cloud Messaging (outside this backend repo)." : "Handled outside this repository or via a dynamic URL/subscription.") + "</div>") +
          "</div>";
        codeHtml = renderFlowCodeSnippet(focusFile, focusLine);
      }
    }

    const dockStyle = state.flowDockHeight && !state.flowDockCollapsed ? ' style="--fx-dock-h:' + state.flowDockHeight + 'px"' : "";
    return (
      '<div class="workspace flows-full" id="workspace">' +
      '<div class="fx-col" id="fx-col">' +
      stageHead + legendStrip + renderInfoPopoverHtml() +
      '<div class="fx-diagram-pane" id="fx-stage-body"><div class="fx-svg-wrap" id="fx-svg-wrap">' + stageBody + "</div></div>" +
      (!state.flowDockCollapsed ? '<div class="fx-h-resizer" id="fx-h-resizer" title="Drag to resize · Double-click to reset"></div>' : "") +
      '<div class="fx-dock' + (state.flowDockCollapsed ? " is-collapsed" : "") + '" id="fx-dock"' + dockStyle + ">" +
      renderFlowBrowserCol(fl, sub) +
      '<section class="fx-dock-col"><div class="fx-dock-head"><span class="drawer-title" style="font-size:13px">' + ctxTitle + "</span>" + ctxAction + '</div><div class="fx-dock-body">' + ctxHtml + "</div></section>" +
      '<section class="fx-dock-col is-code"><div class="fx-code-body">' + codeHtml + "</div></section>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderFlowCodeSnippet(filePath, focusLine) {
    if (!filePath || filePath === ".") return '<div class="muted mono" style="padding:10px">No source file mapped.</div>';
    const fIdx = ddIdxByPath.get(filePath);
    const extraRaw = DATA.drilldown?.extraSources?.[filePath];
    if (fIdx === undefined && !extraRaw) return '<div class="mono muted" style="padding:10px">' + esc(filePath) + ":" + (focusLine || 1) + "</div>";
    let raw = extraRaw || "";
    if (fIdx !== undefined) {
      if (!FILE_SOURCES) {
        ensureFileSourcesLoaded();
        return '<div class="mono muted" style="padding:10px">Loading source for ' + esc(filePath) + ":" + (focusLine || 1) + "…</div>";
      }
      raw = FILE_SOURCES[fIdx] || extraRaw || "";
    }
    if (!raw) return '<div class="mono muted" style="padding:10px">' + esc(filePath) + ":" + (focusLine || 1) + " (source not embedded in inline mode)</div>";
    const lines = raw.split("\\n");
    const ln = Math.max(1, Math.min(lines.length, Number(focusLine) || 1));
    const start = state.codeFullFile ? 0 : Math.max(0, ln - 8);
    const end = state.codeFullFile ? Math.min(lines.length, start + 140) : Math.min(lines.length, ln + 12);
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
      '<div class="code-chrome-left"><span class="code-fname" title="' + esc(filePath) + '">' + esc(filePath) + '</span><span class="code-range">:' + ln + '</span><span class="badge b-na">' + langChipForPath(filePath) + "</span></div>" +
      '<div class="code-chrome-right">' +
      '<button class="tbtn" data-code-full="' + (state.codeFullFile ? "0" : "1") + '">' + (state.codeFullFile ? "Excerpt" : "Full") + "</button>" +
      (fIdx !== undefined ? '<button class="tbtn" data-open-file="' + esc(filePath) + '" data-open-file-line="' + ln + '">Call Graph →</button>' : "") +
      "</div></div>" +
      '<div class="code-box">' + rows.join("") + "</div></div>"
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
      if (tokens.some((tok) => hay.includes(tok.replace(/services?$|dao$/, "")))) matched.push({ file: target.p, line: edge.line });
    }
    return matched.slice(0, 5);
  }

  function applyHubHoverSpotlight(nodeEl) {
    const svg = nodeEl?.closest(".rs-hub-svg");
    if (!svg) return;
    svg.querySelectorAll(".is-hi").forEach((el) => el.classList.remove("is-hi"));
    svg.classList.add("hub-hover");
    nodeEl.classList.add("is-hi");
    const fid = nodeEl.getAttribute("data-hub-file-id"), rid = nodeEl.getAttribute("data-hub-reader-id"), fIdx = nodeEl.getAttribute("data-hub-fld-idx");
    svg.querySelectorAll(".rs-hub-edge").forEach((edge) => {
      const eSrc = edge.getAttribute("data-hub-src"), eDst = edge.getAttribute("data-hub-dst"), eFld = edge.getAttribute("data-hub-fld");
      if ((fid && eSrc === fid) || (rid && eDst === rid) || (fIdx !== null && eFld === fIdx)) {
        edge.classList.add("is-hi");
        if (eSrc) svg.querySelector('[data-hub-file-id="' + eSrc + '"]')?.classList.add("is-hi");
        if (eDst) svg.querySelector('[data-hub-reader-id="' + eDst + '"]')?.classList.add("is-hi");
        if (eFld !== null) svg.querySelector('[data-hub-fld-idx="' + eFld + '"]')?.classList.add("is-hi");
      }
    });
  }

  function clearHubHoverSpotlight() {
    document.querySelectorAll(".rs-hub-svg.hub-hover").forEach((svg) => {
      svg.classList.remove("hub-hover");
      svg.querySelectorAll(".is-hi").forEach((el) => el.classList.remove("is-hi"));
    });
  }

  function handleFlowClick(target) {
    if (handleJourneyClick(target)) return true;
    const flowSubBtn = target.closest("[data-flows-sub]");
    if (flowSubBtn) { state.flowsSubtab = flowSubBtn.getAttribute("data-flows-sub") || "workflows"; state.flowFilterChip = "all"; state.flowSearch = ""; state.flowCodeFile = null; render(); return true; }
    if (target.closest("[data-toggle-flow-dock]")) { state.flowDockCollapsed = !state.flowDockCollapsed; render(); return true; }
    const fzBtn = target.closest("[data-flow-zoom]");
    if (fzBtn) {
      const dir = fzBtn.getAttribute("data-flow-zoom");
      const r = document.getElementById("fx-stage-body")?.getBoundingClientRect();
      if (dir === "in" && r) zoomFlowAround(r.left + r.width / 2, r.top + r.height / 2, 1.22);
      else if (dir === "out" && r) zoomFlowAround(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.22);
      else if (dir === "reset") fitFlowCanvas(1);
      else fitFlowCanvas();
      return true;
    }
    const grpBtn = target.closest("[data-flow-group]");
    if (grpBtn) { const k = grpBtn.getAttribute("data-flow-group") || ""; state.flowRailClosed = state.flowRailClosed || {}; state.flowRailClosed[k] = !state.flowRailClosed[k]; rerenderFlowRail(); return true; }
    const chipBtn = target.closest("[data-flow-chip]");
    if (chipBtn) { state.flowFilterChip = chipBtn.getAttribute("data-flow-chip") || "all"; render(); return true; }
    const navBtn = target.closest("[data-flow-step-nav]");
    if (navBtn) { stepFlowSelection(Number(navBtn.getAttribute("data-flow-step-nav")) || 1); return true; }
    const selFlowBtn = target.closest("[data-select-flow]");
    if (selFlowBtn) { state.activeFlowId = selFlowBtn.getAttribute("data-select-flow"); state.flowSelectedStepIdx = null; state.flowCodeFile = null; ensureFileSourcesLoaded(); render(); return true; }
    const selHubBtn = target.closest("[data-select-hub]");
    if (selHubBtn) {
      const ent = selHubBtn.getAttribute("data-select-hub") || "";
      state.activeHubEntity = ent;
      const hub = (DATA.flows?.dataHubs || []).find((h) => h.entity === ent);
      state.flowSelectedHubField = ent + "::" + (hub?.fields?.[0]?.field || "");
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
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
      ensureFileSourcesLoaded();
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
      state.flowDockCollapsed = false;
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
      state.flowDockCollapsed = false;
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
      state.flowDockCollapsed = false;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const asyncEl = target.closest("[data-async-idx]");
    if (asyncEl) {
      state.flowSelectedAsyncIdx = Number(asyncEl.getAttribute("data-async-idx"));
      state.flowCodeFile = null;
      state.flowDockCollapsed = false;
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
      state.flowDockCollapsed = false;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const copyHubBtn = target.closest("[data-copy-hub-ctx]");
    if (copyHubBtn) {
      const ent = copyHubBtn.getAttribute("data-copy-hub-ctx");
      const hub = (DATA.flows?.dataHubs || []).find((h) => h.entity === ent);
      if (hub) {
        const lines = [
          "# Data Hub: " + hub.entity + " (" + hub.fieldCount + " fields, " + (hub.writerCount || 0) + " writer files)",
          ...(hub.fields || []).map((f) =>
            "- **" + f.field + "**" + (f.multiWriterRisk ? " [3+ files edit]" : "") +
            " — Edited by: " + ((f.writers || []).map((w) => w.fn + " (" + w.file + ":" + w.line + ")").join(", ") || "none") +
            ((f.readers || []).length > 0 ? " | Read by: " + f.readers.map((r) => r.fn + " (" + r.file + ":" + r.line + ")").join(", ") : "")
          ),
        ];
        copyTextToClipboard(lines.join("\\n"), copyHubBtn, "Copy Context");
      }
      return true;
    }
    const copyFlowBtn = target.closest("[data-copy-flow-ctx]");
    if (copyFlowBtn) {
      const fid = copyFlowBtn.getAttribute("data-copy-flow-ctx");
      const wf = (DATA.flows?.workFlows || []).find((w) => w.id === fid);
      if (wf) {
        const lines = [
          "# Work Flow: " + wf.name + " (" + wf.file + ":" + wf.line + ")",
          "Serial awaits: " + wf.serialAwaitCount,
          "## Steps",
          ...(wf.steps || []).map((s) => "- [" + s.op + "/" + s.lane + "] " + s.fn + " (" + s.file + ":" + s.line + ")"),
          "## DDIA Hazards",
          ...(wf.hazards || []).map((h) => "- [" + h.kind + "] " + h.summary),
        ];
        copyTextToClipboard(lines.join("\\n"), copyFlowBtn, "Copy Context");
      }
      return true;
    }
    return false;
  }
`;
}
