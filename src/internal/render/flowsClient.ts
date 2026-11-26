export function renderFlowsClientScript(): string {
  return `
  function renderFlowsTab() {
    const fl = DATA.flows || { workFlows: [], dataHubs: [], stateMachines: [], asyncHandoffs: [], asyncHandoffsSvg: "", asyncCount: 0, hazards: [] };
    const sub = state.flowsSubtab || "workflows";
    const q = String(state.flowSearch || "").trim().toLowerCase();
    const hzOnly = Boolean(state.flowHazardsOnly);
    const subBtns =
      '<button class="pill-btn' + (sub === "workflows" ? " active" : "") + '" data-flows-sub="workflows">Swimlane Waterfalls (' + fl.workFlows.length + ")</button>" +
      '<button class="pill-btn' + (sub === "hubs" ? " active" : "") + '" data-flows-sub="hubs">Data Hubs (' + fl.dataHubs.length + ")</button>" +
      '<button class="pill-btn' + (sub === "machines" ? " active" : "") + '" data-flows-sub="machines">Statecharts (' + fl.stateMachines.length + ")</button>" +
      '<button class="pill-btn' + (sub === "async" ? " active" : "") + '" data-flows-sub="async">Async Handoffs (' + (fl.asyncCount || 0) + ")</button>";

    let content = "";
    let drawerHtml = "";

    if (sub === "workflows") {
      if (fl.workFlows.length === 0) {
        content = '<div class="muted" style="padding:16px">No work flows extracted. Add entrypoints or .repospec/flows.yaml.</div>';
        drawerHtml = '<div class="drawer-body"><div class="muted">Select a work flow to inspect triggers, steps, DDIA tradeoffs, and source code.</div></div>';
      } else {
        const filtered = fl.workFlows.filter(
          (w) => (!hzOnly || (w.hazards && w.hazards.length > 0)) && (!q || (w.name + " " + w.file).toLowerCase().includes(q)),
        );
        const wf = filtered.find((w) => w.id === state.activeFlowId) || filtered[0] || fl.workFlows[0];
        const mode = state.flowMode === "optimized" ? "optimized" : "current";
        const picker = filtered.slice(0, 14).map((w) => {
          const badge = w.hazardCount > 0 ? " [" + w.hazardCount + "!]" : "";
          return '<button class="pill-btn' + (w.id === wf.id ? " active" : "") + '" data-select-flow="' + esc(w.id) + '">' + esc(w.name) + badge + "</button>";
        }).join("");
        const modeBtns =
          '<span class="seg-group">' +
          '<button class="seg-btn' + (mode === "current" ? " active" : "") + '" data-flow-mode="current">Current</button>' +
          '<button class="seg-btn' + (mode === "optimized" ? " active" : "") + '" data-flow-mode="optimized">What-If (Optimized)</button>' +
          "</span>";
        content =
          '<div class="sub-toggles" style="margin-bottom:10px;flex-wrap:wrap">' + picker + "</div>" +
          '<div class="card" style="padding:14px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          '<div><strong>' + esc(wf.name) + '</strong> <span class="mono muted">' + esc(wf.file) + ":" + wf.line + " · " + wf.serialAwaitCount + " serial awaits</span></div>" +
          modeBtns + "</div>" +
          (mode === "optimized" && wf.optimizedSvg ? wf.optimizedSvg : wf.svg) +
          '<div class="muted" style="font-size:11.5px;margin-top:8px">Click any step bar to inspect what triggers it, what it calls, DDIA hazards, and syntax-highlighted code.</div>' +
          "</div>";

        const selStep = state.flowSelectedStepIdx !== null && state.flowSelectedStepIdx !== undefined
          ? (wf.steps || []).find((s) => s.index === state.flowSelectedStepIdx) || null
          : null;
        const focusFile = state.flowCodeFile || selStep?.file || wf.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : (selStep?.line || wf.line);
        const up = findFlowUpstreamRefs(wf.file);
        const callees = selStep ? findStepCalleeFiles(wf.file, selStep.fn) : [];

        const upHtml =
          '<div style="margin-top:10px"><div class="sec-title">What Makes It Happen (Triggers &amp; Callers)</div>' +
          (up.routes.length > 0
            ? up.routes.map((ep) => '<div class="row"><span class="badge">' + esc(ep.method) + '</span><span class="mono">' + esc(ep.path) + "</span></div>").join("")
            : "") +
          (up.callers.length > 0
            ? up.callers.map((c) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(c.file) + '" data-flow-jump-line="' + c.line + '"><span class="mono">' + esc(c.file.split("/").pop()) + '</span><span class="mono muted">:' + c.line + " →</span></div>").join("")
            : '<div class="muted" style="font-size:12px">Entrypoint (' + esc(wf.triggerKind || "http") + ") — no static upstream importers.</div>") +
          "</div>";

        const stepBox = selStep
          ? '<div class="card" style="padding:10px;margin-bottom:10px;border-color:rgba(124,200,255,0.45)">' +
            '<div class="mono" style="font-weight:700;color:#7cc8ff">Step #' + (selStep.index + 1) + " · " + esc(selStep.fn) + "</div>" +
            '<div class="sub-toggles" style="margin-top:6px"><span class="badge">' + esc(selStep.op) + '</span><span class="badge">' + esc(selStep.lane) + '</span><span class="badge">' + (selStep.afterResponse ? "post-response" : "blocking") + "</span>" +
            (selStep.bestEffort ? '<span class="badge">best-effort</span>' : "") + "</div>" +
            (callees.length > 0
              ? '<div style="margin-top:8px"><span class="muted" style="font-size:11px">Resolved callee modules:</span> ' +
                callees.map((cf) => '<button class="tbtn" data-flow-jump-file="' + esc(cf.file) + '" data-flow-jump-line="1">Def: ' + esc(cf.file.split("/").pop()) + " →</button>").join(" ") +
                "</div>"
              : "") +
            "</div>"
          : "";

        const hazHtml = (wf.hazards || []).length > 0
          ? '<div style="margin-top:10px"><div class="sec-title">DDIA Tradeoffs (' + wf.hazards.length + ")</div>" +
            wf.hazards.map((h) =>
              '<div class="card" style="padding:8px 10px;margin-top:6px;cursor:pointer;border-left:3px solid ' + (h.severity === "error" ? "#ef4444" : "#f59e0b") + '" data-flow-jump-file="' + esc(h.file) + '" data-flow-jump-line="' + h.line + '">' +
              '<div class="mono" style="font-weight:700;color:' + (h.severity === "error" ? "#f87171" : "#fbbf24") + '">' + esc(h.kind) + ' <span class="muted">:' + h.line + "</span></div>" +
              '<div style="font-size:12px;color:#cbd5e1;margin-top:3px">' + esc(h.summary) + "</div></div>",
            ).join("") + "</div>"
          : "";

        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(wf.name) + '</div><div class="mono muted">' + esc(wf.file) + ":" + wf.line + '</div></div>' +
          '<button class="tbtn" data-copy-flow-ctx="' + esc(wf.id) + '" title="Copy DDIA flow brief for an agent">Copy Context</button></div>' +
          '<div class="drawer-body">' + stepBox + upHtml + hazHtml +
          '<div style="margin-top:12px"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    } else if (sub === "hubs") {
      content = fl.dataHubs.length === 0
        ? '<div class="muted" style="padding:16px">No multi-site entity field lifecycles extracted.</div>'
        : fl.dataHubs
            .filter((h) => !q || h.entity.toLowerCase().includes(q))
            .map((h) => '<div class="card" style="padding:14px;margin-bottom:12px"><div style="margin-bottom:8px"><strong>Entity Hub: ' + esc(h.entity) + '</strong> <span class="mono muted">' + h.fieldCount + " tracked fields · click any row to inspect writers &amp; code</span></div>" + h.svg + "</div>")
            .join("") || '<div class="muted" style="padding:16px">No matching entity hubs.</div>';
      const hubs = fl.dataHubs.filter((h) => !q || h.entity.toLowerCase().includes(q));

      const allFields = hubs.flatMap((h) => (h.fields || []).map((f) => ({ key: h.entity + "::" + f.field, entity: h.entity, field: f })));
      const sel = allFields.find((x) => x.key === state.flowSelectedHubField) || allFields[0];
      if (!sel) {
        drawerHtml = '<div class="drawer-body"><div class="muted">Click any field row to inspect its writers, readers, and source code.</div></div>';
      } else {
        const f = sel.field;
        const focusFile = state.flowCodeFile || f.writers?.[0]?.file || f.readers?.[0]?.file || ".";
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : (f.writers?.[0]?.line || f.readers?.[0]?.line || 1);
        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(sel.entity + "." + f.field) + '</div><div class="mono muted">' + (f.multiWriterRisk ? "Multi-writer SSOT risk" : f.derivedOnRead ? "Read-time derived" : "Tracked entity field") + "</div></div></div>" +
          '<div class="drawer-body">' +
          '<div class="sec-title">Writers (' + (f.writers?.length || 0) + ")</div>" +
          (f.writers || []).map((w) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(w.file) + '" data-flow-jump-line="' + w.line + '"><span class="mono">' + esc(w.fn) + '</span><span class="mono muted">' + esc(w.mode) + " · " + esc(w.file.split("/").pop()) + ":" + w.line + "</span></div>").join("") +
          '<div class="sec-title" style="margin-top:10px">Readers &amp; Derivations (' + (f.readers?.length || 0) + ")</div>" +
          ((f.readers || []).length > 0
            ? f.readers.map((r) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(r.file) + '" data-flow-jump-line="' + r.line + '"><span class="mono">' + esc(r.fn) + '</span><span class="mono muted">' + (r.derived ? "derived · " : "") + esc(r.file.split("/").pop()) + ":" + r.line + "</span></div>").join("")
            : '<div class="muted" style="font-size:12px">Direct document reads.</div>') +
          '<div style="margin-top:12px"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    } else if (sub === "machines") {
      content = fl.stateMachines.length === 0
        ? '<div class="muted" style="padding:16px">No declared state machines extracted.</div>'
        : fl.stateMachines.map((sm) => '<div class="card" style="padding:14px;margin-bottom:12px"><div style="margin-bottom:8px"><strong>' + esc(sm.name) + '</strong> <span class="mono muted">' + esc(sm.file) + ":" + sm.line + " · " + sm.stateCount + " states · " + sm.transitionCount + " transitions · click any state</span></div>" + sm.svg + "</div>").join("");

      const parts = String(state.flowSelectedSmState || "").split("::");
      const sm = fl.stateMachines.find((m) => m.id === parts[0]) || fl.stateMachines[0];
      if (!sm) {
        drawerHtml = '<div class="drawer-body"><div class="muted">Click any state node to inspect transitions, guards, and callers.</div></div>';
      } else {
        const activeSt = parts[1] || sm.states?.[0] || "";
        const outTr = (sm.transitions || []).filter((t) => t.from === activeSt);
        const inTr = (sm.transitions || []).filter((t) => t.to === activeSt);
        const up = findFlowUpstreamRefs(sm.file);
        const focusFile = state.flowCodeFile || sm.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : sm.line;
        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(sm.name) + ' · ' + esc(activeSt) + '</div><div class="mono muted">' + esc(sm.file) + ":" + sm.line + "</div></div></div>" +
          '<div class="drawer-body">' +
          '<div class="sec-title">Outgoing Transitions (' + outTr.length + ")</div>" +
          outTr.map((t) => '<div class="row"><span class="mono">→ ' + esc(t.to) + '</span><span class="badge">' + esc(t.guard ? "guard: " + t.guard : t.event) + "</span></div>").join("") +
          '<div class="sec-title" style="margin-top:10px">Incoming Transitions (' + inTr.length + ")</div>" +
          inTr.map((t) => '<div class="row"><span class="mono">' + esc(t.from) + ' →</span><span class="mono muted">' + esc(t.event) + "</span></div>").join("") +
          (up.callers.length > 0
            ? '<div class="sec-title" style="margin-top:10px">Files Using This Machine (' + up.callers.length + ")</div>" +
              up.callers.map((c) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(c.file) + '" data-flow-jump-line="' + c.line + '"><span class="mono">' + esc(c.file.split("/").pop()) + '</span><span class="mono muted">:' + c.line + " →</span></div>").join("")
            : "") +
          '<div style="margin-top:12px"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    } else {
      content = fl.asyncHandoffsSvg
        ? '<div class="card" style="padding:14px"><div style="margin-bottom:8px"><strong>Cross-Boundary Async Handoffs</strong> <span class="mono muted">' + fl.asyncCount + " channels · click any row to inspect producer &amp; consumer code</span></div>" + fl.asyncHandoffsSvg + "</div>"
        : '<div class="muted" style="padding:16px">No cross-boundary async handoffs extracted.</div>';
      const ah = (fl.asyncHandoffs || [])[state.flowSelectedAsyncIdx ?? 0];
      if (!ah) {
        drawerHtml = '<div class="drawer-body"><div class="muted">Click any async handoff row to inspect producer, channel semantics, and consumer code.</div></div>';
      } else {
        const focusFile = state.flowCodeFile || ah.producer.file;
        const focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : ah.producer.line;
        drawerHtml =
          '<div class="drawer-head"><div><div class="drawer-title">' + esc(ah.channel) + '</div><div class="mono muted">' + esc(ah.transport) + " · " + esc(ah.delivery) + "</div></div></div>" +
          '<div class="drawer-body">' +
          '<div class="sec-title">Endpoints</div>' +
          '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ah.producer.file) + '" data-flow-jump-line="' + ah.producer.line + '"><span class="mono">Producer: ' + esc(ah.producer.fn) + '</span><span class="mono muted">:' + ah.producer.line + " →</span></div>" +
          (ah.consumer
            ? '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ah.consumer.file) + '" data-flow-jump-line="' + ah.consumer.line + '"><span class="mono">Consumer: ' + esc(ah.consumer.fn) + '</span><span class="mono muted">:' + ah.consumer.line + " →</span></div>"
            : '<div class="muted" style="font-size:12px;margin-top:6px">Consumer lives outside this repository or uses dynamic subscription.</div>') +
          '<div style="margin-top:12px"><div class="sec-title">Code Reference</div>' + renderFlowCodeSnippet(focusFile, focusLine) + "</div></div>";
      }
    }

    const filterBar =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
      '<div class="sub-toggles"><strong>Work Flows &amp; Lifecycles</strong> <span class="mono muted">' + fl.workFlows.length + " flows · " + fl.hazards.length + " DDIA flags</span>" + subBtns + "</div>" +
      '<div class="sub-toggles">' +
      '<input id="flow-search-input" class="search" style="width:180px;padding:4px 9px;font-size:12px" placeholder="Filter flows / files…" value="' + esc(state.flowSearch || "") + '" />' +
      '<button class="pill-btn' + (hzOnly ? " active" : "") + '" data-flow-hazards-only="1">Hazards only</button>' +
      "</div></div>";

    return (
      '<div class="workspace code-open">' +
      '<div class="canvas-panel" style="overflow:auto;padding:14px 16px">' + filterBar + content + "</div>" +
      '<aside class="drawer">' + drawerHtml + "</aside>" +
      "</div>"
    );
  }

  function renderFlowCodeSnippet(filePath, focusLine) {
    if (!filePath || filePath === ".") return '<div class="muted mono">No source file mapped.</div>';
    const fIdx = ddIdxByPath.get(filePath);
    if (fIdx === undefined) {
      return '<div class="mono muted">' + esc(filePath) + ":" + (focusLine || 1) + "</div>";
    }
    if (!FILE_SOURCES) {
      ensureFileSourcesLoaded();
      return '<div class="mono muted">Loading source for ' + esc(filePath) + ":" + (focusLine || 1) + "…</div>";
    }
    const raw = FILE_SOURCES[fIdx];
    if (!raw) {
      return '<div class="mono muted">' + esc(filePath) + ":" + (focusLine || 1) + " (source not embedded in inline mode)</div>";
    }
    const lines = raw.split("\\n");
    const ln = Math.max(1, Math.min(lines.length, Number(focusLine) || 1));
    const start = state.codeFullFile ? 0 : Math.max(0, ln - 9);
    const end = state.codeFullFile ? Math.min(lines.length, start + 140) : Math.min(lines.length, ln + 11);
    const rows = [];
    for (let i = start; i < end; i += 1) {
      const isHi = i + 1 === ln;
      rows.push(
        '<div style="display:flex;gap:10px;padding:1px 10px;white-space:pre;' +
          (isHi ? "background:rgba(56,189,248,0.16);border-left:3px solid #38bdf8;" : "") +
          '"><span class="mono muted" style="min-width:34px;text-align:right;user-select:none">' + (i + 1) +
          '</span><span class="mono">' + highlightCodeLine(lines[i] || "", filePath) + "</span></div>",
      );
    }
    return (
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px">' +
      '<span class="mono muted">' + esc(filePath) + ":" + ln + ' <span class="badge">' + langChipForPath(filePath) + "</span></span>" +
      '<div class="sub-toggles">' +
      '<button class="tbtn" data-code-full="' + (state.codeFullFile ? "0" : "1") + '">' + (state.codeFullFile ? "Excerpt" : "Full") + "</button>" +
      '<button class="tbtn" data-open-file="' + esc(filePath) + '" data-open-file-line="' + ln + '">Call Graph →</button>' +
      "</div></div>" +
      '<div style="background:#070b14;border:1px solid var(--rs-border);border-radius:7px;padding:6px 0;overflow:auto;max-height:290px;margin-top:6px;font-size:11.5px">' +
      rows.join("") + "</div>"
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
      state.flowCodeFile = null;
      render();
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
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const hubEl = target.closest("[data-hub-field]");
    if (hubEl) {
      state.flowSelectedHubField = hubEl.getAttribute("data-hub-field");
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const smEl = target.closest("[data-sm-state]");
    if (smEl) {
      state.flowSelectedSmState = smEl.getAttribute("data-sm-state");
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const asyncEl = target.closest("[data-async-idx]");
    if (asyncEl) {
      state.flowSelectedAsyncIdx = Number(asyncEl.getAttribute("data-async-idx"));
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const jumpEl = target.closest("[data-flow-jump-file]");
    if (jumpEl) {
      state.flowCodeFile = jumpEl.getAttribute("data-flow-jump-file");
      state.flowCodeLine = Number(jumpEl.getAttribute("data-flow-jump-line")) || 1;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    if (target.closest("[data-flow-hazards-only]")) {
      state.flowHazardsOnly = !state.flowHazardsOnly;
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
