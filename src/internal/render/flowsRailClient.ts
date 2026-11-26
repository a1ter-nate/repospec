export function renderFlowsRailCss(): string {
  return `
  .workspace.flows-open { grid-template-columns: minmax(0, 1fr) 6px var(--drawer-w, clamp(400px, 33vw, 540px)); }
  .fx { display: grid; grid-template-columns: 46px 268px minmax(0, 1fr); padding: 0 !important; overflow: hidden !important; background: var(--bg-0); transition: grid-template-columns var(--dur) var(--ease); }
  .fx.rail-off { grid-template-columns: 46px 0 minmax(0, 1fr); }
  .fx-act { background: var(--bg-1); border-right: 1px solid var(--line-1); display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; z-index: 5; }
  .fx-act-btn { width: 36px; height: 42px; border-radius: var(--r-2); border: 1px solid transparent; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: var(--text-3); font: 600 10px/1 var(--font-mono, monospace); cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); position: relative; }
  .fx-act-btn:hover { background: var(--bg-2); color: var(--text-1); }
  .fx-act-btn.active { background: var(--bg-3); color: var(--text-1); box-shadow: inset 2px 0 0 var(--accent); }
  .fx-act-btn.active svg { color: var(--accent); }
  .fx-act-spacer { flex: 1; }
  .fr { background: var(--bg-1); border-right: 1px solid var(--line-1); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .fx.rail-off .fr { border-right: 0; }
  .fr-top { padding: 8px 8px 7px; border-bottom: 1px solid var(--line-1); display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .fr-search-wrap { position: relative; }
  .fr-search { width: 100%; background: var(--bg-2); color: var(--text-1); border: 1px solid var(--line-2); border-radius: var(--r-2); padding: 5px 24px 5px 26px; font-size: var(--fs-12); outline: none; transition: border-color var(--dur) var(--ease); }
  .fr-search:focus { border-color: var(--accent); }
  .fr-search::placeholder { color: var(--text-4); }
  .fr-search-ico { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-4); pointer-events: none; display: inline-flex; }
  .fr-search-kbd { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); font: 600 10px/16px var(--font-mono, monospace); color: var(--text-4); border: 1px solid var(--line-2); border-radius: 3px; padding: 0 4px; pointer-events: none; }
  .fr-chips { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .fr-chip { background: transparent; border: 1px solid var(--line-1); border-radius: var(--r-1); padding: 3px 7px; font-size: var(--fs-11); font-weight: 500; color: var(--text-3); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
  .fr-chip:hover { background: var(--bg-2); color: var(--text-1); }
  .fr-chip.active { background: var(--bg-3); color: var(--text-1); border-color: var(--accent-line); }
  .fr-chip.is-err.active { border-color: rgba(255,138,138,0.45); color: var(--err); background: var(--err-soft); }
  .fr-chip-n { font-family: var(--font-mono, monospace); font-size: 10px; color: var(--text-4); }
  .fr-chip.active .fr-chip-n { color: inherit; opacity: 0.85; }
  .fr-list { flex: 1; overflow-y: auto; padding: 4px 6px 14px; display: flex; flex-direction: column; gap: 2px; }
  .fr-group-h { position: sticky; top: 0; z-index: 2; width: 100%; background: var(--bg-1); border: 0; height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 6px; font: 600 11px/1 var(--font-sans, sans-serif); text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); cursor: pointer; text-align: left; }
  .fr-group-h:hover { color: var(--text-1); }
  .fr-group-l { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
  .fr-group-r { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-4); }
  .fr-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .fr-dot.is-err { background: var(--err); }
  .fr-dot.is-warn { background: var(--warn); }
  .fr-dot.is-hollow { border: 1.5px solid var(--text-4); background: transparent; }
  .fr-item { width: 100%; display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 6px 8px; border-radius: var(--r-2); text-align: left; background: transparent; border: 0; cursor: pointer; transition: background var(--dur) var(--ease); }
  .fr-item:hover { background: var(--bg-2); }
  .fr-item[aria-selected="true"] { background: var(--bg-3); box-shadow: inset 2px 0 0 var(--accent); }
  .fr-glyph { width: 24px; height: 24px; border-radius: var(--r-2); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--bg-2); border: 1px solid var(--line-1); color: var(--text-3); }
  .fr-glyph.g-http { background: var(--accent-soft); border-color: rgba(124,200,255,0.24); color: var(--accent); }
  .fr-glyph.g-trigger { background: rgba(199,164,255,0.12); border-color: rgba(199,164,255,0.26); color: #c7a4ff; }
  .fr-glyph.g-cron { background: rgba(79,216,196,0.12); border-color: rgba(79,216,196,0.26); color: #4fd8c4; }
  .fr-glyph.g-warn { background: var(--warn-soft); border-color: rgba(245,194,107,0.28); color: var(--warn); }
  .fr-glyph.g-err { background: var(--err-soft); border-color: rgba(255,138,138,0.28); color: var(--err); }
  .fr-main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .fr-title { display: block; font-size: var(--fs-13); font-weight: 500; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
  .fr-sub { display: block; font: 400 11px/1.3 var(--font-mono, monospace); color: var(--text-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fr-meta { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }
  .fr-pips { display: inline-flex; align-items: center; gap: 2px; }
  .fr-pips i { width: 3px; height: 10px; border-radius: 1px; background: var(--line-3); display: inline-block; }
  .fr-pips.hot i { background: var(--warn); }
  .fr-hz { min-width: 17px; height: 17px; padding: 0 4px; border-radius: 999px; font: 600 10.5px/17px var(--font-mono, monospace); text-align: center; color: var(--warn); background: var(--warn-soft); }
  .fr-hz.is-err { color: var(--err); background: var(--err-soft); }
  .fr-bar { width: 34px; height: 5px; border-radius: 3px; background: var(--line-1); overflow: hidden; display: inline-block; }
  .fr-bar i { display: block; height: 100%; background: var(--bar); border-radius: 3px; }
  .fr-bar.is-warn i { background: var(--warn); }
  .fr-sm-states { padding: 2px 0 6px 24px; display: flex; flex-direction: column; gap: 1px; }
  .fr-sm-row { width: 100%; background: transparent; border: 0; border-radius: var(--r-1); padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: var(--fs-12); color: var(--text-2); cursor: pointer; text-align: left; }
  .fr-sm-row:hover { background: var(--bg-2); color: var(--text-1); }
  .fr-sm-row[aria-selected="true"] { background: var(--bg-3); color: var(--text-1); box-shadow: inset 2px 0 0 var(--accent); }
  .fr-deliv { font: 600 10px/1 var(--font-mono, monospace); padding: 2px 5px; border-radius: 4px; color: var(--text-3); background: var(--bg-2); border: 1px solid var(--line-1); }
  .fx-stage { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-0); }
  .fx-stage-head { min-height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 14px; background: var(--bg-1); border-bottom: 1px solid var(--line-1); flex-wrap: wrap; }
  .fx-head-l { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
  .fx-head-r { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .fx-route-tag { display: inline-flex; align-items: center; gap: 6px; max-width: 300px; overflow: hidden; }
  .fx-route-path { font: 500 12px/1 var(--font-mono, monospace); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-legend-strip { display: flex; align-items: center; gap: 14px; padding: 7px 16px; border-bottom: 1px solid var(--line-1); background: var(--bg-1); font-size: var(--fs-12); color: var(--text-3); flex-wrap: wrap; flex-shrink: 0; }
  .fx-legend-chip { display: inline-flex; align-items: center; gap: 6px; }
  .fx-stage-body { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
  .fx-stage-body svg { display: block; width: 100%; height: auto; }
  .fx-stage-body [data-async-idx].is-sel rect:first-of-type { stroke: var(--accent) !important; stroke-width: 1.8 !important; }
  .fx-step-box { padding: 10px 12px; border-radius: var(--r-2); background: var(--bg-2); border: 1px solid var(--accent-line); display: flex; flex-direction: column; gap: 6px; }
  .fx-haz-card { padding: 8px 10px; border-radius: var(--r-2); background: var(--bg-2); border: 1px solid var(--line-1); border-left: 2px solid var(--warn); cursor: pointer; transition: background var(--dur) var(--ease); }
  .fx-haz-card:hover { background: var(--bg-3); }
  .fx-haz-card.is-err { border-left-color: var(--err); }
  .fx-empty { padding: 28px 16px; text-align: center; color: var(--text-3); font-size: var(--fs-13); }
  @media (max-width: 960px) { .fx { grid-template-columns: 44px 210px minmax(0, 1fr); } }
`;
}

