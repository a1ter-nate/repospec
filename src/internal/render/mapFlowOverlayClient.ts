export function renderMapFlowOverlayClientScript(): string {
  return `
  function findDiagramNodeForFlowStep(diag, wf, step) {
    if (!diag || !diag.nodes || diag.nodes.length === 0) return null;
    const stepFile = step?.file || wf.file;
    const byExactFile = diag.nodes.find((n) => n.id === "file:" + stepFile || n.provenance?.file === stepFile);
    if (byExactFile) return byExactFile.id;

    if (step && (step.op === "db_read" || step.op === "db_write" || step.op === "db_commit")) {
      const dbNode = diag.nodes.find((n) => n.kind === "datastore" || n.shape === "db" || n.id.startsWith("ctx_db:"));
      if (dbNode) return dbNode.id;
    }
    if (step && (step.op === "notify" || step.op === "async_publish")) {
      const msgNode = diag.nodes.find((n) => {
        const l = String(n.label || "").toLowerCase();
        return n.kind === "external_service" && (l.includes("pubsub") || l.includes("fcm") || l.includes("push") || l.includes("queue") || l.includes("resend") || l.includes("firebase"));
      });
      if (msgNode) return msgNode.id;
    }
    if (step && step.op === "ext_http") {
      const fnLow = String(step.fn || "").toLowerCase();
      const extMatch = diag.nodes.find((n) => n.kind === "external_service" && fnLow.includes(String(n.label || "").toLowerCase().split(" ")[0]));
      if (extMatch) return extMatch.id;
      const anyExt = diag.nodes.find((n) => n.kind === "external_service");
      if (anyExt) return anyExt.id;
    }

    const byFolder = diag.nodes.find((n) => {
      if (n.childMeta && Array.isArray(n.childMeta.fileIdxs)) {
        return n.childMeta.fileIdxs.some((fi) => DD_FILES[fi]?.p === stepFile);
      }
      const mod = moduleById.get(n.id);
      if (mod && Array.isArray(mod.files)) {
        return mod.files.some((mf) => mf.file === stepFile);
      }
      const sn = nodeById.get(n.id);
      const dir = typeof sn?.meta?.dir === "string" ? sn.meta.dir.replace(/\\/+$/, "") : "";
      return Boolean(dir && (stepFile === dir || stepFile.startsWith(dir + "/")));
    });
    if (byFolder) return byFolder.id;

    const hostApp = diag.nodes.find((n) => n.kind === "app");
    return hostApp ? hostApp.id : diag.nodes[0].id;
  }

  function computeMapFlowOverlay(diag) {
    const active = Boolean(state.mapFlowId || state.canvasLens === "flows");
    if (!active || !diag || ALL_FLOWS.length === 0) return null;
    const wf = (state.mapFlowId && FLOW_BY_ID.get(state.mapFlowId)) || ALL_FLOWS[0];
    if (!wf) return null;

    const steps = wf.steps || [];
    const nodeBadges = new Map();
    const stepNodeMap = new Map();
    const hazardNodeIds = new Set();
    const activeNodeIds = new Set();
    const activeEdgeIds = new Set();

    const ingressNode = diag.nodes.find((n) => {
      const l = String(n.label || "").toLowerCase();
      return l.includes("load balancer") || l.includes("https") || l.includes("scheduler") || n.kind === "caller_ctx";
    });
    const hostNodeId = findDiagramNodeForFlowStep(diag, wf, null);
    if (ingressNode && hostNodeId && ingressNode.id !== hostNodeId) {
      activeNodeIds.add(ingressNode.id);
    }

    steps.forEach((s, si) => {
      const nid = findDiagramNodeForFlowStep(diag, wf, s) || hostNodeId;
      if (!nid) return;
      stepNodeMap.set(si, nid);
      activeNodeIds.add(nid);
      const isHaz = (wf.hazards || []).some((h) => h.line === s.line);
      if (isHaz) hazardNodeIds.add(nid);
      const list = nodeBadges.get(nid) || [];
      list.push({ num: si + 1, op: s.op, fn: s.fn, hazard: isHaz });
      nodeBadges.set(nid, list);
    });

    for (const e of diag.edges || []) {
      if (activeNodeIds.has(e.from) && activeNodeIds.has(e.to)) {
        activeEdgeIds.add(e.id);
      }
    }
    const clampedIdx = steps.length > 0 ? Math.max(0, Math.min(steps.length - 1, Number(state.mapFlowStepIdx) || 0)) : 0;
    const focusedNodeId = stepNodeMap.get(clampedIdx) || hostNodeId || null;

    return {
      wf,
      steps,
      stepIdx: clampedIdx,
      activeNodeIds,
      activeEdgeIds,
      hazardNodeIds,
      nodeBadges,
      stepNodeMap,
      focusedNodeId,
    };
  }

  function renderMapFlowScrubber(diag) {
    const ov = computeMapFlowOverlay(diag);
    if (!ov) return "";
    const wf = ov.wf;
    const opts = ALL_FLOWS.slice(0, 40).map((f) =>
      '<option value="' + esc(f.id) + '"' + (f.id === wf.id ? " selected" : "") + ">" + esc(f.name + (f.hazardCount > 0 ? " [" + f.hazardCount + "!]" : "") + " (" + f.serialAwaitCount + " awaits)") + "</option>"
    ).join("");
    const chips = ov.steps.slice(0, 12).map((s, si) => {
      const isCur = si === ov.stepIdx;
      const shortFn = String(s.fn || "").split(".").pop() || s.op;
      const lbl = (si + 1) + ". " + stepOpTag(s.op) + ":" + (shortFn.length > 14 ? shortFn.slice(0, 13) + "…" : shortFn);
      return '<button class="flow-chip ' + stepToneClass(s, wf) + (isCur ? " active" : "") + '" data-map-flow-step="' + si + '" title="' + esc(s.fn + " (:" + s.line + ")") + '">' + esc(lbl) + "</button>";
    }).join('<span class="flow-arr">→</span>');

    return (
      '<div class="flow-scrubber" id="flow-scrubber">' +
      '<div class="flow-scrub-top">' +
      '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap">' +
      '<span class="badge b-cyan">FLOW WALK</span>' +
      '<select id="map-flow-select" class="flow-select">' + opts + "</select>" +
      '<button class="tbtn" data-map-flow-step-nav="-1" title="Previous step">◀</button>' +
      '<span class="mono muted">' + (ov.steps.length > 0 ? (ov.stepIdx + 1) + "/" + ov.steps.length : "0/0") + "</span>" +
      '<button class="tbtn" data-map-flow-step-nav="1" title="Next step">▶</button>' +
      "</div>" +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<button class="tbtn" data-jump-flow-opt="' + esc(wf.id) + '" title="Compare Current vs Optimized in Flows tab">Optimize ↗</button>' +
      '<button class="tbtn" data-map-flow-close="1" title="Exit flow overlay">✕</button>' +
      "</div></div>" +
      '<div class="flow-strip" style="margin-top:6px">' + (chips || '<span class="muted">No steps extracted</span>') + "</div>" +
      "</div>"
    );
  }

  function renderMapFlowStepDrawer(diag) {
    const ov = computeMapFlowOverlay(diag);
    if (!ov) return "";
    const wf = ov.wf;
    const step = ov.steps[ov.stepIdx] || null;
    const focusFile = step?.file || wf.file;
    const focusLine = step?.line || wf.line;
    const stepHaz = step ? (wf.hazards || []).filter((h) => h.line === step.line) : [];
    const hazHtml = stepHaz.length > 0
      ? stepHaz.map((h) => '<div class="why-note"><strong>⚠ ' + esc(h.kind) + ":</strong> " + esc(h.summary) + "</div>").join("")
      : "";
    return (
      '<div class="behavior-card" style="border-color:rgba(124,200,255,0.45)">' +
      '<div class="beh-item-head">' +
      '<div><div class="mono" style="font-weight:700;color:#7cc8ff">' + esc(wf.name) + (step ? " · Step " + (ov.stepIdx + 1) + "/" + ov.steps.length : "") + '</div>' +
      '<div class="muted mono" style="font-size:11px">' + esc(step ? step.fn + " (" + step.op + " · " + step.lane + ")" : wf.file + ":" + wf.line) + "</div></div>" +
      '<div style="display:flex;gap:5px">' +
      (ddIdxByPath.has(focusFile) ? '<button class="tbtn" data-open-file="' + esc(focusFile) + '" data-open-file-line="' + focusLine + '">Callstack →</button>' : "") +
      '<button class="tbtn" data-jump-flow="' + esc(wf.id) + '">Swimlane ↗</button>' +
      "</div></div>" +
      hazHtml +
      renderFlowCodeSnippet(focusFile, focusLine) +
      "</div>"
    );
  }

  function handleMapFlowClick(target) {
    const symAsyncNode = target.closest('[data-node^="symasync:"]');
    if (symAsyncNode) {
      const idx = Number((symAsyncNode.getAttribute("data-node") || "").slice(9));
      const ah = ALL_ASYNCS[idx];
      if (ah) {
        const peer = ah.consumer?.file && ah.consumer.file !== state.activeFileGraph ? ah.consumer : ah.producer;
        if (peer?.file && ddIdxByPath.has(peer.file)) {
          openFileCodeView(peer.file, peer.line || 1, -1);
          return true;
        }
      }
    }
    const overlayBtn = target.closest("[data-map-flow-overlay]");
    if (overlayBtn) {
      const fid = overlayBtn.getAttribute("data-map-flow-overlay");
      state.tab = "map";
      state.canvasLens = "flows";
      state.mapFlowId = fid || ALL_FLOWS[0]?.id || null;
      state.mapFlowStepIdx = 0;
      state.e2eTraceSeed = null;
      state.activeFileGraph = null;
      state.selectedEdgeId = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const stepBtn = target.closest("[data-map-flow-step]");
    if (stepBtn) {
      state.mapFlowStepIdx = Number(stepBtn.getAttribute("data-map-flow-step")) || 0;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const navBtn = target.closest("[data-map-flow-step-nav]");
    if (navBtn) {
      const delta = Number(navBtn.getAttribute("data-map-flow-step-nav")) || 0;
      const wf = (state.mapFlowId && FLOW_BY_ID.get(state.mapFlowId)) || ALL_FLOWS[0];
      const len = wf?.steps?.length || 1;
      state.mapFlowStepIdx = (Number(state.mapFlowStepIdx || 0) + delta + len) % len;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    if (target.closest("[data-map-flow-close]")) {
      state.mapFlowId = null;
      if (state.canvasLens === "flows") state.canvasLens = "default";
      render();
      return true;
    }
    const jumpFlowBtn = target.closest("[data-jump-flow]");
    if (jumpFlowBtn) {
      state.tab = "flows";
      state.flowsSubtab = "workflows";
      state.activeFlowId = jumpFlowBtn.getAttribute("data-jump-flow");
      state.flowMode = "current";
      state.flowSelectedStepIdx = null;
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const jumpFlowOpt = target.closest("[data-jump-flow-opt]");
    if (jumpFlowOpt) {
      state.tab = "flows";
      state.flowsSubtab = "workflows";
      state.activeFlowId = jumpFlowOpt.getAttribute("data-jump-flow-opt");
      state.flowMode = "optimized";
      state.flowSelectedStepIdx = null;
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const jumpHubBtn = target.closest("[data-jump-hub]");
    if (jumpHubBtn) {
      state.tab = "flows";
      state.flowsSubtab = "hubs";
      state.flowSelectedHubField = jumpHubBtn.getAttribute("data-jump-hub");
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const jumpSmBtn = target.closest("[data-jump-sm]");
    if (jumpSmBtn) {
      state.tab = "flows";
      state.flowsSubtab = "machines";
      state.flowSelectedSmState = jumpSmBtn.getAttribute("data-jump-sm");
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    if (target.closest("[data-toggle-async-edges]")) {
      state.showAsyncEdges = !state.showAsyncEdges;
      render();
      return true;
    }
    return false;
  }

  function appendFileGraphAsyncCol(f, cols) {
    if (!state.showAsyncEdges || !f) return;
    const recs = ASYNC_BY_FILE.get(f.p) || [];
    if (recs.length === 0) return;
    const items = [];
    const seen = new Set();
    for (const r of recs) {
      const id = "symasync:" + r.idx;
      if (seen.has(id)) continue;
      seen.add(id);
      const peer = r.role === "producer" ? r.ah.consumer : r.ah.producer;
      items.push({
        id,
        label: "⚡ " + r.ah.channel,
        sublabel: r.ah.transport + " · " + (peer ? peer.file.split("/").pop() : r.ah.delivery),
        kind: "external_service",
        shape: "pill",
        provenance: { file: peer?.file || f.p, line: peer?.line || r.ah.producer.line },
      });
    }
    if (items.length > 0) cols.push({ id: "sym_async", label: "⚡ Async Handoffs (" + items.length + ")", items });
  }

  function appendFileGraphAsyncEdges(f, fileIdx, syms, routeEdge) {
    if (!state.showAsyncEdges || !f) return;
    const recs = ASYNC_BY_FILE.get(f.p) || [];
    for (const r of recs) {
      const targetLine = r.role === "producer" ? r.ah.producer.line : (r.ah.consumer?.line || 1);
      let symIdx = syms.findIndex((s) => targetLine >= s[3] && targetLine <= s[4]);
      if (symIdx < 0) symIdx = 0;
      const symId = "sym:" + fileIdx + ":" + symIdx;
      const asyncId = "symasync:" + r.idx;
      if (r.role === "producer") routeEdge(symId, asyncId, targetLine, "async_handoff");
      else routeEdge(asyncId, symId, targetLine, "async_handoff");
    }
  }
`;
}
