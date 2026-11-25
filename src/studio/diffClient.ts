export function renderDiffClientScript(): string {
  return `
  function activeDiffBundle() {
    const cd = DATA.commitDiff;
    if (!cd || !cd.diagrams || cd.diagrams.length === 0) return null;
    return cd.diagrams.find((d) => d.id === state.diffDiagramId) || cd.diagrams[0];
  }

  function renderDiffSvg(diag, opts) {
    const mode = opts?.mode || "overlay";
    const statusSet = opts?.statusById || null;
    const isMiniSplit = Boolean(opts?.split);
    const lanesSvg = (diag.lanes || []).map((l) => {
      const fill = l.lateral ? "rgba(99,102,241,0.035)" : "rgba(148,163,184,0.024)";
      return (
        '<g class="lane">' +
        '<rect x="' + l.x + '" y="' + l.y + '" width="' + l.w + '" height="' + l.h + '" rx="12" fill="' + fill + '" stroke="rgba(255,255,255,0.09)" stroke-width="1" stroke-dasharray="4 4" />' +
        '<text x="' + (l.x + 12) + '" y="' + (l.y + 21) + '" font-size="11.5" font-weight="600" fill="#8c98b0" letter-spacing="0.08em">' + esc(l.label.toUpperCase()) + "</text>" +
        "</g>"
      );
    }).join("");

    const edgesSvg = (diag.edges || []).map((e) => {
      if (!e.points || e.points.length < 2) return "";
      const p0 = e.points[0];
      let d = "M " + p0.x + " " + p0.y;
      if (e.points.length === 4) {
        d += " C " + e.points[1].x + " " + e.points[1].y + ", " + e.points[2].x + " " + e.points[2].y + ", " + e.points[3].x + " " + e.points[3].y;
      } else if (e.points.length === 3) {
        d += " Q " + e.points[1].x + " " + e.points[1].y + " " + e.points[2].x + " " + e.points[2].y;
      } else if (e.points.length >= 5) {
        d = buildRoundedPolylinePath(e.points);
      } else {
        for (let i = 1; i < e.points.length; i += 1) d += " L " + e.points[i].x + " " + e.points[i].y;
      }
      const ds = e.diffStatus || "unchanged";
      const isAdded = ds === "added";
      const isRemoved = ds === "removed";
      const stroke = isAdded ? "#10b981" : isRemoved ? "#ef4444" : e.violation ? "#ef4444" : "rgba(148,163,184,0.22)";
      const dash = isRemoved ? ' stroke-dasharray="5 4"' : "";
      const sw = isAdded || isRemoved ? 2.2 : 1.1;
      const op = isAdded || isRemoved ? 1 : mode === "overlay" ? 0.35 : 0.6;
      const marker = isAdded ? "url(#m-green)" : isRemoved ? "url(#m-red)" : "url(#m-neutral)";
      return (
        '<g class="svg-edge-group" style="opacity:' + op + '" data-edge="' + esc(e.id) + '" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '">' +
        (isAdded || isRemoved ? '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="6" opacity="0.18" />' : "") +
        '<path class="svg-edge-vis" d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + ' marker-end="' + marker + '" />' +
        "</g>"
      );
    }).join("");

    const nodesSvg = (diag.nodes || []).map((n) => {
      const ds = n.diffStatus || (statusSet ? statusSet.get(n.id) : null) || "unchanged";
      const isSel = state.selectedNodeId === n.id;
      const x = n.x - n.w / 2;
      const y = n.y - n.h / 2;
      const stroke = isSel
        ? "#818cf8"
        : ds === "added"
          ? "#10b981"
          : ds === "removed"
            ? "#ef4444"
            : ds === "modified"
              ? "#f59e0b"
              : "rgba(255,255,255,0.11)";
      const fill = ds === "added"
        ? "rgba(16,185,129,0.12)"
        : ds === "removed"
          ? "rgba(239,68,68,0.08)"
          : ds === "modified"
            ? "rgba(245,158,11,0.1)"
            : "#141a29";
      const dash = ds === "removed" ? ' stroke-dasharray="5 3"' : "";
      const op = isSel || ds !== "unchanged" ? 1 : mode === "overlay" ? 0.44 : 0.72;
      const tone = nodeVisualTone(n);
      const badgeLabel = ds === "added" ? "+" : ds === "removed" ? "−" : ds === "modified" ? "~" : "";
      const badgeColor = ds === "added" ? "#10b981" : ds === "removed" ? "#ef4444" : "#f59e0b";
      const pill = badgeLabel
        ? '<circle cx="' + (x + n.w - 6) + '" cy="' + (y + 6) + '" r="8.5" fill="' + badgeColor + '" />' +
          '<text x="' + (x + n.w - 6) + '" y="' + (y + 9.4) + '" text-anchor="middle" font-size="11" font-weight="800" fill="#080b12">' + badgeLabel + "</text>"
        : "";
      const subText = n.deltaLabel ? (n.deltaLabel + (n.sublabel ? " · " + n.sublabel : "")) : (n.sublabel || "");
      const cleanSub = subText.replace(new RegExp("⊞\\\\s*", "g"), "").trim();
      const maxChars = Math.max(10, Math.floor((n.w - 60) / 8.0));
      const titleStr = n.label.length > maxChars ? n.label.slice(0, maxChars - 1) + "…" : n.label;
      const subMax = Math.max(12, Math.floor((n.w - 58) / 6.7));
      const subStr = cleanSub.length > subMax ? cleanSub.slice(0, subMax - 1) + "…" : cleanSub;
      const diffTip = n.label + (cleanSub ? " — " + cleanSub : "") + (ds !== "unchanged" ? " (" + ds.toUpperCase() + " — click for changed files)" : "");
      return (
        '<g class="svg-node' + (isSel ? " selected" : "") + '" tabindex="0" role="button" aria-label="' + esc(n.label) + '" style="opacity:' + op + '" data-node="' + esc(n.id) + '"><title>' + esc(diffTip) + "</title>" +
        '<rect class="node-shape" x="' + x + '" y="' + y + '" width="' + n.w + '" height="' + n.h + '" rx="10" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (ds !== "unchanged" || isSel ? 1.8 : 1.1) + '"' + dash + " />" +
        '<rect x="' + (x + 11) + '" y="' + (n.y - 13) + '" width="26" height="26" rx="6" fill="' + tone.bg + '" />' +
        renderGlyphPath(tone.glyph, x + 24, n.y, tone.stroke) +
        '<text x="' + (x + 44) + '" y="' + (n.y - (subStr ? 4 : -4.5)) + '" font-size="13.5" font-weight="600" fill="' + (ds === "removed" ? "#ff9a9a" : "#e6ebf5") + '"' + (ds === "removed" ? ' text-decoration="line-through"' : "") + ">" + esc(titleStr) + "</text>" +
        (subStr ? '<text x="' + (x + 44) + '" y="' + (n.y + 13.5) + '" font-size="11.5" fill="' + (ds === "modified" ? "#f5c26b" : ds === "added" ? "#6ee7b0" : "#8793ab") + '" font-family="ui-monospace, monospace">' + esc(subStr) + "</text>" : "") +
        pill +
        "</g>"
      );
    }).join("");

    const padX = isMiniSplit ? 24 : 68;
    const padY = isMiniSplit ? 24 : 66;
    const svgId = isMiniSplit ? "" : ' id="diagram-svg"';
    const vpOpen = isMiniSplit ? "<g>" : '<g id="viewport-g" transform="translate(' + state.tx + "," + state.ty + ") scale(" + state.scale + ')">';
    return (
      "<svg" + svgId + ' viewBox="' + (-padX) + " " + (-padY) + " " + (diag.width + padX * 2) + " " + (diag.height + padY * 2) + '" preserveAspectRatio="xMidYMid meet">' +
      "<defs>" +
      '<marker id="m-neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="rgba(148,163,184,0.55)" /></marker>' +
      '<marker id="m-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="#ef4444" /></marker>' +
      '<marker id="m-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="#10b981" /></marker>' +
      "</defs>" +
      vpOpen +
      lanesSvg +
      edgesSvg +
      nodesSvg +
      "</g></svg>"
    );
  }

  function renderDiffDrawer() {
    const cd = DATA.commitDiff;
    if (!cd) return "";
    const vCls = cd.verdict === "risk" ? "b-fail" : cd.verdict === "caution" ? "b-warn" : "b-pass";
    const kpiDelta = (d, invert) => {
      if (d === 0) return '<span class="muted">0</span>';
      const good = invert ? d < 0 : d > 0;
      return '<span class="' + (good ? "status-pass" : "status-fail") + '">' + (d > 0 ? "+" : "") + d + "</span>";
    };

    const introSec =
      '<div class="sec"><div class="sec-title"><span>New Issues Introduced (' + cd.findings.introduced.length + ')</span></div>' +
      (cd.findings.introduced.length === 0
        ? '<div class="ev-box" style="border-left-color:#10b981;color:#6ee7b7">0 new architectural violations introduced.</div>'
        : cd.findings.introduced.slice(0, 12).map((f) =>
            '<div class="ev-box ' + (f.severity === "error" ? "fail" : "warn") + '">' +
            '<div style="display:flex;justify-content:space-between;gap:6px"><strong>' + esc(f.invariantName) + '</strong><span class="badge ' + (f.severity === "error" ? "b-fail" : "b-warn") + '">' + (f.severity === "error" ? "FAIL" : "WARN") + "</span></div>" +
            '<div class="muted">' + esc(f.detail) + "</div>" +
            provenanceLinksHtml(f.file, f.line) +
            (f.fix ? '<div class="fix-note"><strong>Fix:</strong> ' + esc(f.fix) + "</div>" : "") +
            "</div>"
          ).join("")) +
      "</div>";

    const resolvedSec = cd.findings.resolved.length > 0
      ? '<div class="sec"><div class="sec-title"><span>Issues Resolved (' + cd.findings.resolved.length + ")</span></div>" +
        cd.findings.resolved.slice(0, 8).map((f) =>
          '<div class="ev-box" style="border-left-color:#10b981"><strong>' + esc(f.invariantName) + '</strong><div class="muted">' + esc(f.file) + "</div></div>"
        ).join("") +
        "</div>"
      : "";

    const surfRows = [];
    for (const ep of cd.surfaces.endpointsAdded.slice(0, 6)) surfRows.push('<div class="row"><span class="mono status-pass">+ ' + esc(ep) + '</span><span class="badge b-pass">endpoint</span></div>');
    for (const ep of cd.surfaces.endpointsRemoved.slice(0, 6)) surfRows.push('<div class="row"><span class="mono status-fail">− ' + esc(ep) + '</span><span class="badge b-fail">endpoint</span></div>');
    for (const ex of cd.surfaces.externalAdded) surfRows.push('<div class="row"><span class="mono status-warn">+ ' + esc(ex) + '</span><span class="badge b-warn">external</span></div>');
    for (const ev of cd.surfaces.envAdded.slice(0, 6)) surfRows.push('<div class="row"><span class="mono status-pass">+ ' + esc(ev) + '</span><span class="badge b-info">env</span></div>');
    for (const en of cd.surfaces.entitiesAdded.slice(0, 6)) surfRows.push('<div class="row"><span class="mono status-pass">+ ' + esc(en) + '</span><span class="badge b-purple">entity</span></div>');
    const surfSec = surfRows.length > 0 ? '<div class="sec"><div class="sec-title">Surface Changes</div>' + surfRows.join("") + "</div>" : "";

    const edgeRows = [
      ...cd.edgeChanges.added.slice(0, 8).map((e) => '<div class="row"><span class="mono status-pass">+ ' + esc(shortPkg(e.from) + " → " + shortPkg(e.to)) + '</span><span class="muted mono">' + esc(e.kind) + "</span></div>"),
      ...cd.edgeChanges.removed.slice(0, 8).map((e) => '<div class="row"><span class="mono status-fail">− ' + esc(shortPkg(e.from) + " → " + shortPkg(e.to)) + '</span><span class="muted mono">' + esc(e.kind) + "</span></div>"),
    ];
    const edgeSec = edgeRows.length > 0 ? '<div class="sec"><div class="sec-title">Structural Wire Delta (+' + cd.edgeChanges.added.length + " / −" + cd.edgeChanges.removed.length + ")</div>" + edgeRows.join("") + "</div>" : "";

    const filesSec =
      '<div class="sec"><div class="sec-title"><span>Changed Files (' + cd.changedFiles.length + ')</span><span class="mono muted">+' + cd.kpis.files.insertions + "/-" + cd.kpis.files.deletions + "</span></div>" +
      cd.changedFiles.slice(0, 24).map((f) => {
        const canCode = f.status !== "deleted" && ddIdxByPath.has(f.path);
        const attr = canCode ? 'data-open-file-graph="' + esc(f.path) + '"' : (f.moduleId ? 'data-select-node="' + esc(f.moduleId) + '"' : "");
        const hunkBtn = f.hunk ? '<button class="tbtn" style="padding:2px 6px;font-size:11px" data-toggle-hunk="' + esc(f.path) + '">Diff</button>' : "";
        return '<div class="row">' +
          '<span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" ' + attr + ' title="' + esc(f.path + (canCode ? " — click to inspect symbol callstack & code" : "")) + '">' +
          (f.status === "added" ? "+ " : f.status === "deleted" ? "− " : "~ ") + esc(f.path.split("/").slice(-2).join("/")) +
          '</span><span style="display:inline-flex;align-items:center;gap:6px;flex-shrink:0"><span class="mono muted" style="white-space:nowrap">+' + f.insertions + "/-" + f.deletions + (f.blastRadius > 0 ? " · " + f.blastRadius + "c" : "") + "</span>" + hunkBtn + "</span></div>";
      }).join("") +
      "</div>";

    const activeHunkFile = state.diffSelectedFile ? cd.changedFiles.find((f) => f.path === state.diffSelectedFile) : null;
    const hunkSec = activeHunkFile ? renderDiffHunkHtml(activeHunkFile) : "";
    const prKey = activeHunkFile ? activeHunkFile.path : "whole";
    const prAiRes = prAiCache.get(prKey);
    const prAiLoad = prAiPending.has(prKey);
    const prAiErr = prAiErrors.get(prKey) || "";
    const prAiSec =
      '<div class="explain-box">' +
      '<div class="explain-head">' +
      '<div class="explain-head-left"><span class="sec-title" style="color:var(--text-2)">' + (activeHunkFile ? "File Diff Summary" : "PR Summary") + "</span>" +
      (prAiRes ? '<span class="badge b-purple">✦ AI · ' + esc(prAiRes.model) + "</span>" : '<span class="badge b-na">Opt-In</span>') + "</div>" +
      '<button class="tbtn explain-ai-btn" data-pr-ai-ask="' + esc(prKey) + '"' + (prAiLoad ? " disabled" : "") + ">" + (prAiLoad ? "Thinking…" : prAiRes ? "↻ Refresh AI" : "✦ Explain PR with Local AI") + "</button>" +
      "</div>" +
      (prAiRes ? '<div class="explain-body">' + esc(prAiRes.does) + "</div>" + (prAiRes.watch ? '<div class="explain-watch"><strong>Watch out:</strong> ' + esc(prAiRes.watch) + "</div>" : "") : '<div class="muted" style="font-size:12.5px">Click <strong>✦ Explain PR with Local AI</strong> for an on-demand plain-English walkthrough of this ' + (activeHunkFile ? "file diff" : "commit") + ".</div>") +
      (prAiErr ? '<div class="explain-err">' + esc(prAiErr) + "</div>" : "") +
      "</div>";

    const bundle = activeDiffBundle();
    const selDiffNode = state.selectedNodeId && bundle ? bundle.overlay.nodes.find((n) => n.id === state.selectedNodeId) : null;
    const selFiles = selDiffNode ? cd.changedFiles.filter((f) => f.moduleId === selDiffNode.id) : [];
    const selDiffSec = selDiffNode
      ? '<div class="ev-box" style="border-left-color:' + (selDiffNode.diffStatus === "added" ? "#10b981" : selDiffNode.diffStatus === "removed" ? "#ef4444" : "#f59e0b") + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong style="color:var(--text-1)">' + esc(selDiffNode.label) + '</strong><div style="display:flex;gap:6px;align-items:center"><span class="badge ' + (selDiffNode.diffStatus === "added" ? "b-pass" : selDiffNode.diffStatus === "removed" ? "b-fail" : selDiffNode.diffStatus === "modified" ? "b-warn" : "b-na") + '">' + esc((selDiffNode.diffStatus || "unchanged").toUpperCase()) + '</span><button class="tbtn" data-clear-sel="1">✕</button></div></div>' +
        (selFiles.length > 0
          ? selFiles.slice(0, 8).map((f) => {
              const canCode = f.status !== "deleted" && ddIdxByPath.has(f.path);
              return '<div class="row"><span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" ' + (canCode ? 'data-open-file-graph="' + esc(f.path) + '"' : "") + ">" + esc(f.path.split("/").slice(-2).join("/")) + '</span><span class="mono muted" style="flex-shrink:0;white-space:nowrap">+' + f.insertions + "/-" + f.deletions + (canCode ? " →" : "") + "</span></div>";
            }).join("")
          : '<div class="muted">No direct file edits inside this node (context neighbor).</div>') +
        "</div>"
      : "";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">Commit Architecture Diff</div><div class="drawer-sub">' + esc(cd.baseSha + " → " + cd.headSha + " · " + cd.author) + ' · <span style="white-space:nowrap">' + esc(cd.date) + '</span></div></div><span class="badge ' + vCls + '">' + esc(cd.verdict.toUpperCase()) + "</span></div>" +
      selDiffSec +
      '<div class="story-box" style="border-left-color:' + (cd.verdict === "risk" ? "#ef4444" : cd.verdict === "caution" ? "#f59e0b" : "#10b981") + '"><strong>' + esc(cd.commitSubject) + "</strong><br/>" + esc(cd.verdictSummary) + "</div>" +
      prAiSec +
      hunkSec +
      '<div class="sec"><div class="sec-title">Before → After State</div>' +
      '<div class="row"><span class="muted">Invariant Failures</span><span class="mono">' + cd.kpis.failures.before + " → " + cd.kpis.failures.after + " (" + kpiDelta(cd.kpis.failures.delta, true) + ")</span></div>" +
      '<div class="row"><span class="muted">Invariant Warnings</span><span class="mono">' + cd.kpis.warnings.before + " → " + cd.kpis.warnings.after + " (" + kpiDelta(cd.kpis.warnings.delta, true) + ")</span></div>" +
      '<div class="row"><span class="muted">Direct Test Coverage</span><span class="mono">' + cd.kpis.coveragePct.before + "% → " + cd.kpis.coveragePct.after + "% (" + kpiDelta(cd.kpis.coveragePct.delta, false) + "%)</span></div>" +
      '<div class="row"><span class="muted">Canvas Nodes</span><span class="mono"><span class="status-pass">+' + cd.kpis.nodes.added + '</span> · <span class="status-warn">~' + cd.kpis.nodes.modified + '</span> · <span class="status-fail">−' + cd.kpis.nodes.removed + "</span></span></div>" +
      "</div>" +
      introSec +
      resolvedSec +
      surfSec +
      edgeSec +
      filesSec
    );
  }

  function renderDiffTab() {
    const cd = DATA.commitDiff;
    if (!cd) return '<div class="table-wrap"><div class="muted">No commit diff loaded. Run <code>repospec diff-view &lt;repo&gt; &lt;base..head&gt;</code>.</div></div>';
    const bundle = activeDiffBundle();
    const scopeBtns = cd.diagrams.slice(0, 6).map((d) =>
      '<button class="pill-btn' + (bundle && bundle.id === d.id ? " active" : "") + '" data-diff-diag="' + esc(d.id) + '">' + esc(d.label) + (d.changedCount > 0 ? " (" + d.changedCount + ")" : "") + "</button>"
    ).join("");

    const modeSeg =
      '<span class="seg-group">' +
      '<button class="seg-btn' + (state.diffMode === "overlay" ? " active" : "") + '" data-diff-mode="overlay">Overlay Diff</button>' +
      '<button class="seg-btn' + (state.diffMode === "split" ? " active" : "") + '" data-diff-mode="split">Before → After</button>' +
      '<button class="seg-btn' + (state.diffMode === "files" ? " active" : "") + '" data-diff-mode="files">Files (' + cd.changedFiles.length + ")</button>" +
      "</span>";

    let canvasContent = "";
    if (state.diffMode === "files") {
      canvasContent =
        '<div class="canvas-shell matrix-mode" id="canvas-shell">' +
        '<table class="data-tbl"><thead><tr><th>Status</th><th>File</th><th>Unit</th><th>Lines</th><th>Blast Radius</th></tr></thead><tbody>' +
        cd.changedFiles.map((f) => {
          const bCls = f.status === "added" ? "b-pass" : f.status === "deleted" ? "b-fail" : "b-warn";
          const canCode = f.status !== "deleted" && ddIdxByPath.has(f.path);
          const pathCell = canCode
            ? '<span class="row-link mono" data-open-file-graph="' + esc(f.path) + '" title="Open symbol callstack & code">' + esc(f.path) + " →</span>"
            : '<span class="mono">' + esc(f.path) + "</span>";
          return '<tr><td><span class="badge ' + bCls + '">' + esc(f.status) + "</span></td><td>" + pathCell + '</td><td class="mono muted">' + esc(f.unitSlug) + '</td><td class="mono"><span class="status-pass">+' + f.insertions + '</span> <span class="status-fail">-' + f.deletions + '</span></td><td class="mono">' + (f.blastRadius > 0 ? f.blastRadius + " callers" : "—") + "</td></tr>";
        }).join("") +
        "</tbody></table></div>";
    } else if (state.diffMode === "split" && bundle) {
      const statusMap = new Map(bundle.overlay.nodes.map((n) => [n.id, n.diffStatus]));
      canvasContent =
        '<div class="split-diff-wrap">' +
        '<div class="split-pane"><div class="split-head"><span class="badge b-na">CURRENT STATE</span><span class="mono muted">' + esc(cd.baseRef + " @" + cd.baseSha) + "</span></div>" +
        (bundle.before ? renderDiffSvg(bundle.before, { mode: "split", split: true, statusById: statusMap }) : '<div class="muted" style="padding:24px">Not present in base revision.</div>') +
        "</div>" +
        '<div class="split-pane"><div class="split-head"><span class="badge b-pass">NEW STATE</span><span class="mono muted">' + esc(cd.headRef + " @" + cd.headSha) + "</span></div>" +
        (bundle.after ? renderDiffSvg(bundle.after, { mode: "split", split: true, statusById: statusMap }) : '<div class="muted" style="padding:24px">Removed in head revision.</div>') +
        "</div></div>";
    } else if (bundle) {
      canvasContent =
        '<div class="canvas-shell" id="canvas-shell">' +
        renderDiffSvg(bundle.overlay, { mode: "overlay" }) +
        "</div>";
    }

    const hudZoom = state.diffMode === "overlay"
      ? '<div class="hud-pill hud-bottom-left">' +
        '<button class="tbtn" data-zoom="in">+</button>' +
        '<button class="zoom-pct" id="zoom-pct" data-zoom="fit">' + Math.round(state.scale * 100) + "%</button>" +
        '<button class="tbtn" data-zoom="out">−</button>' +
        '<button class="tbtn" data-zoom="fit">Fit</button>' +
        "</div>"
      : "";
    const hudLeg = state.diffMode !== "files"
      ? '<div class="hud-pill hud-bottom-center">' +
        '<span class="leg-item"><span class="leg-swatch" style="background:#10b981"></span>Added</span>' +
        '<span class="leg-item"><span class="leg-swatch" style="background:#f59e0b"></span>Modified</span>' +
        '<span class="leg-item"><span class="leg-swatch" style="border-top:2px dashed #ef4444;height:0"></span>Removed</span>' +
        '<span class="leg-item"><span class="leg-swatch" style="background:#64748b"></span>Unchanged context</span>' +
        "</div>"
      : "";

    return (
      '<div class="workspace">' +
      '<div class="canvas-panel">' +
      '<div class="hud-pill hud-top-left"><div class="sub-toggles">' + scopeBtns + "</div></div>" +
      '<div class="hud-pill hud-top-right">' + modeSeg + '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read this architecture diff">?</button></div>' +
      renderInfoPopoverHtml() +
      hudZoom +
      hudLeg +
      canvasContent +
      "</div>" +
      '<div class="drawer" id="drawer">' + renderDiffDrawer() + "</div>" +
      "</div>"
    );
  }
`;
}
