export function renderEntityJourneySvgScript(): string {
  return `
  function renderEntityJourneySvg(j, bypassOnly) {
    const wSvcs = bypassOnly ? j.writeSvcs.filter((s) => !s.isOwn) : j.writeSvcs;
    const rSvcs = bypassOnly ? j.readSvcs.filter((s) => !s.isOwn) : j.readSvcs;
    const wSvcIds = new Set(wSvcs.map((s) => s.id));
    const rSvcIds = new Set(rSvcs.map((s) => s.id));
    const wCtrls = bypassOnly ? j.writeCtrls.filter((c) => c.directSkip || j.svcToCtrlEdges.some((e) => e.ctrlId === c.id && wSvcIds.has(e.svcId))) : j.writeCtrls;
    const rCtrls = bypassOnly ? j.readCtrls.filter((c) => c.directSkip || j.svcToCtrlEdges.some((e) => e.ctrlId === c.id && rSvcIds.has(e.svcId))) : j.readCtrls;
    const wCtrlIds = new Set(wCtrls.map((c) => c.id));
    const rCtrlIds = new Set(rCtrls.map((c) => c.id));
    const wRoutes = bypassOnly ? j.writeRoutes.filter((r) => j.routeToCtrlW.some((e) => e.routeId === r.id && wCtrlIds.has(e.ctrlId))) : j.writeRoutes;
    const rRoutes = bypassOnly ? j.readRoutes.filter((r) => j.routeToCtrlR.some((e) => e.routeId === r.id && rCtrlIds.has(e.ctrlId))) : j.readRoutes;

    const rowH = 44;
    const cardH = 34;
    const topPad = 46;
    const maxRows = Math.max(3, wRoutes.length, wCtrls.length, wSvcs.length, rSvcs.length, rCtrls.length, rRoutes.length);
    const width = 1244;
    const height = Math.max(240, topPad + maxRows * rowH + 22);
    const colY = (count, i) => topPad + Math.round(((maxRows - Math.max(1, count)) * rowH) / 2) + i * rowH;

    const cols = {
      wr: { x: 12, w: 146 }, wc: { x: 188, w: 140 }, ws: { x: 358, w: 152 },
      md: { x: 542, w: 160 },
      rs: { x: 734, w: 152 }, rc: { x: 916, w: 140 }, rr: { x: 1086, w: 146 },
    };

    const pos = new Map();
    wRoutes.forEach((n, i) => pos.set("W:" + n.id, { x: cols.wr.x, y: colY(wRoutes.length, i), w: cols.wr.w, h: cardH }));
    wCtrls.forEach((n, i) => pos.set("W:" + n.id, { x: cols.wc.x, y: colY(wCtrls.length, i), w: cols.wc.w, h: cardH }));
    wSvcs.forEach((n, i) => pos.set("W:" + n.id, { x: cols.ws.x, y: colY(wSvcs.length, i), w: cols.ws.w, h: cardH }));
    const modH = Math.min(160, Math.max(104, maxRows * 26));
    const modY = topPad + Math.round((maxRows * rowH - modH) / 2);
    pos.set("MODEL", { x: cols.md.x, y: modY, w: cols.md.w, h: modH });
    rSvcs.forEach((n, i) => pos.set("R:" + n.id, { x: cols.rs.x, y: colY(rSvcs.length, i), w: cols.rs.w, h: cardH }));
    rCtrls.forEach((n, i) => pos.set("R:" + n.id, { x: cols.rc.x, y: colY(rCtrls.length, i), w: cols.rc.w, h: cardH }));
    rRoutes.forEach((n, i) => pos.set("R:" + n.id, { x: cols.rr.x, y: colY(rRoutes.length, i), w: cols.rr.w, h: cardH }));

    const curve = (aKey, bKey, stroke, dashed, thick) => {
      const a = pos.get(aKey), b = pos.get(bKey);
      if (!a || !b) return "";
      const sx = a.x + a.w, sy = a.y + a.h / 2;
      const tx = b.x - 2, ty = b.y + b.h / 2;
      const dx = Math.max(20, Math.round((tx - sx) * 0.45));
      const mId = stroke === "#ff8a8a" ? "jr-err" : stroke === "#f5c26b" ? "jr-warn" : stroke === "#7cc8ff" ? "jr-read" : "jr-ok";
      return '<path class="rs-jrn-edge" data-ja="' + esc(aKey) + '" data-jb="' + esc(bKey) + '" d="M' + sx + "," + sy + " C" + (sx + dx) + "," + sy + " " + (tx - dx) + "," + ty + " " + tx + "," + ty + '" fill="none" stroke="' + stroke + '" stroke-width="' + (thick ? "2.1" : "1.4") + '" stroke-opacity="' + (thick ? "0.85" : "0.58") + '"' + (dashed ? ' stroke-dasharray="4 3"' : "") + ' marker-end="url(#' + mId + ')"/>';
    };

    const edgesHtml = [];
    for (const e of j.routeToCtrlW) edgesHtml.push(curve("W:" + e.routeId, "W:" + e.ctrlId, "#5fd9a0", false, false));
    for (const e of j.svcToCtrlEdges) {
      if (pos.has("W:" + e.ctrlId) && pos.has("W:" + e.svcId)) {
        const sObj = wSvcs.find((s) => s.id === e.svcId);
        edgesHtml.push(curve("W:" + e.ctrlId, "W:" + e.svcId, sObj?.isOwn ? "#5fd9a0" : "#f5c26b", !sObj?.isOwn, false));
      }
      if (pos.has("R:" + e.svcId) && pos.has("R:" + e.ctrlId)) {
        const sObj = rSvcs.find((s) => s.id === e.svcId);
        edgesHtml.push(curve("R:" + e.svcId, "R:" + e.ctrlId, sObj?.isOwn ? "#7cc8ff" : "#f5c26b", !sObj?.isOwn, false));
      }
    }
    for (const s of wSvcs) edgesHtml.push(curve("W:" + s.id, "MODEL", s.isOwn ? "#5fd9a0" : "#f5c26b", !s.isOwn, !s.isOwn));
    for (const s of rSvcs) edgesHtml.push(curve("MODEL", "R:" + s.id, s.isOwn ? "#7cc8ff" : "#f5c26b", !s.isOwn, !s.isOwn));
    for (const e of j.routeToCtrlR) edgesHtml.push(curve("R:" + e.ctrlId, "R:" + e.routeId, "#7cc8ff", false, false));
    for (const sk of j.layerSkips) {
      if (pos.has("W:" + sk.ctrlId)) edgesHtml.push(curve("W:" + sk.ctrlId, "MODEL", "#ff8a8a", false, true));
      if (pos.has("R:" + sk.ctrlId)) edgesHtml.push(curve("MODEL", "R:" + sk.ctrlId, "#ff8a8a", false, true));
    }

    const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
    const box = (key, nodeKey, title, sub, stroke, fill, dashed) => {
      const p = pos.get(key);
      if (!p) return "";
      const isSel = state.jrnSelNode === nodeKey;
      return (
        '<g class="rs-jrn-node' + (isSel ? " is-sel" : "") + '" data-jrn-key="' + esc(key) + '" data-jrn-pick="' + esc(nodeKey) + '" style="cursor:pointer">' +
        '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="6" fill="' + fill + '" stroke="' + (isSel ? "#7cc8ff" : stroke) + '" stroke-width="' + (isSel ? "2" : "1.2") + '"' + (dashed ? ' stroke-dasharray="3 2"' : "") + "/>" +
        '<text x="' + (p.x + 9) + '" y="' + (p.y + 15) + '" fill="#e8ecf4" font-size="9.3" font-weight="700" font-family="ui-monospace,monospace">' + esc(trunc(title, 18)) + "</text>" +
        '<text x="' + (p.x + 9) + '" y="' + (p.y + 27) + '" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">' + esc(trunc(sub, 22)) + "</text></g>"
      );
    };

    const nodesHtml = [];
    for (const r of wRoutes) nodesHtml.push(box("W:" + r.id, r.id, r.label, Array.from(r.methods).slice(0, 2).join("/") + " · " + r.endpoints.length, "#5fd9a0", "rgba(95,217,160,0.11)", false));
    for (const c of wCtrls) nodesHtml.push(box("W:" + c.id, "w:" + c.id, c.label, c.directSkip ? "⚠ skips service" : c.files.length + " ctrl file" + (c.files.length === 1 ? "" : "s"), c.directSkip ? "#ff8a8a" : "#64748b", c.directSkip ? "rgba(255,138,138,0.13)" : "rgba(148,163,184,0.09)", false));
    for (const s of wSvcs) nodesHtml.push(box("W:" + s.id, "w:" + s.id, s.label, s.isOwn ? "✓ owner · " + s.files.length + "f" : "⚠ bypass · " + s.files.length + "f", s.isOwn ? "#5fd9a0" : "#f5c26b", s.isOwn ? "rgba(95,217,160,0.14)" : "rgba(245,194,107,0.13)", !s.isOwn));
    for (const s of rSvcs) nodesHtml.push(box("R:" + s.id, "r:" + s.id, s.label, s.isOwn ? "✓ owner · " + s.files.length + "f" : "⚠ bypass · " + s.files.length + "f", s.isOwn ? "#7cc8ff" : "#f5c26b", s.isOwn ? "rgba(124,200,255,0.13)" : "rgba(245,194,107,0.13)", !s.isOwn));
    for (const c of rCtrls) nodesHtml.push(box("R:" + c.id, "r:" + c.id, c.label, c.directSkip ? "⚠ skips service" : c.files.length + " ctrl file" + (c.files.length === 1 ? "" : "s"), c.directSkip ? "#ff8a8a" : "#64748b", c.directSkip ? "rgba(255,138,138,0.13)" : "rgba(148,163,184,0.09)", false));
    for (const r of rRoutes) nodesHtml.push(box("R:" + r.id, r.id, r.label, "GET · " + r.endpoints.length + " route" + (r.endpoints.length === 1 ? "" : "s"), "#7cc8ff", "rgba(124,200,255,0.11)", false));

    const mp = pos.get("MODEL");
    const isClean = j.bypassSvcCount === 0 && j.layerSkips.length === 0;
    const modStroke = j.layerSkips.length > 0 ? "#ff8a8a" : j.bypassSvcCount > 0 ? "#f5c26b" : "#5fd9a0";
    const modCard =
      '<g class="rs-jrn-node" data-jrn-key="MODEL" data-jrn-pick="MODEL" style="cursor:pointer">' +
      '<rect x="' + mp.x + '" y="' + mp.y + '" width="' + mp.w + '" height="' + mp.h + '" rx="10" fill="#111622" stroke="' + modStroke + '" stroke-width="2"/>' +
      '<text x="' + (mp.x + mp.w / 2) + '" y="' + (mp.y + 24) + '" text-anchor="middle" fill="#94a3b8" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">' + esc(j.datastore.toUpperCase()) + " MODEL</text>" +
      '<text x="' + (mp.x + mp.w / 2) + '" y="' + (mp.y + 44) + '" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="700" font-family="ui-monospace,monospace">' + esc(trunc(j.label, 14)) + "</text>" +
      '<text x="' + (mp.x + mp.w / 2) + '" y="' + (mp.y + 64) + '" text-anchor="middle" fill="#b0b9cb" font-size="9" font-family="ui-monospace,monospace">' + j.daoFiles.length + " DAOs" + (j.hub ? " · " + j.hub.fieldCount + " fields" : "") + "</text>" +
      (j.sm ? '<text x="' + (mp.x + mp.w / 2) + '" y="' + (mp.y + 80) + '" text-anchor="middle" fill="#4fd8c4" font-size="8.5" font-family="ui-monospace,monospace">◈ ' + esc(trunc(j.sm.name, 16)) + " (" + j.sm.stateCount + "st)</text>" : "") +
      '<text x="' + (mp.x + mp.w / 2) + '" y="' + (mp.y + mp.h - 14) + '" text-anchor="middle" fill="' + modStroke + '" font-size="8.8" font-weight="700" font-family="ui-monospace,monospace">' +
      (isClean ? "✓ Clean Bow-Tie" : (j.layerSkips.length > 0 ? j.layerSkips.length + " layer skips · " : "") + j.bypassSvcCount + " outside svcs") +
      "</text></g>";

    return (
      '<svg class="rs-flow-svg rs-jrn-svg" viewBox="0 0 ' + width + " " + height + '" width="100%" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '<marker id="jr-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#5fd9a0"/></marker>' +
      '<marker id="jr-read" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#7cc8ff"/></marker>' +
      '<marker id="jr-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#f5c26b"/></marker>' +
      '<marker id="jr-err" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#ff8a8a"/></marker>' +
      "</defs>" +
      '<text x="260" y="16" text-anchor="middle" fill="#5fd9a0" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">WRITE PATH (CHANGES GOING IN) ──▶</text>' +
      '<text x="984" y="16" text-anchor="middle" fill="#7cc8ff" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">──▶ READ PATH (DATA COMING OUT)</text>' +
      '<text x="' + (cols.wr.x + cols.wr.w / 2) + '" y="34" text-anchor="middle" fill="#6b7690" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">WRITE ROUTES (' + j.totalWriteEps + ")</text>" +
      '<text x="' + (cols.wc.x + cols.wc.w / 2) + '" y="34" text-anchor="middle" fill="#6b7690" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">CONTROLLERS</text>' +
      '<text x="' + (cols.ws.x + cols.ws.w / 2) + '" y="34" text-anchor="middle" fill="#6b7690" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">SERVICES (IN)</text>' +
      '<text x="' + (cols.md.x + cols.md.w / 2) + '" y="34" text-anchor="middle" fill="#e8ecf4" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">ENTITY + DAOs</text>' +
      '<text x="' + (cols.rs.x + cols.rs.w / 2) + '" y="34" text-anchor="middle" fill="#6b7690" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">SERVICES (OUT)</text>' +
      '<text x="' + (cols.rc.x + cols.rc.w / 2) + '" y="34" text-anchor="middle" fill="#6b7690" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">CONTROLLERS</text>' +
      '<text x="' + (cols.rr.x + cols.rr.w / 2) + '" y="34" text-anchor="middle" fill="#6b7690" font-size="8.5" font-weight="700" font-family="ui-monospace,monospace">READ ROUTES (' + j.totalReadEps + ")</text>" +
      '<g class="rs-jrn-edges">' + edgesHtml.join("") + "</g>" +
      nodesHtml.join("") + modCard + "</svg>"
    );
  }

  function renderJourneyView(backMapBtn, subNav, zoomBtns, dockToggleBtn, navStepBtns, guideBtn) {
    const all = buildEntityJourneys();
    const j = all.find((x) => x.key === state.activeJourneyKey) || all[0] || null;
    const bpOnly = Boolean(state.jrnBypassOnly);
    const modeBtns =
      '<span class="seg-group">' +
      '<button class="seg-btn' + (!bpOnly ? " active" : "") + '" data-jrn-bypass="0">All Paths</button>' +
      '<button class="seg-btn' + (bpOnly ? " active" : "") + '" data-jrn-bypass="1">Bypasses Only</button>' +
      "</span>";
    const stageHead =
      '<div class="fx-stage-head">' +
      '<div class="fx-head-l">' + backMapBtn + subNav +
      '<span class="hud-sep"></span><span class="crumb-cur">' + esc(j ? j.label : "None") + "</span>" +
      (j ? '<span class="mono muted" style="font-size:12px">' + j.totalWriteEps + " write · " + j.totalReadEps + " read · " + j.ownSvcCount + " owner / " + j.bypassSvcCount + " outside svcs</span>" : "") +
      "</div>" +
      '<div class="fx-head-r">' + modeBtns + zoomBtns + dockToggleBtn + navStepBtns + guideBtn + "</div>" +
      "</div>";
    const legendStrip =
      '<div class="fx-legend-strip">' +
      '<span class="fx-legend-chip">Write Routes → Controllers → Services → Model → Services → Controllers → Read Routes</span>' +
      '<span class="fx-legend-chip"><span class="fr-dot" style="background:var(--ok)"></span>Own entity service</span>' +
      '<span class="fx-legend-chip"><span class="fr-dot is-warn"></span>Outside-domain service touching DAO directly</span>' +
      '<span class="fx-legend-chip"><span class="fr-dot is-err"></span>Controller skips service</span>' +
      "</div>";
    if (!j) return { stageHead, legendStrip, stageBody: '<div class="fx-empty">No domain entity journeys extracted for this repository.</div>', ctxTitle: "Entity Journey", ctxAction: "", ctxHtml: "", codeHtml: "" };

    const stageBody = renderEntityJourneySvg(j, bpOnly);
    const pick = state.jrnSelNode || "MODEL";
    let ctxTitle = '<span class="mono">' + esc(j.label) + "</span> Journey";
    let ctxHtml = "";
    let focusFile = state.flowCodeFile || j.daoFiles[0]?.file || ".";
    let focusLine = state.flowCodeFile ? (state.flowCodeLine || 1) : 1;

    const matchRoute = j.writeRoutes.find((r) => r.id === pick) || j.readRoutes.find((r) => r.id === pick);
    const matchSvc = j.allSvcs.find((s) => ("w:" + s.id) === pick || ("r:" + s.id) === pick);
    const matchCtrl = j.allCtrls.find((c) => ("w:" + c.id) === pick || ("r:" + c.id) === pick);

    if (matchRoute) {
      ctxTitle = '<span class="mono">' + esc(matchRoute.label) + "</span> (" + matchRoute.endpoints.length + " routes)";
      if (!state.flowCodeFile && matchRoute.endpoints[0]?.file) { focusFile = matchRoute.endpoints[0].file; focusLine = matchRoute.endpoints[0].line || 1; }
      ctxHtml = '<div><div class="sec-title" style="margin-bottom:4px">' + (matchRoute.isWrite ? "Write" : "Read") + " Endpoints</div>" +
        matchRoute.endpoints.slice(0, 20).map((ep) =>
          '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(ep.file || "") + '" data-flow-jump-line="' + (ep.line || 1) + '">' +
          '<span class="surf-meth mono ' + flowMethodCls(ep.method) + '">' + esc(ep.method) + '</span><span class="mono" style="overflow:hidden;text-overflow:ellipsis">' + esc(ep.path) + "</span></div>"
        ).join("") + "</div>";
    } else if (matchSvc) {
      ctxTitle = '<span class="mono">service/' + esc(matchSvc.label) + "</span> " + (matchSvc.isOwn ? '<span class="badge b-pass">owner</span>' : '<span class="badge b-warn">outside bypass</span>');
      if (!state.flowCodeFile && matchSvc.files[0]) focusFile = matchSvc.files[0].file;
      ctxHtml = '<div><div class="sec-title" style="margin-bottom:4px">Service Files Touching ' + esc(j.label) + " DAOs (" + matchSvc.files.length + ")</div>" +
        matchSvc.files.map((f) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(f.file) + '" data-flow-jump-line="1"><span class="mono">' + esc(f.file.split("/").pop()) + '</span><span class="mono muted">' + (f.isWriter ? "writes · " : "") + esc(flowBaseFile(f.file)) + " →</span></div>").join("") + "</div>";
    } else if (matchCtrl) {
      ctxTitle = '<span class="mono">controller/' + esc(matchCtrl.label) + "</span>" + (matchCtrl.directSkip ? ' <span class="badge b-fail">skips service</span>' : "");
      if (!state.flowCodeFile && matchCtrl.files[0]) focusFile = matchCtrl.files[0].file;
      ctxHtml = '<div><div class="sec-title" style="margin-bottom:4px">Controller Files (' + matchCtrl.files.length + ")</div>" +
        matchCtrl.files.map((f) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(f.file) + '" data-flow-jump-line="1"><span class="mono">' + esc(f.file.split("/").pop()) + '</span><span class="mono muted">' + esc(flowBaseFile(f.file)) + " →</span></div>").join("") + "</div>";
    } else {
      const bypassSvcs = j.allSvcs.filter((s) => !s.isOwn);
      ctxHtml =
        (j.layerSkips.length > 0
          ? '<div><div class="sec-title" style="margin-bottom:4px;color:var(--err)">Layer Skips — Controller → DAO (' + j.layerSkips.length + ")</div>" +
            j.layerSkips.slice(0, 8).map((sk) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(sk.from) + '" data-flow-jump-line="' + sk.line + '"><span class="mono">' + esc(sk.from.split("/").pop()) + '</span><span class="mono muted">→ ' + esc(sk.to.split("/").pop()) + "</span></div>").join("") + "</div>"
          : "") +
        (bypassSvcs.length > 0
          ? '<div><div class="sec-title" style="margin-bottom:4px;color:var(--warn)">Outside-Domain Services Hitting ' + esc(j.label) + " DAO (" + bypassSvcs.length + " groups)</div>" +
            bypassSvcs.slice(0, 10).map((s) => '<div class="row" style="cursor:pointer" data-jrn-pick="w:' + esc(s.id) + '"><span class="mono">service/' + esc(s.label) + '</span><span class="mono muted">' + s.files.length + " file" + (s.files.length === 1 ? "" : "s") + " →</span></div>").join("") + "</div>"
          : '<div class="muted" style="font-size:12px">All service access to ' + esc(j.label) + " flows cleanly through its own service layer.</div>") +
        '<div><div class="sec-title" style="margin-bottom:4px">Persistence / DAO Files (' + j.daoFiles.length + ")</div>" +
        j.daoFiles.slice(0, 12).map((d) => '<div class="row" style="cursor:pointer" data-flow-jump-file="' + esc(d.file) + '" data-flow-jump-line="1"><span class="mono">' + esc(d.file.split("/").pop()) + '</span><span class="mono muted">' + esc(flowBaseFile(d.file)) + " →</span></div>").join("") + "</div>";
    }

    const ctxAction = '<button class="tbtn" data-copy-journey-ctx="' + esc(j.key) + '">Copy Context</button>';
    return { stageHead, legendStrip, stageBody, ctxTitle, ctxAction, ctxHtml, codeHtml: renderFlowCodeSnippet(focusFile, focusLine) };
  }
`;
}
