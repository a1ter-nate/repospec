export function renderSurfacesCss(): string {
  return `
  .surf-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #0b0f19; overflow: hidden; }
  .surf-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 22px; border-bottom: 1px solid #161e30; background: #0d121e; flex-shrink: 0; }
  .surf-nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .surf-nav-btn { background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 5px 10px; font-size: 13px; font-weight: 500; color: var(--text-3); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background 0.12s ease, color 0.12s ease; }
  .surf-nav-btn:hover { color: var(--text-1); background: rgba(255,255,255,0.05); }
  .surf-nav-btn.active { color: var(--text-1); font-weight: 600; background: #151c2c; border-color: var(--rs-border-hi); }
  .surf-nav-n { font-size: 12px; color: var(--text-3); }
  .surf-tools { display: flex; align-items: center; gap: 8px; }
  .surf-filter-wrap { position: relative; }
  .surf-filter { width: 220px; padding: 5px 28px 5px 10px; font-size: 12.5px; }
  .surf-filter:focus { width: 260px; }
  .surf-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: transparent; border: 0; color: var(--text-3); cursor: pointer; font-size: 11px; padding: 2px 4px; }
  .surf-clear:hover { color: var(--text-1); }
  .surf-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .surf-overview { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding: 20px 22px; align-content: start; }
  .surf-ov-col { background: #0d121e; border: 1px solid #161e30; border-radius: 9px; padding: 16px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .surf-ov-head { background: transparent; border: 0; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; color: inherit; }
  .surf-ov-head:hover .surf-ov-kicker { color: var(--accent); }
  .surf-ov-kicker { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); }
  .surf-ov-num { display: flex; align-items: baseline; gap: 8px; }
  .surf-ov-unit { font-size: 13px; color: var(--text-2); font-weight: 500; }
  .surf-ov-sub { font-size: 12px; color: var(--text-3); font-family: var(--font-mono, monospace); }
  .surf-ov-ledger { display: flex; flex-direction: column; border-top: 1px solid #161e30; padding-top: 8px; }
  .surf-ov-tail { font-size: 12px; color: var(--text-3); padding: 6px 6px 2px; }
  .surf-ov-verdicts { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #161e30; padding-top: 10px; }
  .surf-verdict { background: transparent; border: 0; border-radius: 6px; padding: 6px 8px; text-align: left; font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; transition: background 0.12s ease; }
  .surf-verdict:hover { background: rgba(255,255,255,0.04); color: var(--text-1); }
  .surf-verdict.is-warn { color: var(--warn); }
  .surf-chev { font-size: 12px; color: var(--text-3); flex-shrink: 0; }
  .surf-verdict-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 9px 22px; border-bottom: 1px solid #161e30; background: #0b0f19; flex-shrink: 0; }
  .surf-facet { background: #111622; border: 1px solid #1e293b; border-radius: 6px; padding: 4px 10px; font-size: 12.5px; font-weight: 500; color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background 0.12s ease, border-color 0.12s ease; }
  .surf-facet:hover { background: #151c2c; color: var(--text-1); }
  .surf-facet.is-warn { color: var(--warn); border-color: rgba(245,194,107,0.3); }
  .surf-facet.active { background: #151c2c; border-color: var(--accent); color: var(--text-1); }
  .surf-facet.is-warn.active { background: rgba(245,194,107,0.14); border-color: var(--warn); color: var(--warn); }
  .surf-split-api { flex: 1; min-height: 0; display: grid; grid-template-columns: 380px minmax(0, 1fr); }
  .surf-split-data { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; }
  .surf-ledger { background: #0d121e; border-right: 1px solid #161e30; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; }
  .surf-led-row { background: transparent; border: 0; border-radius: 5px; height: 28px; padding: 0 8px; display: grid; grid-template-columns: minmax(0, 148px) minmax(0, 1fr) auto; align-items: center; gap: 10px; text-align: left; color: var(--text-2); cursor: pointer; transition: background 0.12s ease; width: 100%; }
  .surf-led-row:hover { background: rgba(255,255,255,0.04); color: var(--text-1); }
  .surf-led-row[aria-selected="true"] { background: #151c2c; color: var(--text-1); box-shadow: inset 2px 0 0 var(--accent); }
  .surf-led-row.is-child { padding-left: 20px; }
  .surf-led-row.is-dim { opacity: 0.35; }
  .surf-led-lbl { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .surf-led-num { font-size: 12.5px; color: var(--text-3); text-align: right; min-width: 28px; }
  .surf-led-sub { font-size: 11px; color: var(--text-4); }
  .surf-led-kids { display: flex; flex-direction: column; margin-bottom: 4px; }
  .surf-bar-track { height: 6px; border-radius: 2px; background: rgba(255,255,255,0.06); display: flex; overflow: hidden; width: 100%; }
  .surf-bar-track.sm { width: 64px; display: inline-flex; vertical-align: middle; }
  .surf-bar-base { background: var(--bar); height: 100%; }
  .surf-bar-pub { border: 1px solid var(--text-3); height: 100%; background: transparent; }
  .surf-bar-warn { background: var(--warn); height: 100%; }
  .surf-detail { background: #0d121e; overflow-y: auto; display: flex; flex-direction: column; min-width: 0; }
  .surf-det-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #161e30; position: sticky; top: 0; background: #0d121e; z-index: 4; }
  .surf-det-title { font-size: 13px; font-weight: 600; color: var(--text-1); }
  .surf-det-list { display: flex; flex-direction: column; padding: 4px 12px 18px; }
  .surf-det-pad { padding: 12px 16px; display: flex; flex-direction: column; gap: 14px; }
  .surf-det-sec { display: flex; flex-direction: column; gap: 6px; }
  .surf-sec-k { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); }
  .surf-chip-row { display: flex; flex-wrap: wrap; gap: 5px; }
  .surf-mini-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 0; font-size: 12.5px; }
  .surf-mini-row button.row-link { background: transparent; border: 0; padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .surf-sticky-sub { position: sticky; top: 0; background: #0d121e; padding: 8px 6px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); border-bottom: 1px solid #161e30; }
  .surf-det-wrap { border-bottom: 1px solid rgba(22,30,48,0.65); }
  .surf-det-wrap.is-open { background: #111622; border-radius: 6px; margin: 3px 0; border: 1px solid #1e293b; }
  .surf-det-row { background: transparent; border: 0; width: 100%; min-height: 26px; padding: 3px 6px; display: grid; grid-template-columns: 58px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; text-align: left; color: var(--text-1); cursor: pointer; transition: background 0.12s ease; }
  .surf-det-row.is-static { cursor: default; grid-template-columns: minmax(0, 1fr) auto auto; border-bottom: 1px solid rgba(22,30,48,0.65); }
  .surf-det-row:hover { background: rgba(255,255,255,0.04); }
  .surf-det-row[aria-selected="true"] { box-shadow: inset 2px 0 0 var(--accent); background: #151c2c; }
  .surf-meth { font-size: 12px; font-weight: 600; }
  .surf-meth.m-read { color: var(--text-3); }
  .surf-meth.m-write { color: var(--text-1); }
  .surf-meth.m-del { color: var(--err); }
  .surf-path { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .surf-path-dim { color: var(--text-4); }
  .surf-guard-col { font-size: 12px; white-space: nowrap; }
  .surf-warn-txt { color: var(--warn); font-size: 12px; font-weight: 500; }
  .surf-pub-pill { border: 1px solid var(--text-3); border-radius: 4px; padding: 0 6px; font-size: 11px; color: var(--text-2); }
  .surf-guard-txt { font-size: 12px; color: var(--text-3); }
  .surf-loc-col { font-size: 11.5px; color: var(--text-4); white-space: nowrap; }
  .surf-row-exp { padding: 8px 12px 10px 74px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #161e30; }
  .surf-exp-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--text-2); }
  .surf-exp-acts { display: flex; gap: 8px; }
  .surf-exp-acts .tbtn, .surf-det-pad .tbtn { background: #151c2c; border-color: var(--rs-border-hi); color: var(--text-1); }
  .surf-exp-acts .tbtn:hover, .surf-det-pad .tbtn:hover { background: #1d263b; border-color: var(--accent); }
  .surf-matrix-pane { overflow: auto; border-right: 1px solid #161e30; padding: 8px 14px 20px; background: #0b0f19; }
  .surf-mx-tbl, .surf-cfg-tbl { width: 100%; border-collapse: collapse; }
  .surf-mx-tbl th, .surf-cfg-tbl th { position: sticky; top: 0; background: #0b0f19; z-index: 2; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); padding: 6px 4px; border-bottom: 1px solid #161e30; text-align: left; }
  .surf-cfg-tbl th { background: #0d121e; }
  .surf-mx-col, .surf-mx-cell, .surf-cfg-c { text-align: center !important; width: 32px; }
  .surf-cfg-c { width: 64px; }
  .surf-mx-row { height: 26px; cursor: pointer; border-bottom: 1px solid rgba(22,30,48,0.55); transition: background 0.12s ease; }
  .surf-mx-row:hover { background: rgba(255,255,255,0.04); }
  .surf-mx-row.is-sel { background: #151c2c; box-shadow: inset 2px 0 0 var(--accent); }
  .surf-mx-name { padding: 0 8px 0 6px; font-size: 12.5px; color: var(--text-1); white-space: nowrap; }
  .surf-mx-ref { padding: 0 8px; white-space: nowrap; }
  .surf-mx-n { font-size: 12px; color: var(--text-3); margin-left: 6px; display: inline-block; min-width: 26px; text-align: right; }
  .surf-dot-on { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--bar); vertical-align: middle; }
  .surf-dot-warn { display: inline-block; width: 7px; height: 7px; background: var(--warn); transform: rotate(45deg); vertical-align: middle; }
  .surf-dot-off { display: inline-block; width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.1); vertical-align: middle; }
  .surf-sq-sec { display: inline-block; width: 8px; height: 8px; border-radius: 1px; background: #c7a4ff; vertical-align: middle; }
  .surf-cfg-row { height: 26px; border-bottom: 1px solid rgba(22,30,48,0.55); transition: background 0.12s ease; }
  .surf-cfg-row.is-link { cursor: pointer; }
  .surf-cfg-row:hover { background: rgba(255,255,255,0.04); }
  .surf-cfg-row.is-secret .surf-cfg-name { box-shadow: inset 2px 0 0 #c7a4ff; }
  .surf-cfg-name { padding: 0 10px; font-size: 12.5px; color: var(--text-1); white-space: nowrap; }
  .surf-tail-btn { margin-top: 8px; background: transparent; border: 1px dashed #1e293b; border-radius: 6px; padding: 7px 10px; font-size: 12.5px; color: var(--text-3); cursor: pointer; text-align: left; width: 100%; }
  .surf-tail-btn:hover { color: var(--text-1); border-color: var(--rs-border-hi); background: rgba(255,255,255,0.03); }
  .surf-caveat { padding: 8px 16px; font-size: 12px; color: var(--text-3); border-bottom: 1px solid #161e30; background: #0b0f19; }
  .surf-empty { padding: 20px 16px; font-size: 12.5px; color: var(--text-3); }
  .surf-shell button:focus-visible, .surf-shell tr:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }`;
}

