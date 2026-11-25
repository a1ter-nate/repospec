export function renderFileCallGraphClientScript(): string {
  return `
  let FILE_SOURCES = null;
  let fileSourcesPromise = null;

  function ensureFileSourcesLoaded() {
    if (FILE_SOURCES) return Promise.resolve(FILE_SOURCES);
    if (fileSourcesPromise) return fileSourcesPromise;
    const el = document.getElementById("repospec-src");
    if (!el || !el.textContent || typeof DecompressionStream === "undefined") {
      FILE_SOURCES = [];
      return Promise.resolve(FILE_SOURCES);
    }
    const b64 = el.textContent.trim();
    fileSourcesPromise = (async () => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const ds = new DecompressionStream("gzip");
      const stream = new Response(bytes).body.pipeThrough(ds);
      const text = await new Response(stream).text();
      FILE_SOURCES = JSON.parse(text);
      if (state.activeFileGraph) render();
      return FILE_SOURCES;
    })().catch(() => {
      FILE_SOURCES = [];
      return FILE_SOURCES;
    });
    return fileSourcesPromise;
  }

  function formatSymDisplayName(s) {
    return s[5] ? s[5] + "." + s[0] : s[0];
  }

  function buildFileCallGraphDiagram(filePath) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return null;
    const f = DD_FILES[idx];
    const syms = f.m || [];
    const calls = f.k || [];
    const extCalls = f.o || [];

    const outAdj = new Map();
    const inAdj = new Map();
    for (const c of calls) {
      const oArr = outAdj.get(c[0]) || [];
      oArr.push({ to: c[1], line: c[2] });
      outAdj.set(c[0], oArr);
      const iArr = inAdj.get(c[1]) || [];
      iArr.push({ from: c[0], line: c[2] });
      inAdj.set(c[1], iArr);
    }

    const depthByIdx = new Map();
    const queue = [];
    syms.forEach((s, si) => {
      if (s[1] === "pub") {
        depthByIdx.set(si, 0);
        queue.push(si);
      }
    });
    while (queue.length > 0) {
      const cur = queue.shift();
      const curD = depthByIdx.get(cur) || 0;
      for (const edge of outAdj.get(cur) || []) {
        const tgt = syms[edge.to];
        if (!tgt || tgt[1] === "pub") continue;
        const nextD = Math.min(3, curD + 1);
        if (!depthByIdx.has(edge.to) || nextD < depthByIdx.get(edge.to)) {
          depthByIdx.set(edge.to, nextD);
          queue.push(edge.to);
        }
      }
    }

    const pubIdxs = [];
    const privCols = new Map();
    syms.forEach((s, si) => {
      if (s[1] === "pub") {
        pubIdxs.push(si);
      } else {
        const d = depthByIdx.has(si) ? depthByIdx.get(si) : 1;
        const arr = privCols.get(d) || [];
        arr.push(si);
        privCols.set(d, arr);
      }
    });

    const extMap = new Map();
    for (const oc of extCalls) {
      const label = oc[1];
      const cur = extMap.get(label) || { label, callers: new Set(), firstLine: oc[2] };
      cur.callers.add(oc[0]);
      extMap.set(label, cur);
    }
    const keptExts = Array.from(extMap.values())
      .sort((a, b) => b.callers.size - a.callers.size || a.label.localeCompare(b.label))
      .slice(0, 14);

    const cols = [];
    if (pubIdxs.length > 0) {
      cols.push({
        id: "sym_pub",
        label: "Public Surface (" + pubIdxs.length + ")",
        items: pubIdxs.map((si) => {
          const s = syms[si];
          return {
            id: "sym:" + idx + ":" + si,
            label: formatSymDisplayName(s),
            sublabel: s[2] + " · :" + s[3],
            kind: "sym_pub",
            shape: "box",
            symIdx: si,
            provenance: { file: f.p, line: s[3] },
          };
        }),
      });
    }

    const sortedPrivDepths = Array.from(privCols.keys()).sort((a, b) => a - b);
    for (const d of sortedPrivDepths) {
      const arr = privCols.get(d) || [];
      if (arr.length === 0) continue;
      cols.push({
        id: "sym_priv_" + d,
        label: sortedPrivDepths.length === 1 ? "Private Surface (" + arr.length + ")" : "Private · Depth " + d + " (" + arr.length + ")",
        items: arr.map((si) => {
          const s = syms[si];
          return {
            id: "sym:" + idx + ":" + si,
            label: formatSymDisplayName(s),
            sublabel: "private " + s[2] + " · :" + s[3],
            kind: "sym_priv",
            shape: "box",
            symIdx: si,
            provenance: { file: f.p, line: s[3] },
          };
        }),
      });
    }

    if (keptExts.length > 0) {
      cols.push({
        id: "sym_ext",
        label: "Calls Out To (" + keptExts.length + ")",
        items: keptExts.map((ex) => ({
          id: "symext:" + ex.label,
          label: ex.label,
          sublabel: ex.callers.size + " call" + (ex.callers.size === 1 ? "" : "s"),
          kind: "external_service",
          shape: "pill",
          provenance: { file: f.p, line: ex.firstLine },
        })),
      });
    }

    if (cols.length === 0) {
      cols.push({
        id: "sym_empty",
        label: "File Surface (0 functions)",
        items: [{
          id: "sym:" + idx + ":0",
          label: f.p.split("/").pop(),
          sublabel: f.l + " lines · click to inspect source",
          kind: "file",
          shape: "box",
          provenance: { file: f.p, line: 1 },
        }],
      });
    }

    const marginX = 28;
    const topY = 48;
    const laneGap = 86;
    const nodeGapY = 16;
    const padX = 16;
    const padTop = 34;
    const padBottom = 18;
    let curX = marginX;
    let maxBottom = topY + 180;
    const layoutNodes = [];
    const posById = new Map();
    const lanes = [];
    const laneIdxById = new Map();

    cols.forEach((col, ci) => {
      laneIdxById.set(col.id, ci);
      const widths = col.items.map((it) => Math.max(176, Math.min(290, Math.max(it.label.length, (it.sublabel || "").length * 0.85) * 7.4 + 62)));
      const colW = Math.round(Math.max(182, ...widths));
      const laneW = colW + padX * 2;
      let curY = topY + padTop;
      for (const it of col.items) {
        const h = 52;
        const ln = {
          id: it.id,
          label: it.label,
          sublabel: it.sublabel,
          lane: col.id,
          layerRank: ci,
          kind: it.kind,
          role: "symbol",
          domain: "arch",
          shape: it.shape,
          expandable: false,
          x: Math.round((curX + padX + colW / 2) * 10) / 10,
          y: Math.round((curY + h / 2) * 10) / 10,
          w: colW,
          h,
          provenance: it.provenance,
          symIdx: it.symIdx,
        };
        layoutNodes.push(ln);
        posById.set(ln.id, ln);
        curY += h + nodeGapY;
      }
      const laneH = Math.max(120, curY - nodeGapY + padBottom - topY);
      lanes.push({ id: col.id, label: col.label, x: curX, y: topY, w: laneW, h: laneH });
      if (topY + laneH > maxBottom) maxBottom = topY + laneH;
      curX += laneW + laneGap;
    });
    for (const l of lanes) l.h = maxBottom - topY;

    const layoutEdges = [];
    let eSeq = 0;
    const routeEdge = (fromId, toId, callLine, kind) => {
      const a = posById.get(fromId);
      const b = posById.get(toId);
      if (!a || !b) return;
      const la = laneIdxById.get(a.lane) ?? 0;
      const lb = laneIdxById.get(b.lane) ?? 0;
      const pts = [];
      if (lb > la) {
        const sx = a.x + a.w / 2;
        const tx = b.x - b.w / 2;
        const dx = Math.max(24, (tx - sx) * 0.45);
        pts.push({ x: sx, y: a.y }, { x: sx + dx, y: a.y }, { x: tx - dx, y: b.y }, { x: tx, y: b.y });
      } else if (lb < la) {
        const sx = a.x - a.w / 2;
        const tx = b.x + b.w / 2;
        const dx = Math.max(24, (sx - tx) * 0.45);
        pts.push({ x: sx, y: a.y }, { x: sx - dx, y: a.y }, { x: tx + dx, y: b.y }, { x: tx, y: b.y });
      } else {
        const rx = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 18 + (eSeq % 3) * 6;
        pts.push({ x: a.x + a.w / 2, y: a.y }, { x: rx, y: a.y }, { x: rx, y: b.y }, { x: b.x + b.w / 2, y: b.y });
      }
      layoutEdges.push({
        id: "syme:" + eSeq,
        from: fromId,
        to: toId,
        kind,
        tier: "spine",
        label: ":" + callLine,
        weight: 1,
        callLine,
        confidence: "observed",
        evidence: [{ file: f.p, line: callLine, detail: a.label + " calls " + b.label + " at line " + callLine }],
        points: pts,
      });
      eSeq += 1;
    };

    for (const c of calls) {
      routeEdge("sym:" + idx + ":" + c[0], "sym:" + idx + ":" + c[1], c[2], "calls");
    }
    const keptExtSet = new Set(keptExts.map((x) => x.label));
    for (const oc of extCalls) {
      if (!keptExtSet.has(oc[1])) continue;
      routeEdge("sym:" + idx + ":" + oc[0], "symext:" + oc[1], oc[2], "calls_external");
    }

    return {
      id: "filegraph:" + filePath,
      title: f.p.split("/").pop() + " — Symbol Callstack",
      subtitle: pubIdxs.length + " public · " + (syms.length - pubIdxs.length) + " private · " + calls.length + " internal calls",
      category: "filegraph",
      filePath,
      fileIdx: idx,
      rankdir: "LR",
      width: Math.max(520, curX - laneGap + marginX),
      height: Math.max(260, maxBottom + 44),
      lanes,
      nodes: layoutNodes,
      edges: layoutEdges,
    };
  }

  function renderCodeBlockHtml(fileIdx, startLine, endLine, focusLine, fullFile) {
    if (!FILE_SOURCES) {
      ensureFileSourcesLoaded();
      return '<div class="code-box"><div class="muted" style="padding:10px">Decompressing source code...</div></div>';
    }
    const raw = FILE_SOURCES[fileIdx];
    if (typeof raw !== "string") {
      return '<div class="code-box"><div class="muted" style="padding:10px">Source not embedded in inline compact mode. Open full <code>repospec.html</code> to inspect lines.</div></div>';
    }
    const allLines = raw.split("\\n");
    const fromL = fullFile ? 1 : Math.max(1, startLine - 2);
    const toL = fullFile ? allLines.length : Math.min(allLines.length, Math.max(endLine + 2, startLine + 24));
    const rows = [];
    for (let ln = fromL; ln <= toL; ln += 1) {
      const text = allLines[ln - 1] ?? "";
      const isFocus = ln === focusLine;
      const inSpan = !fullFile || (ln >= startLine && ln <= endLine);
      const cls = "code-line" + (isFocus ? " focus-line" : inSpan && startLine > 0 ? " span-line" : "");
      rows.push(
        '<div class="' + cls + '" data-code-line="' + ln + '"><span class="code-ln">' + ln + '</span><span class="code-tx">' + esc(text || " ") + "</span></div>"
      );
    }
    return '<div class="code-box" id="code-viewer-box">' + rows.join("") + "</div>";
  }

  function renderFileCallGraphDrawer(filePath, diag) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return renderBriefingDrawer();
    const f = DD_FILES[idx];
    const syms = f.m || [];
    const calls = f.k || [];
    const extCalls = f.o || [];

    let selSymIdx = -1;
    let focusLine = state.codeFocusLine || 1;
    if (state.selectedEdgeId && diag) {
      const edge = diag.edges.find((e) => e.id === state.selectedEdgeId);
      if (edge && edge.from.startsWith("sym:")) {
        selSymIdx = Number(edge.from.split(":").pop());
        focusLine = edge.callLine || focusLine;
      }
    } else if (state.selectedNodeId && state.selectedNodeId.startsWith("sym:")) {
      selSymIdx = Number(state.selectedNodeId.split(":").pop());
    }

    if (selSymIdx >= 0 && syms[selSymIdx]) {
      const s = syms[selSymIdx];
      const name = formatSymDisplayName(s);
      if (!state.codeFocusLine || state.codeFocusLine < s[3] || state.codeFocusLine > s[4]) {
        focusLine = s[3];
      }
      const callers = calls.filter((c) => c[1] === selSymIdx);
      const callees = calls.filter((c) => c[0] === selSymIdx);
      const exts = extCalls.filter((o) => o[0] === selSymIdx);

      const callersHtml = callers.length > 0
        ? '<div class="sec"><div class="sec-title"><span>Called By (↑ ' + callers.length + ')</span></div><div class="pill-row">' +
          callers.map((c) => '<button class="tray-chip" data-jump-sym="' + idx + ":" + c[0] + ":" + c[2] + '">← ' + esc(formatSymDisplayName(syms[c[0]])) + " :" + c[2] + "</button>").join("") +
          "</div></div>"
        : "";
      const calleesHtml = (callees.length > 0 || exts.length > 0)
        ? '<div class="sec"><div class="sec-title"><span>Calls Down (↓ ' + (callees.length + exts.length) + ')</span><span class="muted">click to jump to line</span></div><div class="pill-row">' +
          callees.map((c) => '<button class="tray-chip" data-jump-line="' + c[2] + '" title="Jump to call at line ' + c[2] + ' (or click node on canvas)">→ ' + esc(formatSymDisplayName(syms[c[1]])) + " :" + c[2] + "</button>").join("") +
          exts.map((o) => '<button class="tray-chip" data-jump-line="' + o[2] + '">↗ ' + esc(o[1]) + " :" + o[2] + "</button>").join("") +
          "</div></div>"
        : "";

      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(name) + '</div><div class="drawer-sub">' + esc((s[1] === "pub" ? "PUBLIC " : "PRIVATE ") + s[2] + " · lines " + s[3] + "–" + s[4]) + '</div></div><span class="badge ' + (s[1] === "pub" ? "b-pass" : "b-warn") + '">' + (s[1] === "pub" ? "PUBLIC" : "PRIVATE") + "</span></div>" +
        provenanceLinksHtml(f.p, focusLine) +
        '<div class="links-row">' +
        '<span class="seg-group">' +
        '<button class="seg-btn' + (!state.codeFullFile ? " active" : "") + '" data-code-full="0">Symbol Lines</button>' +
        '<button class="seg-btn' + (state.codeFullFile ? " active" : "") + '" data-code-full="1">Full File (' + f.l + "L)</button>" +
        "</span>" +
        '<button class="action-btn sec-btn" data-clear-sel="1">All Symbols</button>' +
        "</div>" +
        callersHtml +
        calleesHtml +
        '<div class="sec"><div class="sec-title"><span>Source Code</span><span class="mono muted">line ' + focusLine + "</span></div>" +
        renderCodeBlockHtml(idx, s[3], s[4], focusLine, state.codeFullFile) +
        "</div>"
      );
    }

    const pubs = syms.map((s, si) => ({ s, si })).filter((x) => x.s[1] === "pub");
    const privs = syms.map((s, si) => ({ s, si })).filter((x) => x.s[1] === "priv");
    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(f.p.split("/").pop()) + '</div><div class="drawer-sub">' + esc(f.p + " · " + f.l + "L") + "</div></div></div>" +
      provenanceLinksHtml(f.p, 1) +
      '<div class="story-box"><strong>Name-only Symbol Callstack:</strong> ' + pubs.length + " public surface" + (pubs.length === 1 ? "" : "s") + " calling down into " + privs.length + " private helper" + (privs.length === 1 ? "" : "s") + " (" + calls.length + " intra-file calls). Click any name or arrow to view the exact lines of code.</div>" +
      '<div class="sec"><div class="sec-title"><span>Public Surface (' + pubs.length + ')</span><span class="muted">click for code</span></div>' +
      (pubs.length === 0 ? '<div class="muted">No exported functions/methods detected.</div>' : '<div class="pill-row">' + pubs.map((x) => '<button class="tray-chip" data-jump-sym="' + idx + ":" + x.si + ":" + x.s[3] + '">' + esc(formatSymDisplayName(x.s)) + "</button>").join("") + "</div>") +
      "</div>" +
      '<div class="sec"><div class="sec-title"><span>Private / Internal Surface (' + privs.length + ')</span><span class="muted">click for code</span></div>' +
      (privs.length === 0 ? '<div class="muted">No private helpers detected.</div>' : '<div class="pill-row">' + privs.map((x) => '<button class="tray-chip" data-jump-sym="' + idx + ":" + x.si + ":" + x.s[3] + '">' + esc(formatSymDisplayName(x.s)) + "</button>").join("") + "</div>") +
      "</div>" +
      '<div class="sec"><div class="sec-title"><span>Full File Source (' + f.l + ' lines)</span></div>' +
      renderCodeBlockHtml(idx, 1, Math.min(f.l, 120), 1, true) +
      "</div>"
    );
  }
`;
}
