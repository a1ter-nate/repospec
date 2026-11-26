export function renderMapFlowsBridgeClientScript(): string {
  return `
  const ALL_FLOWS = (DATA.flows && DATA.flows.workFlows) || [];
  const ALL_HUBS = (DATA.flows && DATA.flows.dataHubs) || [];
  const ALL_SMS = (DATA.flows && DATA.flows.stateMachines) || [];
  const ALL_ASYNCS = (DATA.flows && DATA.flows.asyncHandoffs) || [];

  const FLOWS_STARTING_IN_FILE = new Map();
  for (const wf of ALL_FLOWS) {
    if (!wf.file) continue;
    const arr = FLOWS_STARTING_IN_FILE.get(wf.file) || [];
    arr.push(wf);
    FLOWS_STARTING_IN_FILE.set(wf.file, arr);
  }

  const HUBS_BY_FILE = new Map();
  for (const hub of ALL_HUBS) {
    for (const f of hub.fields || []) {
      for (const w of f.writers || []) {
        if (!w.file) continue;
        const arr = HUBS_BY_FILE.get(w.file) || [];
        arr.push({ entity: hub.entity, field: f.field, multiWriterRisk: Boolean(f.multiWriterRisk), line: w.line || 1 });
        HUBS_BY_FILE.set(w.file, arr);
      }
    }
  }

  const ASYNC_BY_FILE = new Map();
  ALL_ASYNCS.forEach((ah, idx) => {
    if (ah.producer?.file) {
      const arr = ASYNC_BY_FILE.get(ah.producer.file) || [];
      arr.push({ role: "producer", idx, ah });
      ASYNC_BY_FILE.set(ah.producer.file, arr);
    }
    if (ah.consumer?.file) {
      const arr = ASYNC_BY_FILE.get(ah.consumer.file) || [];
      arr.push({ role: "consumer", idx, ah });
      ASYNC_BY_FILE.set(ah.consumer.file, arr);
    }
  });

  const SMS_BY_FILE = new Map();
  for (const sm of ALL_SMS) {
    if (!sm.file) continue;
    const arr = SMS_BY_FILE.get(sm.file) || [];
    arr.push(sm);
    SMS_BY_FILE.set(sm.file, arr);
  }

  function renderFileFlowLaunchPills(filePath, symStart, symEnd) {
    if (!filePath) return "";
    const allFileFlows = FLOWS_STARTING_IN_FILE.get(filePath) || [];
    const scopedFlows = typeof symStart === "number" && typeof symEnd === "number"
      ? allFileFlows.filter((wf) => wf.line >= symStart - 2 && wf.line <= symEnd + 2)
      : allFileFlows;
    const flows = scopedFlows.length > 0 ? scopedFlows : allFileFlows;
    const asyncs = (ASYNC_BY_FILE.get(filePath) || []).filter((r) => r.role === "producer");
    const sms = SMS_BY_FILE.get(filePath) || [];
    if (flows.length === 0 && asyncs.length === 0 && sms.length === 0) return "";

    const pills = [];
    for (const wf of flows.slice(0, 3)) {
      const badge = wf.hazardCount > 0 ? " · " + wf.hazardCount + "!" : "";
      pills.push(
        '<button class="flow-launch-pill' + (wf.hazardCount > 0 ? " has-warn" : "") + '" data-jump-flow="' + esc(wf.id) + '" title="Open ' + esc(wf.name) + ' Swimlane in Flows tab">▶ Flow: ' + esc(wf.name) + " (" + wf.serialAwaitCount + " awaits" + badge + ") ↗</button>"
      );
    }
    if (flows.length > 3) {
      pills.push('<button class="flow-launch-pill" data-jump-flow="' + esc(flows[0].id) + '">+' + (flows.length - 3) + " more flows ↗</button>");
    }
    for (const rec of asyncs.slice(0, 2)) {
      pills.push(
        '<button class="flow-launch-pill is-async" data-jump-async="' + rec.idx + '" title="Inspect cross-boundary async handoff in Flows tab">⚡ Kicks off: ' + esc(rec.ah.channel) + " ↗</button>"
      );
    }
    for (const sm of sms.slice(0, 1)) {
      pills.push(
        '<button class="flow-launch-pill" data-jump-sm="' + esc(sm.id + "::" + (sm.states?.[0] || "")) + '" title="Inspect statechart in Flows tab">◈ Statechart: ' + esc(sm.name) + " ↗</button>"
      );
    }
    return '<div class="flow-launch-row">' + pills.join("") + "</div>";
  }

  function renderFileFlowFootnote(filePath) {
    if (!filePath) return "";
    const hubs = HUBS_BY_FILE.get(filePath) || [];
    const asyncs = ASYNC_BY_FILE.get(filePath) || [];
    if (hubs.length === 0 && asyncs.length === 0) return "";
    const seen = new Set();
    const rows = [];
    for (const h of hubs) {
      const k = h.entity + "." + h.field;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(
        '<div class="row"><span class="row-link mono" data-jump-hub="' + esc(h.entity + "::" + h.field) + '">Writes ' + esc(k) + "</span>" +
        (h.multiWriterRisk ? '<span class="badge b-warn">multi-writer</span>' : '<span class="badge b-na">Hub ↗</span>') +
        "</div>"
      );
    }
    for (const rec of asyncs.slice(0, 4)) {
      const verb = rec.role === "producer" ? "Publishes → " : "Consumes ← ";
      rows.push(
        '<div class="row"><span class="row-link mono" data-jump-async="' + rec.idx + '">⚡ ' + verb + esc(rec.ah.channel) + '</span><span class="badge b-purple">' + esc(rec.ah.transport) + "</span></div>"
      );
    }
    return '<div class="sec">' + renderDisclosure({
      title: "Data Lifecycles & Async Triggers",
      badge: rows.length,
      badgeClass: "b-info",
      open: false,
      bodyHtml: rows.join(""),
    }) + "</div>";
  }

  function renderLocationFlowsSection(opts) {
    const prefix = opts.dirPrefix ? opts.dirPrefix.replace(/\\/+$/, "") + "/" : "";
    const fileSet = opts.files && opts.files.length > 0 ? new Set(opts.files) : null;
    const flows = ALL_FLOWS.filter((wf) => {
      if (fileSet && fileSet.has(wf.file)) return true;
      if (prefix && wf.file.startsWith(prefix)) return true;
      return false;
    });
    const asyncs = ALL_ASYNCS.filter((ah) => {
      const pf = ah.producer?.file || "";
      const cf = ah.consumer?.file || "";
      if (fileSet && (fileSet.has(pf) || fileSet.has(cf))) return true;
      if (prefix && (pf.startsWith(prefix) || cf.startsWith(prefix))) return true;
      if (opts.nodeKind === "external_service") {
        const lbl = String(opts.nodeLabel || "").toLowerCase();
        return (lbl.includes("pubsub") || lbl.includes("queue") || lbl.includes("bus")) &&
          (ah.transport.toLowerCase().includes("pubsub") || ah.transport.toLowerCase().includes("queue") || ah.transport.toLowerCase().includes("bus"));
      }
      return false;
    });
    const hubs = opts.nodeKind === "datastore" ? ALL_HUBS : [];
    if (flows.length === 0 && asyncs.length === 0 && hubs.length === 0) return "";

    const disclosures = [];
    if (flows.length > 0) {
      const hazCount = flows.reduce((s, w) => s + (w.hazardCount || 0), 0);
      disclosures.push(renderDisclosure({
        title: "Flows Kicking Off Here",
        meta: hazCount > 0 ? flows.length + " entrypoints · " + hazCount + " DDIA flags" : flows.length + " entrypoints",
        badge: flows.length,
        badgeClass: hazCount > 0 ? "b-warn" : "b-cyan",
        tone: hazCount > 0 ? "warn" : "info",
        open: false,
        bodyHtml: flows.slice(0, 14).map((wf) =>
          '<div class="row">' +
          '<span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-jump-flow="' + esc(wf.id) + '" title="Open ' + esc(wf.name) + ' in Flows tab">▶ ' + esc(wf.name) + "</span>" +
          '<span style="display:flex;gap:4px;align-items:center;flex-shrink:0">' +
          '<span class="muted mono" style="font-size:11px">' + wf.serialAwaitCount + "a</span>" +
          (wf.hazardCount > 0 ? '<span class="badge b-warn">' + wf.hazardCount + "!</span>" : '<span class="badge b-na">' + esc(wf.triggerKind || "http") + "</span>") +
          "</span></div>"
        ).join("") + (flows.length > 14 ? '<div class="muted" style="font-size:11px">+' + (flows.length - 14) + " more in Flows tab</div>" : ""),
      }));
    }
    if (asyncs.length > 0) {
      disclosures.push(renderDisclosure({
        title: "Async Triggers & Channels",
        badge: asyncs.length,
        badgeClass: "b-purple",
        tone: "info",
        open: false,
        bodyHtml: asyncs.slice(0, 10).map((ah) => {
          const idx = ALL_ASYNCS.indexOf(ah);
          return '<div class="row"><span class="row-link mono" data-jump-async="' + Math.max(0, idx) + '">⚡ ' + esc(ah.channel) + '</span><span class="badge b-na">' + esc(ah.transport) + "</span></div>";
        }).join(""),
      }));
    }
    if (hubs.length > 0) {
      disclosures.push(renderDisclosure({
        title: "Entity Data Hubs",
        badge: hubs.length,
        badgeClass: "b-purple",
        tone: "info",
        open: false,
        bodyHtml: hubs.slice(0, 10).map((h) =>
          '<div class="row"><span class="row-link mono" data-jump-hub="' + esc(h.entity + "::" + (h.fields?.[0]?.field || "")) + '">' + esc(h.entity) + '</span><span class="muted mono">' + h.fieldCount + " fields</span></div>"
        ).join(""),
      }));
    }
    return '<div class="sec"><div class="sec-title"><span>Flows From This Location</span><span class="muted">opens in Flows</span></div>' + disclosures.join("") + "</div>";
  }

  function handleMapFlowClick(target) {
    const jumpFlowBtn = target.closest("[data-jump-flow]");
    if (jumpFlowBtn) {
      state.flowReturnFromMap = state.tab === "map";
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
    const jumpHubBtn = target.closest("[data-jump-hub]");
    if (jumpHubBtn) {
      state.flowReturnFromMap = state.tab === "map";
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
      state.flowReturnFromMap = state.tab === "map";
      state.tab = "flows";
      state.flowsSubtab = "machines";
      state.flowSelectedSmState = jumpSmBtn.getAttribute("data-jump-sm");
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const jumpAsyncBtn = target.closest("[data-jump-async]");
    if (jumpAsyncBtn) {
      state.flowReturnFromMap = state.tab === "map";
      state.tab = "flows";
      state.flowsSubtab = "async";
      state.flowSelectedAsyncIdx = Number(jumpAsyncBtn.getAttribute("data-jump-async")) || 0;
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    if (target.closest("[data-return-to-map]")) {
      state.tab = "map";
      state.flowReturnFromMap = false;
      render();
      return true;
    }
    return false;
  }
`;
}
