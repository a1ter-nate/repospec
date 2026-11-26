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
      if (state.activeFileGraph || state.selectedNodeId || state.tab === "flows") render();
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
      const widths = col.items.map((it) => Math.max(194, Math.min(312, Math.max(it.label.length, (it.sublabel || "").length * 0.85) * 8.2 + 72)));
      const colW = Math.round(Math.max(196, ...widths));
      const laneW = colW + padX * 2;
      let curY = topY + padTop;
      for (const it of col.items) {
        const h = 58;
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

  function copyCurrentCodeToClipboard(btn) {
    const targetPath = btn.getAttribute("data-copy-file") || state.activeFileGraph;
    if (!FILE_SOURCES || !targetPath) return;
    const idx = ddIdxByPath.get(targetPath);
    if (idx === undefined) return;
    const raw = FILE_SOURCES[idx];
    if (typeof raw !== "string") return;
    const rangeAttr = btn.getAttribute("data-copy-code") || "";
    const parts = rangeAttr.split(":");
    let text = raw;
    if (parts.length === 2 && Number(parts[0]) > 0 && Number(parts[1]) >= Number(parts[0])) {
      text = raw.split("\\n").slice(Number(parts[0]) - 1, Number(parts[1])).join("\\n");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    btn.textContent = "✓ Copied";
    btn.style.color = "#5fd9a0";
    setTimeout(() => { btn.textContent = "Copy"; btn.style.color = ""; }, 1400);
  }

  function renderCodeBlockHtml(fileIdx, filePath, startLine, endLine, focusLine, fullFile, hasScope) {
    const fileName = filePath.split("/").pop() || filePath;
    const langChip = langChipForPath(filePath);
    const gh = githubUrl(filePath, focusLine);
    if (!FILE_SOURCES) {
      ensureFileSourcesLoaded();
      return '<div class="code-frame"><div class="code-box"><div class="muted" style="padding:14px">Decompressing source code...</div></div></div>';
    }
    const raw = FILE_SOURCES[fileIdx];
    if (typeof raw !== "string") {
      return '<div class="code-frame"><div class="code-box"><div class="muted" style="padding:14px">Source not embedded in inline compact mode. Open full <code>repospec.html</code> to inspect lines.</div></div></div>';
    }
    const allLines = raw.split("\\n");
    const fromL = fullFile ? 1 : Math.max(1, startLine - 2);
    const toL = fullFile ? allLines.length : Math.min(allLines.length, Math.max(endLine + 2, startLine + 24));
    const scopeCount = hasScope ? Math.max(1, endLine - startLine + 1) : allLines.length;
    const rangeLabel = hasScope ? "L" + startLine + "–" + endLine : allLines.length + " lines";
    const copyRange = hasScope && !fullFile ? startLine + ":" + endLine : "0:0";

    const rows = [];
    for (let ln = fromL; ln <= toL; ln += 1) {
      const text = allLines[ln - 1] ?? "";
      const isFocus = ln === focusLine;
      const outOfScope = hasScope && fullFile && (ln < startLine || ln > endLine);
      const isStart = hasScope && fullFile && ln === startLine;
      const isEnd = hasScope && fullFile && ln === endLine;
      const cls =
        "code-line" +
        (isFocus ? " focus-line" : "") +
        (outOfScope ? " dim-line" : "") +
        (isStart ? " scope-start" : "") +
        (isEnd ? " scope-end" : "");
      rows.push(
        '<div class="' + cls + '" data-code-line="' + ln + '"><span class="code-ln">' + ln + '</span><span class="code-tx">' + highlightCodeLine(text, filePath) + "</span></div>"
      );
    }

    return (
      '<div class="code-frame">' +
      '<div class="code-chrome">' +
      '<div class="code-chrome-left">' +
      '<span class="code-fname" title="' + esc(filePath) + '">' + esc(fileName) + "</span>" +
      '<span class="code-range">' + esc(rangeLabel) + "</span>" +
      '<span class="badge b-info">' + esc(langChip) + "</span>" +
      "</div>" +
      '<div class="code-chrome-right">' +
      (hasScope
        ? '<span class="seg-group">' +
          '<button class="seg-btn' + (!fullFile ? " active" : "") + '" data-code-full="0">Symbol</button>' +
          '<button class="seg-btn' + (fullFile ? " active" : "") + '" data-code-full="1">Full File</button>' +
          "</span>"
        : "") +
      '<button class="tbtn" data-copy-code="' + esc(copyRange) + '" data-copy-file="' + esc(filePath) + '" title="Copy code to clipboard">Copy</button>' +
      (gh ? '<a class="tbtn" style="text-decoration:none" href="' + esc(gh) + '" target="_blank" rel="noopener" title="Open in GitHub">GitHub ↗</a>' : "") +
      "</div></div>" +
      '<div class="code-box" id="code-viewer-box">' + rows.join("") + "</div>" +
      "</div>"
    );
  }

  function openFileCodeView(filePath, focusLine, symIdx) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return false;
    const f = DD_FILES[idx];
    const peel = ddUnitPeelPrefix(f.u);
    const logical = ddLogicalRel(f, peel);
    const parts = logical.split("/");
    const parentFolder = parts.length >= 2 ? parts.slice(0, -1).join("/") : "";
    const lineNum = Number(focusLine) || 1;
    let resolvedSym = typeof symIdx === "number" ? symIdx : -1;
    if (resolvedSym < 0 && lineNum > 1 && Array.isArray(f.m)) {
      resolvedSym = f.m.findIndex((s) => lineNum >= s[3] && lineNum <= s[4]);
    }
    state.tab = "map";
    if (parentFolder) {
      state.activeFolder = { unitSlug: f.u, folderPath: parentFolder, returnDiagId: state.activeFolder?.returnDiagId || state.activeLayerDiagId || ("modules:" + f.u) };
    }
    state.activeFileGraph = f.p;
    state.drawerCollapsed = false;
    state.focusMode = false;
    state.selectedEdgeId = null;
    state.selectedNodeId = resolvedSym >= 0 ? "sym:" + idx + ":" + resolvedSym : null;
    state.codeFocusLine = lineNum;
    state.codeFullFile = resolvedSym < 0;
    ensureFileSourcesLoaded();
    render();
    return true;
  }

  function renderFileCallGraphDrawer(filePath, diag) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return renderBriefingDrawer();
    const f = DD_FILES[idx];
    const syms = f.m || [];
    const calls = f.k || [];
    const extCalls = f.o || [];

    if (state.selectedNodeId && state.selectedNodeId.startsWith("symext:")) {
      const extName = state.selectedNodeId.slice(7);
      const extSites = extCalls.filter((o) => o[1] === extName);
      const firstLine = state.codeFocusLine && extSites.some((o) => o[2] === state.codeFocusLine)
        ? state.codeFocusLine
        : (extSites[0]?.[2] || 1);
      const sitesHtml = extSites.length > 0
        ? '<div class="sec"><div class="sec-title"><span>Called From (' + extSites.length + ')</span><span class="muted">click to jump to call line</span></div><div class="pill-row">' +
          extSites.map((o) => '<button class="tray-chip" data-jump-sym="' + idx + ":" + o[0] + ":" + o[2] + '">← ' + esc(formatSymDisplayName(syms[o[0]])) + " :" + o[2] + "</button>").join("") +
          "</div></div>"
        : "";
      const resolvedDef = resolveCrossFileSymbolTarget(idx, extName);
      const defCta = resolvedDef
        ? '<div class="pill-row"><button class="action-btn" data-jump-def="' + esc(resolvedDef.filePath + "::" + resolvedDef.symIdx + "::" + resolvedDef.line) + '">Open Definition: ' + esc(resolvedDef.label) + " →</button></div>"
        : "";
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(extName) + '</div><div class="drawer-sub">EXTERNAL CALL TARGET · ' + esc(f.p) + '</div></div><div style="display:flex;gap:6px;align-items:center"><span class="badge b-info">EXTERNAL</span><button class="tbtn" data-clear-sel="1" title="Show all symbols in file">All</button></div></div>' +
        defCta +
        sitesHtml +
        renderCodeBlockHtml(idx, f.p, Math.max(1, firstLine - 6), Math.min(f.l, firstLine + 24), firstLine, state.codeFullFile, true)
      );
    }

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
        ? '<div class="sec"><div class="sec-title"><span>Calls Down (↓ ' + (callees.length + exts.length) + ')</span><span class="muted">jump line or follow def</span></div><div class="pill-row">' +
          callees.map((c) => '<button class="tray-chip" data-jump-line="' + c[2] + '" title="Jump to call at line ' + c[2] + '">→ ' + esc(formatSymDisplayName(syms[c[1]])) + " :" + c[2] + "</button>").join("") +
          exts.map((o) => {
            const def = resolveCrossFileSymbolTarget(idx, o[1]);
            const dBtn = def ? '<button class="tray-chip" style="border-color:rgba(124,200,255,0.45);color:#7cc8ff" data-jump-def="' + esc(def.filePath + "::" + def.symIdx + "::" + def.line) + '">Def →</button>' : "";
            return '<span style="display:inline-flex;gap:3px;align-items:center"><button class="tray-chip" data-jump-line="' + o[2] + '">↗ ' + esc(o[1]) + " :" + o[2] + "</button>" + dBtn + "</span>";
          }).join("") +
          "</div></div>"
        : "";

      const callersList = callers.map((c) => ({ name: formatSymDisplayName(syms[c[0]]), line: c[2] }));
      const calleesList = callees.map((c) => ({ name: formatSymDisplayName(syms[c[1]]), line: c[2] }));
      const extsList = exts.map((o) => ({ name: o[1], line: o[2] }));

      const symMore = '<details class="more-wrap"><summary class="tbtn" title="More actions">•••</summary><div class="more-menu">' +
        '<button class="tbtn" data-open-e2e="' + esc(f.p + "::" + selSymIdx) + '">Trace E2E →</button>' +
        '<button class="tbtn" data-copy-ctx="symbol" data-copy-ctx-id="' + selSymIdx + '">Copy Agent Context</button>' +
        '<button class="tbtn" data-copy-share="1">Copy Share Link</button>' +
        '<button class="tbtn" data-ai-cfg-toggle="1">✦ Local AI Explain…</button></div></details>';
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(name) + '</div><div class="drawer-sub">' + esc((s[1] === "pub" ? "public " : "private ") + s[2] + " · " + f.p) + '</div></div><div style="display:flex;gap:4px;align-items:center"><button class="tbtn" data-clear-sel="1" title="Show whole file">File</button>' + symMore + "</div></div>" +
        (typeof renderFileFlowLaunchPills === "function" ? renderFileFlowLaunchPills(f.p, s[3], s[4]) : "") +
        renderWhatThisDoesBox(idx, f, s, callersList, calleesList, extsList) +
        renderCodeBlockHtml(idx, f.p, s[3], s[4], focusLine, state.codeFullFile, true) + callersHtml + calleesHtml
      );
    }
    const pubs = syms.map((s, si) => ({ s, si })).filter((x) => x.s[1] === "pub");
    const privs = syms.map((s, si) => ({ s, si })).filter((x) => x.s[1] === "priv");
    const symGroup = (title, list, borderCol, textCol) => list.length === 0 ? "" :
      '<div class="sec"><div class="sec-title"><span>' + title + " (" + list.length + ')</span></div><div class="pill-row">' +
      list.map((x) => '<button class="tray-chip" style="border-color:' + borderCol + ";color:" + textCol + '" data-jump-sym="' + idx + ":" + x.si + ":" + x.s[3] + '">' + esc(formatSymDisplayName(x.s)) + "</button>").join("") + "</div></div>";
    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(f.p.split("/").pop()) + '</div><div class="drawer-sub">' + esc(f.p + " · " + f.l + "L") + "</div></div></div>" +
      (typeof renderFileFlowLaunchPills === "function" ? renderFileFlowLaunchPills(f.p) : "") +
      renderWhatThisDoesBox(idx, f, null, [], [], []) +
      renderCodeBlockHtml(idx, f.p, 1, f.l, focusLine, true, false) +
      symGroup("Public", pubs, "rgba(95,217,160,0.35)", "#6ee7b0") +
      symGroup("Internal", privs, "rgba(245,194,107,0.32)", "#f5c26b")
    );
  }
`;
}
