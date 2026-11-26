export function renderFlowsClientScript(): string {
  return `
  function renderFlowsTab() {
    const fl = DATA.flows || { workFlows: [], dataHubs: [], stateMachines: [], asyncHandoffsSvg: "", asyncCount: 0, hazards: [] };
    const sub = state.flowsSubtab || "workflows";
    const subBtns =
      '<button class="pill-btn' + (sub === "workflows" ? " active" : "") + '" data-flows-sub="workflows">Swimlane Waterfalls (' + fl.workFlows.length + ")</button>" +
      '<button class="pill-btn' + (sub === "hubs" ? " active" : "") + '" data-flows-sub="hubs">Data Hubs (' + fl.dataHubs.length + ")</button>" +
      '<button class="pill-btn' + (sub === "machines" ? " active" : "") + '" data-flows-sub="machines">Statecharts (' + fl.stateMachines.length + ")</button>" +
      '<button class="pill-btn' + (sub === "async" ? " active" : "") + '" data-flows-sub="async">Async Handoffs (' + (fl.asyncCount || 0) + ")</button>";

    let content = "";
    if (sub === "workflows") {
      if (fl.workFlows.length === 0) {
        content = '<div class="muted" style="padding:16px">No work flows extracted. Add entrypoints or .repospec/flows.yaml.</div>';
      } else {
        const activeId = state.activeFlowId && fl.workFlows.some((w) => w.id === state.activeFlowId)
          ? state.activeFlowId
          : fl.workFlows[0].id;
        const wf = fl.workFlows.find((w) => w.id === activeId) || fl.workFlows[0];
        const picker = fl.workFlows.slice(0, 14).map((w) => {
          const badge = w.hazardCount > 0 ? " [" + w.hazardCount + "!]" : "";
          return '<button class="pill-btn' + (w.id === wf.id ? " active" : "") + '" data-select-flow="' + esc(w.id) + '">' + esc(w.name) + badge + "</button>";
        }).join("");
        const openBtn = ddIdxByPath.has(wf.file)
          ? ' <button class="tbtn" data-open-file="' + esc(wf.file) + '" data-open-file-line="' + (wf.line || 1) + '">Open Source</button>'
          : "";
        const hazHtml = (wf.hazards || []).length > 0
          ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;margin-top:10px">' +
            wf.hazards.map((h) =>
              '<div class="card" style="padding:10px;border-left:3px solid ' + (h.severity === "error" ? "#ef4444" : "#f59e0b") + '">' +
              '<div class="mono" style="font-weight:700;color:' + (h.severity === "error" ? "#f87171" : "#fbbf24") + '">' + esc(h.kind) + ' <span class="muted">:' + h.line + "</span></div>" +
              '<div style="font-size:12px;color:#cbd5e1;margin-top:4px">' + esc(h.summary) + "</div></div>",
            ).join("") + "</div>"
          : "";
        content =
          '<div class="sub-toggles" style="margin-bottom:10px;flex-wrap:wrap">' + picker + "</div>" +
          '<div class="card" style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div><strong>' + esc(wf.name) + '</strong> <span class="mono muted">' + esc(wf.file) + ":" + wf.line + " · " + wf.serialAwaitCount + " serial awaits</span></div><div>" + openBtn + "</div></div>" +
          wf.svg + hazHtml + "</div>";
      }
    } else if (sub === "hubs") {
      content = fl.dataHubs.length === 0
        ? '<div class="muted" style="padding:16px">No multi-site entity field lifecycles extracted.</div>'
        : fl.dataHubs.map((h) =>
            '<div class="card" style="padding:14px;margin-bottom:12px"><div style="margin-bottom:8px"><strong>Entity: ' + esc(h.entity) + '</strong> <span class="mono muted">' + h.fieldCount + " tracked fields</span></div>" + h.svg + "</div>",
          ).join("");
    } else if (sub === "machines") {
      content = fl.stateMachines.length === 0
        ? '<div class="muted" style="padding:16px">No declared state machines extracted.</div>'
        : fl.stateMachines.map((sm) =>
            '<div class="card" style="padding:14px;margin-bottom:12px"><div style="margin-bottom:8px"><strong>' + esc(sm.name) + '</strong> <span class="mono muted">' + esc(sm.file) + ":" + sm.line + " · " + sm.stateCount + " states · " + sm.transitionCount + " transitions</span></div>" + sm.svg + "</div>",
          ).join("");
    } else {
      content = fl.asyncHandoffsSvg
        ? '<div class="card" style="padding:14px"><div style="margin-bottom:8px"><strong>Cross-Boundary Async Handoffs</strong> <span class="mono muted">' + fl.asyncCount + " channels</span></div>" + fl.asyncHandoffsSvg + "</div>"
        : '<div class="muted" style="padding:16px">No cross-boundary async handoffs extracted.</div>';
    }

    return '<div class="table-wrap"><div class="table-head"><div><strong>Work Flows &amp; Data Lifecycles</strong> <span class="mono muted">' + fl.workFlows.length + " flows · " + fl.hazards.length + ' DDIA flags</span></div><div class="sub-toggles">' + subBtns + "</div></div>" + content + "</div>";
  }
`;
}