export function renderSurfacesClientScript(): string {
  return `
  function surfModel() {
    return DATA.surfacesModel || {
      endpoints: [],
      entities: [],
      entityDomains: [],
      entityDatastores: [],
      envVars: [],
      envServices: [],
      foreignKeys: [],
      totals: {
        endpoints: 0, rawEndpoints: 0, noGuardEndpoints: 0, publicEndpoints: 0,
        writeEndpoints: 0, sourceEndpoints: 0, contractOnlyEndpoints: 0,
        entities: 0, crossDomainEntities: 0, noContractEntities: 0, noDomainEntities: 0,
        undeclaredEntities: 0, flaggedEntities: 0, multiWriterFieldCount: 0,
        envVars: 0, secrets: 0, secretsInIac: 0, secretsDrift: 0, driftVars: 0,
        declaredOnlyVars: 0, builtinVars: 0, foreignKeys: 0, cascadeFks: 0,
      },
    };
  }

  function renderSurfBar(total, warnCount, maxVal, publicCount) {
    if (maxVal <= 0 || total <= 0) return '<span class="surf-bar-track"></span>';
    const totalPct = Math.max(2, Math.min(100, (total / maxVal) * 100));
    const warnPct = warnCount > 0 ? Math.max(2, Math.min(totalPct, (warnCount / maxVal) * 100)) : 0;
    const pubPct = publicCount > 0 ? Math.max(2, Math.min(totalPct - warnPct, (publicCount / maxVal) * 100)) : 0;
    const basePct = Math.max(0, totalPct - warnPct - pubPct);
    return (
      '<span class="surf-bar-track">' +
      (basePct > 0 ? '<span class="surf-bar-base" style="width:' + basePct.toFixed(1) + '%"></span>' : "") +
      (pubPct > 0 ? '<span class="surf-bar-pub" style="width:' + pubPct.toFixed(1) + '%"></span>' : "") +
      (warnPct > 0 ? '<span class="surf-bar-warn" style="width:' + warnPct.toFixed(1) + '%"></span>' : "") +
      "</span>"
    );
  }

  function renderSurfOverview(sm) {
    const t = sm.totals;
    const apiBuckets = buildApiPrefixGroups(sm.endpoints);
    const topApi = apiBuckets.slice(0, 5);
    const maxApi = topApi.reduce((m, g) => Math.max(m, g.items.length), 1);
    const apiUnits = new Map();
    for (const ep of sm.endpoints) {
      const u = shortPkg(ep.unit);
      apiUnits.set(u, (apiUnits.get(u) || 0) + 1);
    }
    const apiSub = Array.from(apiUnits.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([u, c]) => u + " " + c)
      .join(" · ");

    const topEnts = sm.entities.slice(0, 5);
    const maxEnt = topEnts.reduce((m, e) => Math.max(m, e.totalRefs), 1);
    const smallEntCount = sm.entities.filter((e) => e.totalRefs <= 3).length;
    const storeLabel = sm.entityDatastores.length === 1 ? sm.entityDatastores[0] : (sm.entityDatastores.length + " stores");

    const svcRows = buildConfigServiceGroups(sm.envVars);
    const topSvc = svcRows.slice(0, 5);
    const maxSvc = topSvc.reduce((m, g) => Math.max(m, g.items.length), 1);
    const extraSvcCount = Math.max(0, svcRows.length - 5);
    const extraSvcVars = svcRows.slice(5).reduce((s, g) => s + g.items.length, 0);

    const apiCol =
      '<div class="surf-ov-col">' +
      '<button class="surf-ov-head" data-surf-go="endpoints">' +
      '<div class="surf-ov-kicker">API</div>' +
      '<div class="surf-ov-num"><span class="tl-val">' + t.endpoints + '</span><span class="surf-ov-unit">routes</span></div>' +
      '<div class="surf-ov-sub">' + esc(apiSub || "no routes indexed") + "</div>" +
      "</button>" +
      '<div class="surf-ov-ledger">' +
      (topApi.length === 0
        ? '<div class="muted" style="font-size:12.5px">No HTTP routes indexed.</div>'
        : topApi.map((g) =>
            '<button class="surf-led-row" data-surf-go="endpoints" data-surf-group="' + esc(g.key) + '">' +
            '<span class="surf-led-lbl mono">' + esc(g.label) + "</span>" +
            renderSurfBar(g.items.length, g.unknownCount, maxApi, g.publicCount) +
            '<span class="surf-led-num mono">' + g.items.length + "</span>" +
            "</button>"
          ).join("")) +
      "</div>" +
      '<div class="surf-ov-verdicts">' +
      (t.noGuardEndpoints > 0 ? '<button class="surf-verdict is-warn" data-surf-go="endpoints" data-surf-facet="no_guard"><span>' + t.noGuardEndpoints + ' routes show no guard</span><span class="surf-chev">›</span></button>' : "") +
      (t.publicEndpoints > 0 ? '<button class="surf-verdict" data-surf-go="endpoints" data-surf-facet="public"><span>' + t.publicEndpoints + ' public by contract</span><span class="surf-chev">›</span></button>' : "") +
      (t.contractOnlyEndpoints > 0 ? '<button class="surf-verdict" data-surf-go="endpoints" data-surf-facet="contract_only"><span>' + t.contractOnlyEndpoints + ' exist only in an OpenAPI file</span><span class="surf-chev">›</span></button>' : "") +
      "</div></div>";

    const dataCol =
      '<div class="surf-ov-col">' +
      '<button class="surf-ov-head" data-surf-go="entities">' +
      '<div class="surf-ov-kicker">Data</div>' +
      '<div class="surf-ov-num"><span class="tl-val">' + t.entities + '</span><span class="surf-ov-unit">' + esc(storeLabel || "entities") + "</span></div>" +
      '<div class="surf-ov-sub">' + sm.entityDomains.length + " domains" + (t.foreignKeys > 0 ? " · " + t.foreignKeys + " foreign keys" : "") + "</div>" +
      "</button>" +
      '<div class="surf-ov-ledger">' +
      (topEnts.length === 0
        ? '<div class="muted" style="font-size:12.5px">No entities indexed.</div>'
        : topEnts.map((e) =>
            '<button class="surf-led-row" data-surf-go="entities" data-surf-row="' + esc(e.id) + '">' +
            '<span class="surf-led-lbl mono">' + esc(e.entity) + "</span>" +
            renderSurfBar(e.totalRefs, e.noContract ? e.totalRefs : 0, maxEnt, 0) +
            '<span class="surf-led-num mono">' + e.totalRefs + (e.domains.length > 0 ? '<span class="surf-led-sub"> ' + e.domains.length + "d</span>" : "") + "</span>" +
            "</button>"
          ).join("") +
          (sm.entities.length > 5 ? '<div class="surf-ov-tail">' + (sm.entities.length - 5) + " more, " + smallEntCount + " with 3 refs or fewer</div>" : "")) +
      "</div>" +
      '<div class="surf-ov-verdicts">' +
      (t.flaggedEntities > 0 ? '<button class="surf-verdict is-warn" data-surf-go="entities" data-surf-facet="no_contract"><span>' + t.flaggedEntities + ' shared by 3+ domains, no contract</span><span class="surf-chev">›</span></button>' : (t.noContractEntities > 0 ? '<button class="surf-verdict is-warn" data-surf-go="entities" data-surf-facet="no_contract"><span>' + t.noContractEntities + ' cross-domain with no contract</span><span class="surf-chev">›</span></button>' : "")) +
      (t.noDomainEntities > 0 ? '<button class="surf-verdict" data-surf-go="entities" data-surf-facet="no_domain"><span>' + t.noDomainEntities + ' belong to no domain</span><span class="surf-chev">›</span></button>' : "") +
      (t.multiWriterFieldCount > 0 ? '<button class="surf-verdict" data-jump-hub-tab="1"><span>' + t.multiWriterFieldCount + ' fields have several writers</span><span class="surf-chev">Flows ›</span></button>' : "") +
      (t.cascadeFks > 0 ? '<button class="surf-verdict is-warn" data-surf-go="entities" data-surf-datamode="relations"><span>' + t.cascadeFks + ' cascading foreign-key deletes</span><span class="surf-chev">›</span></button>' : "") +
      "</div></div>";

    const realServiceCount = svcRows.filter((g) => g.key !== "repo tooling & CI").length;
    const cfgCol =
      '<div class="surf-ov-col">' +
      '<button class="surf-ov-head" data-surf-go="env">' +
      '<div class="surf-ov-kicker">Config</div>' +
      '<div class="surf-ov-num"><span class="tl-val">' + t.envVars + '</span><span class="surf-ov-unit">variables, ' + t.secrets + " secrets</span></div>" +
      '<div class="surf-ov-sub">' + realServiceCount + " service" + (realServiceCount === 1 ? "" : "s") + (svcRows.some((g) => g.key === "repo tooling & CI") ? " + repo tooling" : "") + "</div>" +
      "</button>" +
      '<div class="surf-ov-ledger">' +
      (topSvc.length === 0
        ? '<div class="muted" style="font-size:12.5px">No environment variables indexed.</div>'
        : topSvc.map((g) =>
            '<button class="surf-led-row" data-surf-go="env" data-surf-group="' + esc(g.key) + '">' +
            '<span class="surf-led-lbl mono">' + esc(g.label) + "</span>" +
            renderSurfBar(g.items.length, g.driftCount, maxSvc, 0) +
            '<span class="surf-led-num mono">' + g.items.length + "</span>" +
            "</button>"
          ).join("") +
          (extraSvcCount > 0 ? '<div class="surf-ov-tail">' + extraSvcCount + " more services · " + extraSvcVars + " vars</div>" : "")) +
      "</div>" +
      '<div class="surf-ov-verdicts">' +
      (t.secretsDrift > 0 ? '<button class="surf-verdict is-warn" data-surf-go="env" data-surf-facet="secrets_drift"><span>' + t.secretsDrift + ' secrets read in code, declared nowhere</span><span class="surf-chev">›</span></button>' : "") +
      (t.driftVars > 0 ? '<button class="surf-verdict is-warn" data-surf-go="env" data-surf-facet="drift"><span>' + t.driftVars + ' variables read, declared nowhere</span><span class="surf-chev">›</span></button>' : "") +
      (t.secrets > 0 ? '<button class="surf-verdict" data-surf-go="env" data-surf-facet="secrets"><span>' + t.secretsInIac + " of " + t.secrets + ' secrets bound in IaC</span><span class="surf-chev">›</span></button>' : "") +
      "</div></div>";

    return '<div class="surf-overview">' + apiCol + dataCol + cfgCol + "</div>";
  }

  function renderSurfacesBody(sm) {
    const sub = state.dataSubtab || "overview";
    if (sub === "endpoints") return renderSurfacesApi(sm);
    if (sub === "entities" || sub === "fks") return renderSurfacesData(sm);
    if (sub === "env") return renderSurfacesConfig(sm);
    return renderSurfOverview(sm);
  }

  function rerenderSurfacesBody() {
    const body = document.getElementById("surf-body");
    if (!body) {
      render();
      return;
    }
    body.innerHTML = renderSurfacesBody(surfModel());
    syncHashFromState();
  }

  function renderDataTab() {
    const sm = surfModel();
    const t = sm.totals;
    const sub = state.dataSubtab || "overview";
    const navItems = [
      { id: "overview", label: "Overview", count: null, show: true },
      { id: "endpoints", label: "API", count: t.endpoints, show: t.endpoints > 0 },
      { id: "entities", label: "Data", count: t.entities, show: t.entities > 0 || t.foreignKeys > 0 },
      { id: "env", label: "Config", count: t.envVars, show: t.envVars > 0 },
    ].filter((n) => n.show);
    const navHtml = navItems.map((n) =>
      '<button class="surf-nav-btn' + (sub === n.id || (sub === "fks" && n.id === "entities") ? " active" : "") + '" data-data-sub="' + n.id + '">' +
      esc(n.label) + (n.count !== null ? ' <span class="surf-nav-n mono">' + n.count + "</span>" : "") +
      "</button>"
    ).join("");
    return (
      '<div class="surf-shell">' +
      '<div class="surf-topbar">' +
      '<div class="surf-nav">' + navHtml + "</div>" +
      '<div class="surf-tools">' +
      '<div class="surf-filter-wrap">' +
      '<input class="search surf-filter" id="data-filter" placeholder="Filter surfaces..." value="' + esc(state.dataFilter) + '" />' +
      (state.dataFilter ? '<button class="surf-clear" data-surf-clear-filter="1" title="Clear filter (Esc)">✕</button>' : '<span class="search-kbd">/</span>') +
      "</div>" +
      '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read Surfaces">?</button>' +
      "</div></div>" +
      renderInfoPopoverHtml() +
      '<div class="surf-body" id="surf-body">' + renderSurfacesBody(sm) + "</div>" +
      "</div>"
    );
  }

  function handleSurfacesClick(target) {
    const clearF = target.closest("[data-surf-clear-filter]");
    if (clearF) {
      state.dataFilter = "";
      render();
      return true;
    }
    const hubTab = target.closest("[data-jump-hub-tab]");
    if (hubTab) {
      state.flowReturnFromMap = false;
      state.tab = "flows";
      state.flowsSubtab = "hubs";
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const jumpDomainMap = target.closest("[data-surf-map-domain]");
    if (jumpDomainMap) {
      const dom = jumpDomainMap.getAttribute("data-surf-map-domain") || "";
      state.tab = "map";
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.activeFileGraph = null;
      state.mapMode = domainsDiag ? "domains" : "runtime";
      const dNode = (domainsDiag?.nodes || []).find((n) => n.label.toLowerCase() === dom.toLowerCase());
      state.selectedNodeId = dNode ? dNode.id : null;
      render();
      return true;
    }
    const jumpConfigUnit = target.closest("[data-surf-config-unit]");
    if (jumpConfigUnit) {
      state.tab = "data";
      state.dataSubtab = "env";
      state.surfGroup = jumpConfigUnit.getAttribute("data-surf-config-unit") || null;
      state.surfFacet = "";
      state.surfRow = null;
      state.dataFilter = "";
      render();
      return true;
    }
    const goBtn = target.closest("[data-surf-go]");
    if (goBtn) {
      const dest = goBtn.getAttribute("data-surf-go") || "overview";
      state.tab = "data";
      state.dataSubtab = dest;
      state.surfGroup = goBtn.getAttribute("data-surf-group") || null;
      state.surfFacet = goBtn.getAttribute("data-surf-facet") || "";
      state.surfRow = goBtn.getAttribute("data-surf-row") || null;
      const dm = goBtn.getAttribute("data-surf-datamode");
      state.surfDataMode = dm === "relations" ? "relations" : "footprint";
      state.dataFilter = "";
      render();
      return true;
    }
    const subBtn = target.closest("[data-data-sub]");
    if (subBtn) {
      state.dataSubtab = subBtn.getAttribute("data-data-sub") || "overview";
      state.surfFacet = "";
      state.surfGroup = null;
      state.surfRow = null;
      state.surfTailOpen = false;
      render();
      return true;
    }
    const facetBtn = target.closest("[data-surf-facet-toggle]");
    if (facetBtn) {
      const f = facetBtn.getAttribute("data-surf-facet-toggle") || "";
      state.surfFacet = state.surfFacet === f ? "" : f;
      state.surfRow = null;
      rerenderSurfacesBody();
      return true;
    }
    const dmBtn = target.closest("[data-surf-datamode-set]");
    if (dmBtn) {
      state.surfDataMode = dmBtn.getAttribute("data-surf-datamode-set") || "footprint";
      state.surfGroup = null;
      state.surfRow = null;
      rerenderSurfacesBody();
      return true;
    }
    const grpBtn = target.closest("[data-surf-select-group]");
    if (grpBtn) {
      state.surfGroup = grpBtn.getAttribute("data-surf-select-group") || null;
      state.surfRow = null;
      rerenderSurfacesBody();
      return true;
    }
    const rowBtn = target.closest("[data-surf-select-row]");
    if (rowBtn) {
      const rid = rowBtn.getAttribute("data-surf-select-row") || "";
      const toggle = rowBtn.getAttribute("data-surf-row-toggle") === "1";
      state.surfRow = toggle && state.surfRow === rid ? null : rid;
      rerenderSurfacesBody();
      return true;
    }
    const tailBtn = target.closest("[data-surf-toggle-tail]");
    if (tailBtn) {
      state.surfTailOpen = !state.surfTailOpen;
      rerenderSurfacesBody();
      return true;
    }
    return false;
  }

  function handleSurfacesKeydown(ev) {
    if (state.tab !== "data") return false;
    const activeTag = document.activeElement?.tagName;
    if (ev.key === "Escape") {
      if (state.dataFilter) {
        state.dataFilter = "";
        render();
        return true;
      }
      if (state.surfRow) {
        state.surfRow = null;
        rerenderSurfacesBody();
        return true;
      }
      return false;
    }
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return false;
    if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      const input = document.getElementById("data-filter");
      if (input instanceof HTMLInputElement) input.focus();
      return true;
    }
    const keyMap = { "1": "overview", "2": "endpoints", "3": "entities", "4": "env" };
    if (keyMap[ev.key]) {
      ev.preventDefault();
      state.dataSubtab = keyMap[ev.key];
      state.surfFacet = "";
      state.surfGroup = null;
      state.surfRow = null;
      render();
      return true;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const ledgers = Array.from(document.querySelectorAll("#surf-body [data-surf-select-group]"));
      if (ledgers.length === 0) return false;
      ev.preventDefault();
      const curIdx = ledgers.findIndex((el) => el.getAttribute("aria-selected") === "true");
      const nextIdx = ev.key === "ArrowDown"
        ? (curIdx < 0 ? 0 : Math.min(ledgers.length - 1, curIdx + 1))
        : (curIdx <= 0 ? 0 : curIdx - 1);
      const next = ledgers[nextIdx];
      if (next instanceof HTMLElement) {
        next.click();
        next.scrollIntoView({ block: "nearest" });
      }
      return true;
    }
    return false;
  }
`;
}