export function renderFlowsRailScript(): string {
  return `
  function flowGlyphSvg(kind) {
    const p = {
      http: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
      trigger: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      cron: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
      queue: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
      flows: '<line x1="4" y1="6" x2="14" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="17" y2="18"/>',
      db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
      states: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M8.7 10.7a5 5 0 0 1 6.6 0"/><polyline points="14 7 16 10.5 12.5 11"/>',
      async: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>',
      search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
    };
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (p[kind] || p.trigger) + "</svg>";
  }

  function flowPipsHtml(count) {
    const n = Math.max(0, Math.min(8, Number(count) || 0));
    if (n === 0) return "";
    return '<span class="fr-pips' + (n >= 6 ? " hot" : "") + '" title="' + n + ' serial awaits">' + "<i></i>".repeat(n) + "</span>";
  }

  function flowBaseFile(filePath) {
    const parts = String(filePath || "").split("/").filter(Boolean);
    if (parts.length <= 2) return parts.join("/");
    return parts.slice(-2).join("/");
  }

  function flowGroupName(wf) {
    if (wf.group) return wf.group;
    const f = String(wf.file || "").replace(/^apps\\/[^/]+\\//, "").replace(/^(?:functions|src|lib)\\//, "");
    return f.split("/")[0] || "root";
  }

  function flowTriggerGlyph(kind) {
    const k = String(kind || "").toLowerCase();
    if (k === "http" || k === "api" || k === "route") return { icon: "http", cls: "g-http" };
    if (k === "cron" || k === "schedule") return { icon: "cron", cls: "g-cron" };
    if (k === "queue" || k === "pubsub" || k === "event") return { icon: "queue", cls: "g-trigger" };
    return { icon: "trigger", cls: "g-trigger" };
  }

  function getFilteredWorkFlows(fl) {
    const q = String(state.flowSearch || "").trim().toLowerCase();
    const chip = state.flowFilterChip || "all";
    return (fl.workFlows || []).filter((w) => {
      if (chip === "err" && !w.hasError) return false;
      if (chip === "http" && String(w.triggerKind || "").toLowerCase() !== "http") return false;
      if (chip === "int" && String(w.triggerKind || "").toLowerCase() === "http") return false;
      if (q && !(w.name + " " + w.file + " " + flowGroupName(w)).toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => {
      const ae = a.hasError ? 1 : 0;
      const be = b.hasError ? 1 : 0;
      if (be !== ae) return be - ae;
      if ((b.hazardCount || 0) !== (a.hazardCount || 0)) return (b.hazardCount || 0) - (a.hazardCount || 0);
      if ((b.serialAwaitCount || 0) !== (a.serialAwaitCount || 0)) return (b.serialAwaitCount || 0) - (a.serialAwaitCount || 0);
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function getFilteredHubs(fl) {
    const q = String(state.flowSearch || "").trim().toLowerCase();
    const chip = state.flowFilterChip || "all";
    return (fl.dataHubs || []).filter((h) => {
      if (chip === "mw" && !(h.multiWriterCount > 0)) return false;
      if (q && !h.entity.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => {
      const am = a.multiWriterCount > 0 ? 1 : 0;
      const bm = b.multiWriterCount > 0 ? 1 : 0;
      if (bm !== am) return bm - am;
      if (b.fieldCount !== a.fieldCount) return b.fieldCount - a.fieldCount;
      return a.entity.localeCompare(b.entity);
    });
  }

  function renderFlowRailListHtml(fl, sub) {
    const closed = state.flowRailClosed || {};
    if (sub === "workflows") {
      const list = getFilteredWorkFlows(fl);
      if (list.length === 0) return '<div class="fx-empty">No flows match this filter.</div>';
      const activeId = state.activeFlowId || list[0].id;
      const groups = new Map();
      for (const w of list) {
        const g = flowGroupName(w);
        const arr = groups.get(g) || [];
        arr.push(w);
        groups.set(g, arr);
      }
      const orderedGroups = Array.from(groups.entries()).sort((a, b) => {
        const aErr = a[1].some((x) => x.hasError) ? 1 : 0;
        const bErr = b[1].some((x) => x.hasError) ? 1 : 0;
        if (bErr !== aErr) return bErr - aErr;
        if (b[1].length !== a[1].length) return b[1].length - a[1].length;
        return a[0].localeCompare(b[0]);
      });
      const searching = Boolean(String(state.flowSearch || "").trim());
      return orderedGroups.map(([gName, items]) => {
        const gk = "wf:" + gName;
        const isClosed = !searching && Boolean(closed[gk]);
        const hasErr = items.some((x) => x.hasError);
        const hdr =
          '<button class="fr-group-h" data-flow-group="' + esc(gk) + '">' +
          '<span class="fr-group-l"><span>' + (isClosed ? "▸" : "▾") + '</span><span>' + esc(gName) + "</span></span>" +
          '<span class="fr-group-r">' + (hasErr ? '<span class="fr-dot is-err" title="Contains error-severity DDIA hazard"></span>' : "") + "<span>" + items.length + "</span></span>" +
          "</button>";
        if (isClosed) return hdr;
        const rows = items.map((w) => {
          const tg = flowTriggerGlyph(w.triggerKind);
          const gCls = w.hasError ? "g-err" : tg.cls;
          const hzBadge = w.hasError
            ? '<span class="fr-hz is-err" title="Error-severity DDIA hazard">' + w.hazardCount + "</span>"
            : w.hazardCount >= 2
              ? '<span class="fr-hz" title="' + w.hazardCount + ' DDIA flags">' + w.hazardCount + "</span>"
              : "";
          return (
            '<button class="fr-item" data-select-flow="' + esc(w.id) + '" aria-selected="' + (w.id === activeId ? "true" : "false") + '" title="' + esc(w.name + " · " + w.file + ":" + w.line) + '">' +
            '<span class="fr-glyph ' + gCls + '">' + flowGlyphSvg(tg.icon) + "</span>" +
            '<span class="fr-main"><span class="fr-title">' + esc(w.name) + '</span><span class="fr-sub">' + esc(flowBaseFile(w.file)) + "</span></span>" +
            '<span class="fr-meta">' + flowPipsHtml(w.serialAwaitCount) + hzBadge + "</span>" +
            "</button>"
          );
        }).join("");
        return hdr + rows;
      }).join("");
    }

    if (sub === "hubs") {
      const hubs = getFilteredHubs(fl);
      if (hubs.length === 0) return '<div class="fx-empty">No data hubs match.</div>';
      const activeEntity = state.activeHubEntity || (state.flowSelectedHubField ? String(state.flowSelectedHubField).split("::")[0] : "") || hubs[0].entity;
      const maxFields = hubs.reduce((m, h) => Math.max(m, h.fieldCount), 1);
      const mwHubs = hubs.filter((h) => h.multiWriterCount > 0);
      const otherHubs = hubs.filter((h) => !(h.multiWriterCount > 0));
      const sections = [];
      if (mwHubs.length > 0) sections.push({ key: "hub:mw", label: "Multi-writer risk", items: mwHubs, warn: true });
      if (otherHubs.length > 0) sections.push({ key: "hub:all", label: mwHubs.length > 0 ? "Single-writer entities" : "All entities", items: otherHubs, warn: false });
      return sections.map((sec) => {
        const isClosed = Boolean(closed[sec.key]);
        const hdr =
          '<button class="fr-group-h" data-flow-group="' + esc(sec.key) + '">' +
          '<span class="fr-group-l"><span>' + (isClosed ? "▸" : "▾") + '</span><span>' + esc(sec.label) + "</span></span>" +
          '<span class="fr-group-r">' + (sec.warn ? '<span class="fr-dot is-warn"></span>' : "") + "<span>" + sec.items.length + "</span></span>" +
          "</button>";
        if (isClosed) return hdr;
        return hdr + sec.items.map((h) => {
          const pct = Math.max(12, Math.round((h.fieldCount / maxFields) * 100));
          const writersTxt = h.writerCount ? " · " + h.writerCount + "w" : "";
          return (
            '<button class="fr-item" data-select-hub="' + esc(h.entity) + '" aria-selected="' + (h.entity === activeEntity ? "true" : "false") + '">' +
            '<span class="fr-glyph ' + (h.multiWriterCount > 0 ? "g-warn" : "g-http") + '">' + flowGlyphSvg("db") + "</span>" +
            '<span class="fr-main"><span class="fr-title mono">' + esc(h.entity) + '</span><span class="fr-sub">' + h.fieldCount + " fields" + writersTxt + "</span></span>" +
            '<span class="fr-meta"><span class="fr-bar' + (h.multiWriterCount > 0 ? " is-warn" : "") + '"><i style="width:' + pct + '%"></i></span>' + (h.multiWriterCount > 0 ? '<span class="fr-dot is-warn" title="' + h.multiWriterCount + ' multi-writer fields"></span>' : "") + "</span>" +
            "</button>"
          );
        }).join("");
      }).join("");
    }

    if (sub === "machines") {
      const q = String(state.flowSearch || "").trim().toLowerCase();
      const sms = (fl.stateMachines || []).filter((sm) => !q || (sm.name + " " + sm.file).toLowerCase().includes(q));
      if (sms.length === 0) return '<div class="fx-empty">No statecharts match.</div>';
      const parts = String(state.flowSelectedSmState || "").split("::");
      const activeSmId = state.activeSmId || parts[0] || sms[0].id;
      const activeSt = parts[0] === activeSmId ? parts[1] : (sms.find((m) => m.id === activeSmId)?.states?.[0] || "");
      return sms.map((sm) => {
        const isSel = sm.id === activeSmId;
        const item =
          '<button class="fr-item" data-select-sm="' + esc(sm.id) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
          '<span class="fr-glyph g-cron">' + flowGlyphSvg("states") + "</span>" +
          '<span class="fr-main"><span class="fr-title">' + esc(sm.name) + '</span><span class="fr-sub">' + sm.stateCount + " states · " + sm.transitionCount + " transitions</span></span>" +
          '<span class="fr-meta"><span class="fr-deliv">' + sm.stateCount + "</span></span>" +
          "</button>";
        if (!isSel) return item;
        const stRows = (sm.states || []).map((st) => {
          const inN = (sm.transitions || []).filter((t) => t.to === st).length;
          const outN = (sm.transitions || []).filter((t) => t.from === st).length;
          return (
            '<button class="fr-sm-row" data-sm-state="' + esc(sm.id + "::" + st) + '" aria-selected="' + (st === activeSt ? "true" : "false") + '">' +
            '<span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">● ' + esc(st) + "</span>" +
            '<span class="mono muted" style="font-size:10.5px;flex-shrink:0">' + inN + "→" + outN + "</span>" +
            "</button>"
          );
        }).join("");
        return item + '<div class="fr-sm-states">' + stRows + "</div>";
      }).join("");
    }

    const q = String(state.flowSearch || "").trim().toLowerCase();
    const list = (fl.asyncHandoffs || []).map((ah, idx) => ({ ah, idx })).filter(({ ah }) =>
      !q || (ah.channel + " " + ah.transport + " " + (ah.producer?.fn || "")).toLowerCase().includes(q)
    );
    if (list.length === 0) return '<div class="fx-empty">No async handoffs match.</div>';
    const selIdx = state.flowSelectedAsyncIdx ?? 0;
    const byTr = new Map();
    for (const rec of list) {
      const k = rec.ah.transport || "async";
      const arr = byTr.get(k) || [];
      arr.push(rec);
      byTr.set(k, arr);
    }
    return Array.from(byTr.entries()).sort((a, b) => b[1].length - a[1].length).map(([tr, items]) => {
      const gk = "as:" + tr;
      const isClosed = Boolean(closed[gk]);
      const hdr =
        '<button class="fr-group-h" data-flow-group="' + esc(gk) + '">' +
        '<span class="fr-group-l"><span>' + (isClosed ? "▸" : "▾") + '</span><span>' + esc(tr) + "</span></span>" +
        '<span class="fr-group-r"><span>' + items.length + "</span></span>" +
        "</button>";
      if (isClosed) return hdr;
      return hdr + items.map(({ ah, idx }) => {
        const isCron = String(ah.transport || "").toLowerCase().includes("cron");
        return (
          '<button class="fr-item" data-async-idx="' + idx + '" aria-selected="' + (idx === selIdx ? "true" : "false") + '">' +
          '<span class="fr-glyph ' + (isCron ? "g-cron" : "g-trigger") + '">' + flowGlyphSvg(isCron ? "cron" : "queue") + "</span>" +
          '<span class="fr-main"><span class="fr-title mono">' + esc(ah.channel) + '</span><span class="fr-sub">' + esc(ah.producer?.fn || "producer") + "</span></span>" +
          '<span class="fr-meta"><span class="fr-deliv">' + esc(ah.delivery || "async") + "</span>" + (!ah.consumer ? '<span class="fr-dot is-hollow" title="External or dynamic consumer"></span>' : "") + "</span>" +
          "</button>"
        );
      }).join("");
    }).join("");
  }

  function renderFlowRail(fl, sub) {
    const actBtns = [
      { id: "workflows", icon: "flows", label: "Swimlane Waterfalls", count: fl.workFlows.length },
      { id: "hubs", icon: "db", label: "Data Hubs", count: fl.dataHubs.length },
      { id: "machines", icon: "states", label: "Statecharts", count: fl.stateMachines.length },
      { id: "async", icon: "async", label: "Async Handoffs", count: fl.asyncCount || 0 },
    ].map((b) =>
      '<button class="fx-act-btn' + (sub === b.id ? " active" : "") + '" data-flows-sub="' + b.id + '" title="' + b.label + " (" + b.count + ')">' +
      flowGlyphSvg(b.icon) + "<span>" + b.count + "</span></button>"
    ).join("");

    const chip = state.flowFilterChip || "all";
    let chipsHtml = "";
    if (sub === "workflows") {
      const errN = fl.workFlows.filter((w) => w.hasError).length;
      const httpN = fl.workFlows.filter((w) => String(w.triggerKind || "").toLowerCase() === "http").length;
      const intN = fl.workFlows.length - httpN;
      chipsHtml =
        '<div class="fr-chips">' +
        '<button class="fr-chip' + (chip === "all" ? " active" : "") + '" data-flow-chip="all">All <span class="fr-chip-n">' + fl.workFlows.length + "</span></button>" +
        (errN > 0 ? '<button class="fr-chip is-err' + (chip === "err" ? " active" : "") + '" data-flow-chip="err"><span class="fr-dot is-err"></span>Err <span class="fr-chip-n">' + errN + "</span></button>" : "") +
        (httpN > 0 ? '<button class="fr-chip' + (chip === "http" ? " active" : "") + '" data-flow-chip="http">HTTP <span class="fr-chip-n">' + httpN + "</span></button>" : "") +
        (intN > 0 ? '<button class="fr-chip' + (chip === "int" ? " active" : "") + '" data-flow-chip="int">Int <span class="fr-chip-n">' + intN + "</span></button>" : "") +
        "</div>";
    } else if (sub === "hubs") {
      const mwN = fl.dataHubs.filter((h) => h.multiWriterCount > 0).length;
      chipsHtml =
        '<div class="fr-chips">' +
        '<button class="fr-chip' + (chip === "all" ? " active" : "") + '" data-flow-chip="all">All <span class="fr-chip-n">' + fl.dataHubs.length + "</span></button>" +
        (mwN > 0 ? '<button class="fr-chip' + (chip === "mw" ? " active" : "") + '" data-flow-chip="mw"><span class="fr-dot is-warn"></span>Multi-writer <span class="fr-chip-n">' + mwN + "</span></button>" : "") +
        "</div>";
    }

    const placeholders = { workflows: "Filter flows or files…", hubs: "Filter entities…", machines: "Filter statecharts…", async: "Filter channels…" };
    return (
      '<nav class="fx-act" aria-label="Flow views">' +
      actBtns +
      '<div class="fx-act-spacer"></div>' +
      '<button class="fx-act-btn" data-toggle-flow-rail="1" title="' + (state.flowRailHidden ? "Show list rail ([)" : "Hide list rail ([)") + '">' + flowGlyphSvg("sidebar") + "</button>" +
      "</nav>" +
      '<aside class="fr">' +
      '<div class="fr-top">' +
      '<div class="fr-search-wrap">' +
      '<span class="fr-search-ico">' + flowGlyphSvg("search") + "</span>" +
      '<input id="flow-search-input" class="fr-search" placeholder="' + (placeholders[sub] || "Filter…") + '" value="' + esc(state.flowSearch || "") + '" />' +
      '<span class="fr-search-kbd">/</span>' +
      "</div>" +
      chipsHtml +
      "</div>" +
      '<div class="fr-list" id="fr-list">' + renderFlowRailListHtml(fl, sub) + "</div>" +
      "</aside>"
    );
  }

  function rerenderFlowRail() {
    const el = document.getElementById("fr-list");
    if (!el) return;
    const fl = DATA.flows || { workFlows: [], dataHubs: [], stateMachines: [], asyncHandoffs: [], asyncCount: 0, hazards: [] };
    el.innerHTML = renderFlowRailListHtml(fl, state.flowsSubtab || "workflows");
  }

  function stepFlowSelection(delta) {
    const fl = DATA.flows || { workFlows: [], dataHubs: [], stateMachines: [], asyncHandoffs: [] };
    const sub = state.flowsSubtab || "workflows";
    if (sub === "workflows") {
      const list = getFilteredWorkFlows(fl);
      if (list.length === 0) return;
      const curIdx = Math.max(0, list.findIndex((w) => w.id === state.activeFlowId));
      const next = list[(curIdx + delta + list.length) % list.length];
      state.activeFlowId = next.id;
      state.flowSelectedStepIdx = null;
      state.flowCodeFile = null;
      render();
      return;
    }
    if (sub === "hubs") {
      const hubs = getFilteredHubs(fl);
      if (hubs.length === 0) return;
      const curEntity = state.activeHubEntity || hubs[0].entity;
      const curIdx = Math.max(0, hubs.findIndex((h) => h.entity === curEntity));
      const next = hubs[(curIdx + delta + hubs.length) % hubs.length];
      state.activeHubEntity = next.entity;
      state.flowSelectedHubField = next.entity + "::" + (next.fields?.[0]?.field || "");
      state.flowCodeFile = null;
      render();
      return;
    }
    if (sub === "machines") {
      const sms = fl.stateMachines || [];
      if (sms.length === 0) return;
      const curIdx = Math.max(0, sms.findIndex((m) => m.id === (state.activeSmId || sms[0].id)));
      const next = sms[(curIdx + delta + sms.length) % sms.length];
      state.activeSmId = next.id;
      state.flowSelectedSmState = next.id + "::" + (next.states?.[0] || "");
      state.flowCodeFile = null;
      render();
      return;
    }
    const as = fl.asyncHandoffs || [];
    if (as.length === 0) return;
    const curIdx = state.flowSelectedAsyncIdx ?? 0;
    state.flowSelectedAsyncIdx = (curIdx + delta + as.length) % as.length;
    state.flowCodeFile = null;
    render();
  }

  function handleFlowsKeydown(ev) {
    if (state.tab !== "flows") return false;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (ev.key === "Escape" && document.activeElement?.id === "flow-search-input") {
        state.flowSearch = "";
        const inp = document.getElementById("flow-search-input");
        if (inp instanceof HTMLInputElement) { inp.value = ""; inp.blur(); }
        rerenderFlowRail();
        return true;
      }
      return false;
    }
    if (ev.key === "[") {
      ev.preventDefault();
      state.flowRailHidden = !state.flowRailHidden;
      render();
      return true;
    }
    if (ev.key === "/") {
      ev.preventDefault();
      if (state.flowRailHidden) { state.flowRailHidden = false; render(); }
      const inp = document.getElementById("flow-search-input");
      if (inp instanceof HTMLInputElement) inp.focus();
      return true;
    }
    if (ev.key === "j" || ev.key === "ArrowDown") {
      ev.preventDefault();
      stepFlowSelection(1);
      return true;
    }
    if (ev.key === "k" || ev.key === "ArrowUp") {
      ev.preventDefault();
      stepFlowSelection(-1);
      return true;
    }
    return false;
  }
`;
}
