export function renderSvgClientScript(): string {
  return `
  function nodeVisualTone(n) {
    if (n.kind === "sym_pub") return { bg: "rgba(16,185,129,0.18)", stroke: "#34d399", glyph: "app" };
    if (n.kind === "sym_priv") return { bg: "rgba(245,158,11,0.14)", stroke: "#fbbf24", glyph: "file" };
    if (n.kind === "datastore" || n.shape === "db") return { bg: "rgba(139,92,246,0.16)", stroke: "#a78bfa", glyph: "db" };
    if (n.kind === "external_service") return { bg: "rgba(6,182,212,0.16)", stroke: "#22d3ee", glyph: "ext" };
    if (n.kind === "folder" || n.kind === "code_layer" || (n.kind === "module" && n.label.endsWith("/"))) {
      return { bg: "rgba(245,158,11,0.15)", stroke: "#fbbf24", glyph: "folder" };
    }
    if (n.kind === "file" || n.kind === "module") return { bg: "rgba(56,189,248,0.14)", stroke: "#38bdf8", glyph: "file" };
    if (n.kind === "package" || n.kind === "analyzer" || n.shape === "hex") return { bg: "rgba(16,185,129,0.15)", stroke: "#34d399", glyph: "pkg" };
    return { bg: "rgba(99,102,241,0.18)", stroke: "#818cf8", glyph: "app" };
  }

  function renderGlyphPath(glyph, cx, cy, col) {
    if (glyph === "folder") {
      return '<path d="M ' + (cx - 6) + " " + (cy - 4) + ' h 4.5 l 1.5 1.8 h 6 v 6.2 h -12 z" fill="none" stroke="' + col + '" stroke-width="1.4" stroke-linejoin="round" />';
    }
    if (glyph === "db") {
      return '<ellipse cx="' + cx + '" cy="' + (cy - 3.5) + '" rx="5.5" ry="2.2" fill="none" stroke="' + col + '" stroke-width="1.3" /><path d="M ' + (cx - 5.5) + " " + (cy - 3.5) + ' v 7 a 5.5 2.2 0 0 0 11 0 v -7" fill="none" stroke="' + col + '" stroke-width="1.3" />';
    }
    if (glyph === "ext") {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="5.5" fill="none" stroke="' + col + '" stroke-width="1.3" /><path d="M ' + (cx - 5.2) + " " + cy + " h 10.4 M " + cx + " " + (cy - 5.5) + ' a 2.8 5.5 0 0 1 0 11 a 2.8 5.5 0 0 1 0 -11" fill="none" stroke="' + col + '" stroke-width="1.1" />';
    }
    if (glyph === "file") {
      return '<path d="M ' + (cx - 4.5) + " " + (cy - 5.5) + ' h 6 l 3 3 v 8 h -9 z" fill="none" stroke="' + col + '" stroke-width="1.3" stroke-linejoin="round" />';
    }
    if (glyph === "pkg") {
      return '<polygon points="' + cx + "," + (cy - 6) + " " + (cx + 5.5) + "," + (cy - 3) + " " + (cx + 5.5) + "," + (cy + 3) + " " + cx + "," + (cy + 6) + " " + (cx - 5.5) + "," + (cy + 3) + " " + (cx - 5.5) + "," + (cy - 3) + '" fill="none" stroke="' + col + '" stroke-width="1.3" />';
    }
    return '<rect x="' + (cx - 5) + '" y="' + (cy - 5) + '" width="10" height="10" rx="2.2" fill="none" stroke="' + col + '" stroke-width="1.4" />';
  }

  function renderShapeSvg(n, strokeColor, hasErr, hasWarn) {
    const x = n.x - n.w / 2;
    const y = n.y - n.h / 2;
    const rx = n.shape === "pill" ? 16 : 10;
    const fill = "#141a29";
    const shadow = '<rect x="' + (x + 1) + '" y="' + (y + 3) + '" width="' + n.w + '" height="' + n.h + '" rx="' + rx + '" fill="rgba(0,0,0,0.28)" />';
    const ghost = n.expandable
      ? '<rect x="' + (x + 5) + '" y="' + (y + 4) + '" width="' + (n.w - 10) + '" height="' + n.h + '" rx="' + rx + '" fill="#0d121e" stroke="rgba(255,255,255,0.1)" stroke-width="1" />'
      : "";
    const topAccent = hasErr
      ? '<line x1="' + (x + 10) + '" y1="' + (y + 1) + '" x2="' + (x + n.w - 10) + '" y2="' + (y + 1) + '" stroke="#ef4444" stroke-width="2" stroke-linecap="round" />'
      : hasWarn
        ? '<line x1="' + (x + 10) + '" y1="' + (y + 1) + '" x2="' + (x + n.w - 10) + '" y2="' + (y + 1) + '" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" />'
        : '<line x1="' + (x + 10) + '" y1="' + (y + 1) + '" x2="' + (x + n.w - 10) + '" y2="' + (y + 1) + '" stroke="rgba(255,255,255,0.11)" stroke-width="1" />';
    const ports =
      '<circle class="port-dot" cx="' + x + '" cy="' + n.y + '" r="3.4" fill="#080b12" stroke="#818cf8" stroke-width="1.5" />' +
      '<circle class="port-dot" cx="' + (x + n.w) + '" cy="' + n.y + '" r="3.4" fill="#080b12" stroke="#818cf8" stroke-width="1.5" />';
    return (
      shadow +
      ghost +
      '<rect class="node-shape" x="' + x + '" y="' + y + '" width="' + n.w + '" height="' + n.h + '" rx="' + rx + '" fill="' + fill + '" stroke="' + strokeColor + '" stroke-width="1.15" />' +
      topAccent +
      ports
    );
  }

  function buildRoundedPolylinePath(pts) {
    let d = "M " + pts[0].x + " " + pts[0].y;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      const dx1 = cur.x - prev.x;
      const dy1 = cur.y - prev.y;
      const dx2 = next.x - cur.x;
      const dy2 = next.y - cur.y;
      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      const r = Math.min(10, len1 / 2, len2 / 2);
      if (r < 1) {
        d += " L " + cur.x + " " + cur.y;
      } else {
        const p1x = (cur.x - (dx1 / len1) * r).toFixed(1);
        const p1y = (cur.y - (dy1 / len1) * r).toFixed(1);
        const p2x = (cur.x + (dx2 / len2) * r).toFixed(1);
        const p2y = (cur.y + (dy2 / len2) * r).toFixed(1);
        d += " L " + p1x + " " + p1y + " Q " + cur.x + " " + cur.y + " " + p2x + " " + p2y;
      }
    }
    const last = pts[pts.length - 1];
    d += " L " + last.x + " " + last.y;
    return d;
  }

  function renderDiagramSvg(diag) {
    const activeTrace = state.activeTraceId ? DATA.traces.find((t) => t.id === state.activeTraceId && t.diagramId === diag.id) : null;
    const traceNodeSet = new Set(activeTrace ? activeTrace.steps.map((s) => s.nodeId) : []);
    const traceEdgeSet = new Set(activeTrace ? activeTrace.steps.map((s) => s.edgeId).filter(Boolean) : []);
    const traceOrder = new Map(activeTrace ? activeTrace.steps.map((s, i) => [s.nodeId, i + 1]) : []);

    const neighborNodes = new Set();
    const neighborEdges = new Set();
    if (state.selectedNodeId) {
      neighborNodes.add(state.selectedNodeId);
      for (const e of diag.edges) {
        if (e.from === state.selectedNodeId || e.to === state.selectedNodeId) {
          neighborEdges.add(e.id);
          neighborNodes.add(e.from);
          neighborNodes.add(e.to);
        }
      }
    } else if (state.selectedEdgeId) {
      const e = diag.edges.find((x) => x.id === state.selectedEdgeId);
      if (e) {
        neighborEdges.add(e.id);
        neighborNodes.add(e.from);
        neighborNodes.add(e.to);
      }
    }
    const hasFilter = Boolean(state.selectedNodeId || state.selectedEdgeId || activeTrace);

    const laneCounts = new Map();
    for (const n of diag.nodes) {
      if (n.lane) laneCounts.set(n.lane, (laneCounts.get(n.lane) || 0) + 1);
    }
    const lanesSvg = (diag.lanes || []).map((l) => {
      const fill = l.lateral ? "rgba(99,102,241,0.035)" : "rgba(148,163,184,0.024)";
      const cnt = laneCounts.get(l.id) || 0;
      const hasCountInLabel = l.label.includes("(");
      const cntSvg = cnt > 0 && !hasCountInLabel
        ? '<text x="' + (l.x + l.w - 12) + '" y="' + (l.y + 19) + '" text-anchor="end" font-size="9.5" font-weight="600" fill="#475569" font-family="ui-monospace, monospace">' + cnt + "</text>"
        : "";
      return (
        '<g class="lane">' +
        '<rect x="' + l.x + '" y="' + l.y + '" width="' + l.w + '" height="' + l.h + '" rx="12" fill="' + fill + '" stroke="rgba(255,255,255,0.09)" stroke-width="1" stroke-dasharray="4 4" />' +
        '<text x="' + (l.x + 12) + '" y="' + (l.y + 19) + '" font-size="9.5" font-weight="700" fill="#64748b" letter-spacing="0.08em">' + esc(l.label.toUpperCase()) + "</text>" +
        cntSvg +
        "</g>"
      );
    }).join("");

    const edgesSvg = diag.edges.map((e) => {
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
        for (let i = 1; i < e.points.length; i += 1) {
          d += " L " + e.points[i].x + " " + e.points[i].y;
        }
      }
      const isSelected = state.selectedEdgeId === e.id;
      const isTrace = traceEdgeSet.has(e.id);
      const isNeighbor = neighborEdges.has(e.id);
      const hideDetail = !state.showAllEdges && e.tier === "detail" && !e.violation && !isSelected && !isNeighbor && !isTrace;
      const dimmed = hasFilter && !(isTrace || isNeighbor);
      const isOutSel = state.selectedNodeId && e.from === state.selectedNodeId;
      const isInSel = state.selectedNodeId && e.to === state.selectedNodeId;
      const stroke = isTrace ? "#818cf8" : e.violation ? "#ef4444" : isOutSel ? "#38bdf8" : isInSel ? "#34d399" : "rgba(148,163,184,0.34)";
      const dash = e.confidence === "inferred" ? ' stroke-dasharray="4 4"' : "";
      const sw = e.violation ? 2.1 : isOutSel || isInSel ? 2.0 : (e.weight || 1) >= 25 ? 1.9 : (e.weight || 1) >= 5 ? 1.5 : 1.15;
      const markerEnd = isTrace ? "url(#m-blue)" : e.violation ? "url(#m-red)" : isOutSel ? "url(#m-cyan)" : isInSel ? "url(#m-green)" : "url(#m-neutral)";
      const markerStart = e.bidirectional ? (e.violation ? "url(#m-red-s)" : "url(#m-neutral-s)") : "";
      const alwaysShowPill = diag.category === "behavior" || e.bidirectional || e.violation;
      const mid = e.points.length === 4
        ? { x: (e.points[1].x + e.points[2].x) / 2, y: (e.points[1].y + e.points[2].y) / 2 }
        : e.points[Math.floor(e.points.length / 2)];
      const pillText = e.label || (e.weight && e.weight > 1 ? String(e.weight) : "");
      const pw = Math.max(20, pillText.length * 6.4 + 10);
      const pillHtml = pillText
        ? '<g class="edge-pill"><rect x="' + (mid.x - pw / 2).toFixed(1) + '" y="' + (mid.y - 8).toFixed(1) + '" width="' + pw.toFixed(1) + '" height="16" rx="8" fill="#080b12" stroke="' + (e.violation ? "#ef4444" : "rgba(148,163,184,0.35)") + '" stroke-width="1" />' +
          '<text x="' + mid.x.toFixed(1) + '" y="' + (mid.y + 3.2).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="' + (e.violation ? "#fca5a5" : "#e2e8f0") + '" font-family="ui-monospace, monospace">' + esc(pillText) + "</text></g>"
        : "";
      const cls =
        "svg-edge-group" +
        (isSelected ? " selected" : "") +
        (dimmed ? " dimmed" : "") +
        (alwaysShowPill ? " show-pill" : "") +
        (hideDetail ? " edge-detail-hidden" : "");
      return (
        '<g class="' + cls + '" data-edge="' + esc(e.id) + '" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" data-viol="' + (e.violation ? "1" : "0") + '">' +
        '<path class="svg-edge-hit" d="' + d + '" />' +
        '<path class="edge-glow" d="' + d + '" fill="none" stroke="' + (e.violation ? "#ef4444" : "#818cf8") + '" stroke-width="6" />' +
        '<path class="svg-edge-vis" d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + ' marker-end="' + markerEnd + '"' + (markerStart ? ' marker-start="' + markerStart + '"' : "") + " />" +
        pillHtml +
        "</g>"
      );
    }).join("");

    const nodesSvg = diag.nodes.map((n) => {
      const isSel = state.selectedNodeId === n.id;
      const isTrace = traceNodeSet.has(n.id);
      const dimmed = hasFilter && !(isTrace || neighborNodes.has(n.id));
      const hue = statusHue(n.findings, false);
      const isTangle = Boolean(n.ambientBadges && n.ambientBadges.includes("tangle"));
      const hasError = (n.findings || []).some((f) => f.severity === "error") || isTangle;
      const hasWarn = !hasError && (n.findings || []).some((f) => f.severity === "warn");
      const stroke = isSel || isTrace ? "#818cf8" : hasError ? "rgba(239,68,68,0.62)" : hasWarn ? "rgba(245,158,11,0.55)" : "rgba(255,255,255,0.13)";
      const cls = "svg-node" + (isSel ? " selected" : "") + (dimmed ? " dimmed" : "");
      const tone = nodeVisualTone(n);
      const leftX = n.x - n.w / 2;
      const topY = n.y - n.h / 2;
      const iconX = leftX + 10;
      const iconY = n.y - 12;
      const textX = leftX + 42;
      const maxChars = Math.max(10, Math.floor((n.w - (n.expandable ? 64 : 52)) / 6.9));
      const titleStr = n.label.length > maxChars ? n.label.slice(0, maxChars - 1) + "…" : n.label;
      const cleanSub = (n.sublabel || "").replace(new RegExp("⊞\\\\s*", "g"), "").replace(new RegExp("\\\\s*·\\\\s*$"), "").trim();
      const subText = n.ambientBadges && n.ambientBadges.length > 0
        ? cleanSub + " · " + n.ambientBadges[0]
        : cleanSub;
      const subMax = Math.max(12, Math.floor((n.w - 56) / 5.7));
      const subStr = subText.length > subMax ? subText.slice(0, subMax - 1) + "…" : subText;
      const iconTileSvg =
        '<rect x="' + iconX + '" y="' + iconY + '" width="24" height="24" rx="6" fill="' + tone.bg + '" />' +
        renderGlyphPath(tone.glyph, iconX + 12, iconY + 12, tone.stroke);
      const drillChev = n.expandable
        ? '<path class="drill-chev" d="M ' + (leftX + n.w - 15) + " " + (n.y - 4) + ' l 4 4 l -4 4" fill="none" stroke="#64748b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />'
        : "";
      const totalFindings = (n.findings || []).reduce((s, f) => s + f.count, 0);
      const dotColor = hasError ? "#ef4444" : hasWarn ? "#f59e0b" : hue;
      const statusDot = dotColor
        ? '<circle cx="' + (leftX + n.w - 12) + '" cy="' + (topY + 11) + '" r="3.5" fill="' + dotColor + '" />'
        : "";
      const stepNum = traceOrder.get(n.id);
      const traceBadge = stepNum
        ? '<circle cx="' + (leftX + 5) + '" cy="' + (topY + 5) + '" r="8.5" fill="#4f46e5" />' +
          '<text x="' + (leftX + 5) + '" y="' + (topY + 8.3) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">' + stepNum + "</text>"
        : "";
      const findingPill = totalFindings > 0
        ? '<circle cx="' + (leftX + n.w - 5) + '" cy="' + (topY + 5) + '" r="8.5" fill="' + (hasError ? "#ef4444" : "#f59e0b") + '" />' +
          '<text x="' + (leftX + n.w - 5) + '" y="' + (topY + 8.3) + '" text-anchor="middle" font-size="8.5" font-weight="700" fill="#ffffff">' + (totalFindings > 99 ? "99+" : totalFindings) + "</text>"
        : statusDot;
      const nodeTip = n.label + (cleanSub ? " — " + cleanSub : "") + (n.expandable ? " (Double-click or press Enter to drill in)" : "") + (totalFindings > 0 ? " · " + totalFindings + " active finding" + (totalFindings === 1 ? "" : "s") : "");
      return (
        '<g class="' + cls + '" tabindex="0" role="button" aria-label="' + esc(n.label) + '" data-node="' + esc(n.id) + '">' +
        "<title>" + esc(nodeTip) + "</title>" +
        renderShapeSvg(n, stroke, hasError, hasWarn) +
        iconTileSvg +
        '<text x="' + textX + '" y="' + (n.y - (subStr ? 4 : -4)) + '" text-anchor="start" font-size="11.5" font-weight="600" fill="#f8fafc" font-family="ui-sans-serif, system-ui, sans-serif">' + esc(titleStr) + "</text>" +
        (subStr ? '<text x="' + textX + '" y="' + (n.y + 12) + '" text-anchor="start" font-size="9.5" fill="#94a3b8" font-family="ui-monospace, monospace">' + esc(subStr) + "</text>" : "") +
        drillChev +
        findingPill +
        traceBadge +
        "</g>"
      );
    }).join("");

    const hasMinimap = !INLINE && diag.nodes.length >= 10;
    const vbX = -68;
    const vbY = -66;
    const vbW = diag.width + (hasMinimap ? 136 : 104);
    const vbH = diag.height + (hasMinimap ? 152 : 132);
    const animCls = state.justNavigated ? ' class="canvas-anim"' : "";
    return (
      '<svg id="diagram-svg"' + animCls + ' viewBox="' + vbX + " " + vbY + " " + vbW + " " + vbH + '" preserveAspectRatio="xMidYMid meet">' +
      "<defs>" +
      '<marker id="m-neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="rgba(148,163,184,0.6)" /></marker>' +
      '<marker id="m-neutral-s" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 8.5 2 L 0 5 L 8.5 8 z" fill="rgba(148,163,184,0.6)" /></marker>' +
      '<marker id="m-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="#ef4444" /></marker>' +
      '<marker id="m-red-s" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M 8.5 2 L 0 5 L 8.5 8 z" fill="#ef4444" /></marker>' +
      '<marker id="m-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="#818cf8" /></marker>' +
      '<marker id="m-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="#38bdf8" /></marker>' +
      '<marker id="m-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 2 L 8.5 5 L 0 8 z" fill="#34d399" /></marker>' +
      "</defs>" +
      '<g id="viewport-g" transform="translate(' + state.tx + "," + state.ty + ") scale(" + state.scale + ')">' +
      lanesSvg +
      edgesSvg +
      nodesSvg +
      "</g></svg>"
    );
  }

  function renderMinimapHtml(diag) {
    if (INLINE || !diag || diag.nodes.length < 10) return "";
    const rects = diag.nodes.map((n) => {
      const col = state.selectedNodeId === n.id ? "#818cf8" : (n.findings && n.findings.length > 0 ? "#ef4444" : "rgba(148,163,184,0.48)");
      return '<rect x="' + (n.x - n.w / 2).toFixed(0) + '" y="' + (n.y - n.h / 2).toFixed(0) + '" width="' + n.w.toFixed(0) + '" height="' + n.h.toFixed(0) + '" rx="3" fill="' + col + '" />';
    }).join("");
    const vpBox = '<rect id="minimap-vp" x="-68" y="-66" width="' + (diag.width + 104) + '" height="' + (diag.height + 132) + '" rx="6" fill="rgba(99,102,241,0.12)" stroke="#818cf8" stroke-width="6" />';
    return (
      '<div class="hud-minimap" id="hud-minimap" title="Click or drag to pan">' +
      '<svg id="minimap-svg" viewBox="-68 -66 ' + (diag.width + 104) + " " + (diag.height + 132) + '" preserveAspectRatio="xMidYMid meet">' +
      rects +
      vpBox +
      "</svg></div>"
    );
  }
`;
}
