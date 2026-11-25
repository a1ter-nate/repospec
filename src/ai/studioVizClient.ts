export function renderStudioVizClientScript(): string {
  return `
  const prAiCache = new Map();
  const prAiPending = new Set();
  const prAiErrors = new Map();

  function computeNodeLensStyle(node) {
    if (!state.canvasLens || state.canvasLens === "default") return null;
    let tested = 0;
    let total = 0;
    let churnSum = 0;
    let maxChurn = 0;
    if (node.id.startsWith("file:")) {
      const fi = ddIdxByPath.get(node.id.slice(5));
      if (fi !== undefined) {
        total = 1;
        tested = DD_FILES[fi].tc ? 1 : 0;
        churnSum = DD_FILES[fi].ch || 0;
        maxChurn = churnSum;
      }
    } else {
      const mod = moduleById.get(node.id);
      if (mod && Array.isArray(mod.files)) {
        for (const mf of mod.files) {
          const fi = ddIdxByPath.get(mf.file);
          if (fi === undefined) continue;
          total += 1;
          if (DD_FILES[fi].tc) tested += 1;
          const ch = DD_FILES[fi].ch || 0;
          churnSum += ch;
          if (ch > maxChurn) maxChurn = ch;
        }
      } else if (node.kind === "app" || node.kind === "package" || node.kind === "native_app") {
        const slug = shortPkg(node.label);
        for (const f of DD_FILES) {
          if (f.u !== slug) continue;
          total += 1;
          if (f.tc) tested += 1;
          churnSum += f.ch || 0;
          if ((f.ch || 0) > maxChurn) maxChurn = f.ch || 0;
        }
      }
    }
    if (total === 0) return null;

    if (state.canvasLens === "coverage") {
      const pct = Math.round((tested / total) * 100);
      if (pct >= 70) return { fill: "rgba(16,185,129,0.16)", stroke: "#34d399", badge: pct + "%", badgeBg: "#10b981" };
      if (pct >= 25) return { fill: "rgba(245,158,11,0.15)", stroke: "#fbbf24", badge: pct + "%", badgeBg: "#f59e0b" };
      return { fill: "rgba(239,68,68,0.16)", stroke: "#f87171", badge: pct + "%", badgeBg: "#ef4444" };
    }
    if (state.canvasLens === "churn") {
      const score = total === 1 ? churnSum : maxChurn;
      if (score >= 12) return { fill: "rgba(239,68,68,0.18)", stroke: "#f87171", badge: score + "×", badgeBg: "#ef4444" };
      if (score >= 5) return { fill: "rgba(245,158,11,0.16)", stroke: "#fbbf24", badge: score + "×", badgeBg: "#f59e0b" };
      return { fill: "rgba(56,189,248,0.1)", stroke: "#38bdf8", badge: score + "×", badgeBg: "#38bdf8" };
    }
    return null;
  }

  function buildCrossFileTraceDiagram(seed) {
    if (!seed || !seed.filePath) return null;
    const startFileIdx = ddIdxByPath.get(seed.filePath);
    if (startFileIdx === undefined) return null;
    const startFile = DD_FILES[startFileIdx];
    const startSyms = startFile.m || [];
    const startSymIdx = seed.symIdx >= 0 && startSyms[seed.symIdx]
      ? seed.symIdx
      : Math.max(0, startSyms.findIndex((s) => s[1] === "pub"));

    const cols = new Map();
    const visited = new Map();
    const traceEdges = [];
    const queue = [];

    const addNode = (colIdx, id, label, sublabel, kind, meta) => {
      if (visited.has(id)) return visited.get(id);
      const item = { id, label, sublabel, kind, colIdx, meta };
      visited.set(id, item);
      const list = cols.get(colIdx) || [];
      list.push(item);
      cols.set(colIdx, list);
      return item;
    };

    const seedSym = startSyms[startSymIdx];
    const seedNodeId = seedSym ? "e2e:" + startFileIdx + ":" + startSymIdx : "e2e:" + startFileIdx + ":-1";
    addNode(
      0,
      seedNodeId,
      seedSym ? formatSymDisplayName(seedSym) : startFile.p.split("/").pop(),
      startFile.p.split("/").pop() + (seedSym ? " :" + seedSym[3] : ""),
      "sym_pub",
      { fileIdx: startFileIdx, filePath: startFile.p, symIdx: seedSym ? startSymIdx : -1, line: seedSym ? seedSym[3] : 1 },
    );
    queue.push({ nodeId: seedNodeId, fileIdx: startFileIdx, symIdx: seedSym ? startSymIdx : -1, depth: 0 });

    const seenEdges = new Set();
    while (queue.length > 0 && visited.size < 34) {
      const cur = queue.shift();
      if (cur.depth >= 3) continue;
      const cf = DD_FILES[cur.fileIdx];
      if (!cf) continue;
      const cSyms = cf.m || [];
      const intra = cur.symIdx >= 0 ? (cf.k || []).filter((c) => c[0] === cur.symIdx).slice(0, 4) : [];
      for (const ic of intra) {
        const tgt = cSyms[ic[1]];
        if (!tgt) continue;
        const nid = "e2e:" + cur.fileIdx + ":" + ic[1];
        const nextCol = Math.min(4, cur.depth + 1);
        const existed = visited.has(nid);
        addNode(nextCol, nid, formatSymDisplayName(tgt), cf.p.split("/").pop() + " :" + tgt[3], tgt[1] === "pub" ? "sym_pub" : "sym_priv", { fileIdx: cur.fileIdx, filePath: cf.p, symIdx: ic[1], line: tgt[3] });
        const ek = cur.nodeId + ">" + nid;
        if (!seenEdges.has(ek)) {
          seenEdges.add(ek);
          traceEdges.push({ from: cur.nodeId, to: nid, line: ic[2], kind: "calls", filePath: cf.p });
        }
        if (!existed) queue.push({ nodeId: nid, fileIdx: cur.fileIdx, symIdx: ic[1], depth: cur.depth + 1 });
      }

      const exts = cur.symIdx >= 0 ? (cf.o || []).filter((o) => o[0] === cur.symIdx).slice(0, 5) : (cf.o || []).slice(0, 5);
      for (const ox of exts) {
        const resolved = resolveCrossFileSymbolTarget(cur.fileIdx, ox[1]);
        const nextCol = Math.min(4, cur.depth + 1);
        if (resolved) {
          const nid = "e2e:" + resolved.fileIdx + ":" + resolved.symIdx;
          const rf = DD_FILES[resolved.fileIdx];
          const rSym = resolved.symIdx >= 0 ? rf?.m?.[resolved.symIdx] : null;
          const existed = visited.has(nid);
          addNode(
            nextCol,
            nid,
            rSym ? formatSymDisplayName(rSym) : rf.p.split("/").pop(),
            rf.p.split("/").pop() + " :" + resolved.line,
            rSym ? (rSym[1] === "pub" ? "sym_pub" : "sym_priv") : "file",
            { fileIdx: resolved.fileIdx, filePath: rf.p, symIdx: resolved.symIdx, line: resolved.line },
          );
          const ek = cur.nodeId + ">" + nid;
          if (!seenEdges.has(ek)) {
            seenEdges.add(ek);
            traceEdges.push({ from: cur.nodeId, to: nid, line: ox[2], kind: "calls", filePath: cf.p });
          }
          if (!existed && resolved.symIdx >= 0) {
            queue.push({ nodeId: nid, fileIdx: resolved.fileIdx, symIdx: resolved.symIdx, depth: cur.depth + 1 });
          }
        } else {
          const nid = "e2eext:" + ox[1];
          addNode(Math.min(4, cur.depth + 1), nid, ox[1], "external / vendor", "external_service", { filePath: cf.p, line: ox[2] });
          const ek = cur.nodeId + ">" + nid;
          if (!seenEdges.has(ek)) {
            seenEdges.add(ek);
            traceEdges.push({ from: cur.nodeId, to: nid, line: ox[2], kind: "calls_external", filePath: cf.p });
          }
        }
      }
    }

    const colKeys = Array.from(cols.keys()).sort((a, b) => a - b);
    const laneNames = ["Entry Point", "Hop 1 · Orchestration", "Hop 2 · Services & Helpers", "Hop 3 · Persistence & Sinks", "External & Terminal"];
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

    colKeys.forEach((ck, ci) => {
      const items = cols.get(ck) || [];
      const laneId = "e2e_col_" + ck;
      laneIdxById.set(laneId, ci);
      const widths = items.map((it) => Math.max(204, Math.min(312, Math.max(it.label.length, (it.sublabel || "").length * 0.85) * 8.2 + 72)));
      const colW = Math.round(Math.max(204, ...widths));
      const laneW = colW + padX * 2;
      let curY = topY + padTop;
      for (const it of items) {
        const h = 60;
        const ln = {
          id: it.id,
          label: it.label,
          sublabel: it.sublabel,
          lane: laneId,
          layerRank: ci,
          kind: it.kind,
          role: "symbol",
          domain: "arch",
          shape: it.kind === "external_service" ? "pill" : "box",
          expandable: Boolean(it.meta?.filePath && it.kind !== "external_service"),
          x: Math.round((curX + padX + colW / 2) * 10) / 10,
          y: Math.round((curY + h / 2) * 10) / 10,
          w: colW,
          h,
          provenance: { file: it.meta?.filePath, line: it.meta?.line },
          e2eMeta: it.meta,
        };
        layoutNodes.push(ln);
        posById.set(ln.id, ln);
        curY += h + nodeGapY;
      }
      const laneH = Math.max(120, curY - nodeGapY + padBottom - topY);
      lanes.push({ id: laneId, label: (laneNames[ck] || ("Hop " + ck)) + " (" + items.length + ")", x: curX, y: topY, w: laneW, h: laneH });
      if (topY + laneH > maxBottom) maxBottom = topY + laneH;
      curX += laneW + laneGap;
    });
    for (const l of lanes) l.h = maxBottom - topY;

    const layoutEdges = [];
    traceEdges.forEach((te, idx) => {
      const a = posById.get(te.from);
      const b = posById.get(te.to);
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
        const rx = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 20 + (idx % 3) * 6;
        pts.push({ x: a.x + a.w / 2, y: a.y }, { x: rx, y: a.y }, { x: rx, y: b.y }, { x: b.x + b.w / 2, y: b.y });
      }
      layoutEdges.push({
        id: "e2ee:" + idx,
        from: te.from,
        to: te.to,
        kind: te.kind,
        tier: "spine",
        label: ":" + te.line,
        weight: 1,
        confidence: "observed",
        evidence: [{ file: te.filePath, line: te.line, detail: a.label + " calls " + b.label + " at line " + te.line }],
        points: pts,
      });
    });

    return {
      id: "e2e:" + seed.filePath + ":" + startSymIdx,
      title: "End-to-End Trace — " + (seedSym ? formatSymDisplayName(seedSym) : startFile.p.split("/").pop()),
      subtitle: layoutNodes.length + " symbols across files · " + layoutEdges.length + " call links · double-click any symbol to open its file callstack & code",
      category: "e2etrace",
      rankdir: "LR",
      width: Math.max(560, curX - laneGap + marginX),
      height: Math.max(260, maxBottom + 44),
      lanes,
      nodes: layoutNodes,
      edges: layoutEdges,
    };
  }

  function renderE2eTraceDrawer(diag) {
    const sel = state.selectedNodeId ? diag.nodes.find((n) => n.id === state.selectedNodeId) : diag.nodes[0];
    const meta = sel?.e2eMeta;
    const openBtn = meta?.filePath && sel?.kind !== "external_service"
      ? '<button class="action-btn" data-open-file-graph="' + esc(meta.filePath) + '"' + (meta.symIdx >= 0 ? ' data-jump-sym="' + meta.fileIdx + ":" + meta.symIdx + ":" + meta.line + '"' : "") + '>Open File Callstack & Code →</button>'
      : "";
    const codeHtml = meta && typeof meta.fileIdx === "number" && sel?.kind !== "external_service"
      ? renderCodeBlockHtml(
          meta.fileIdx,
          meta.filePath,
          meta.symIdx >= 0 ? (DD_FILES[meta.fileIdx]?.m?.[meta.symIdx]?.[3] || meta.line) : 1,
          meta.symIdx >= 0 ? (DD_FILES[meta.fileIdx]?.m?.[meta.symIdx]?.[4] || (meta.line + 30)) : (DD_FILES[meta.fileIdx]?.l || 40),
          meta.line || 1,
          false,
          meta.symIdx >= 0,
        )
      : "";
    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(sel ? sel.label : diag.title) + '</div><div class="drawer-sub">' + esc(meta?.filePath ? meta.filePath + ":" + (meta.line || 1) : diag.subtitle) + '</div></div><button class="tbtn" data-close-e2e="1">Close Trace</button></div>' +
      '<div class="story-box"><strong>End-to-End Multi-File Call Trace:</strong> Follows symbol-level calls across imported files up to 4 hops deep (' + diag.nodes.length + " nodes, " + diag.edges.length + " links). Click any step to preview its code, or double-click to enter that file.</div>" +
      (openBtn ? '<div class="pill-row">' + openBtn + '<button class="action-btn sec-btn" data-copy-share="1">Share Trace Link</button></div>' : "") +
      codeHtml
    );
  }

  function renderDiffHunkHtml(fileEntry) {
    if (!fileEntry || !fileEntry.hunk) return "";
    const rawLines = fileEntry.hunk.split("\\n");
    const rows = rawLines.map((ln) => {
      let cls = "diff-ln";
      if (ln.startsWith("@@")) cls += " diff-hdr";
      else if (ln.startsWith("+")) cls += " diff-add";
      else if (ln.startsWith("-")) cls += " diff-del";
      const prefix = ln.slice(0, 1);
      const body = ln.startsWith("@@") ? esc(ln) : highlightCodeLine(ln.slice(1), fileEntry.path);
      return '<div class="' + cls + '"><span class="diff-sig">' + (ln.startsWith("@@") ? " " : esc(prefix)) + '</span><span class="diff-tx">' + body + "</span></div>";
    }).join("");
    return (
      '<div class="code-frame">' +
      '<div class="code-chrome">' +
      '<div class="code-chrome-left"><span class="code-fname">' + esc(fileEntry.path.split("/").pop()) + '</span><span class="badge b-pass">+' + fileEntry.insertions + '</span><span class="badge b-fail">-' + fileEntry.deletions + "</span></div>" +
      '<div class="code-chrome-right">' +
      (fileEntry.status !== "deleted" && ddIdxByPath.has(fileEntry.path) ? '<button class="tbtn" data-open-file-graph="' + esc(fileEntry.path) + '">Full Code →</button>' : "") +
      '<button class="tbtn" data-toggle-hunk="' + esc(fileEntry.path) + '">Close</button>' +
      "</div></div>" +
      '<div class="code-box" style="max-height:320px">' + rows + "</div></div>"
    );
  }

  async function requestPrAiSummary(scopeKey) {
    const cd = DATA.commitDiff;
    if (!cd || prAiPending.has(scopeKey)) return;
    prAiPending.add(scopeKey);
    prAiErrors.delete(scopeKey);
    render();
    const cfg = loadAiConfig();
    const sysPrompt =
      "You summarize git PR architecture diffs clearly for engineers and product stakeholders. " +
      "Reply with EXACTLY two crisp lines, plain text:\\n" +
      "DOES: <1-2 sentences explaining what this PR changes and why>\\n" +
      "WATCH: <1 short sentence on architectural risk, blast radius, or test coverage impact>";
    const fileList = cd.changedFiles.slice(0, 12).map((f) => f.status + " " + f.path + " (+" + f.insertions + "/-" + f.deletions + ", " + f.blastRadius + " callers)").join("\\n");
    const targetFile = scopeKey !== "whole" ? cd.changedFiles.find((f) => f.path === scopeKey) : null;
    const userPrompt = targetFile
      ? "PR: " + cd.commitSubject + "\\nFile: " + targetFile.path + " (" + targetFile.status + ", +" + targetFile.insertions + "/-" + targetFile.deletions + ")\\nDiff:\\n" + (targetFile.hunk || "").slice(0, 3200)
      : "Commit/PR: " + cd.commitSubject + "\\nRange: " + cd.baseSha + ".." + cd.headSha + "\\nVerdict: " + cd.verdict + " — " + cd.verdictSummary + "\\nChanged files:\\n" + fileList + "\\nNew findings: " + cd.findings.introduced.length + ", Resolved: " + cd.findings.resolved.length;
    try {
      const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
      let text = "";
      let usedModel = cfg.model;
      if (isHttp && cfg.provider === "ollama") {
        const res = await fetch("/api/ai/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.model, url: cfg.url, system: sysPrompt, prompt: userPrompt }),
        });
        if (res.ok) {
          const data = await res.json();
          text = data.text || "";
          usedModel = data.model || cfg.model;
        }
      }
      if (!text) {
        const base = cfg.url.replace(/\\/+$/, "");
        const res = await fetch(base + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.model, stream: false, think: false, options: { num_predict: 200, temperature: 0.15 }, messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }] }),
        });
        if (!res.ok) throw new Error("Local AI HTTP " + res.status);
        const data = await res.json();
        text = data?.message?.content || "";
      }
      const parsed = parseAiResponseText(text);
      prAiCache.set(scopeKey, { does: parsed.does, watch: parsed.watch, model: usedModel });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      prAiErrors.set(scopeKey, window.location.protocol === "file:" ? "Open via repospec serve <dir> to use local Ollama AI without browser CORS." : msg);
    } finally {
      prAiPending.delete(scopeKey);
      render();
    }
  }

  function renderSparklineSvg(values, color, invertGood) {
    const w = 220;
    const h = 48;
    const pad = 6;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = values.length === 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, v };
    });
    const d = pts.map((p, i) => (i === 0 ? "M " : "L ") + p.x + " " + p.y).join(" ");
    const area = d + " L " + pts[pts.length - 1].x + " " + (h - 2) + " L " + pts[0].x + " " + (h - 2) + " Z";
    const last = pts[pts.length - 1];
    const first = pts[0];
    const delta = Math.round((last.v - first.v) * 10) / 10;
    const good = delta === 0 ? true : invertGood ? delta < 0 : delta > 0;
    return {
      svg:
        '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" style="display:block;width:100%;height:48px">' +
        '<path d="' + area + '" fill="' + color + '" opacity="0.12" />' +
        '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />' +
        pts.map((p, i) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (i === state.timelineIdx ? 4.5 : 2.8) + '" fill="' + (i === state.timelineIdx ? "#ffffff" : color) + '" stroke="' + color + '" stroke-width="1.5" style="cursor:pointer" data-tl-idx="' + i + '" />').join("") +
        "</svg>",
      delta,
      good,
    };
  }

  function renderTimelineTab() {
    const tl = DATA.timeline;
    if (!tl || !tl.commits || tl.commits.length === 0) {
      return '<div class="table-wrap"><div class="ev-box">No commit timeline embedded. Run <code>bun src/cli.ts timeline &lt;repoDir&gt; --commits 8</code> or <code>generate --timeline 8</code>.</div></div>';
    }
    const commits = tl.commits;
    const selIdx = state.timelineIdx !== null && commits[state.timelineIdx] ? state.timelineIdx : commits.length - 1;
    const cur = commits[selIdx];
    const prev = selIdx > 0 ? commits[selIdx - 1] : null;
    const trendCls = tl.trend === "improving" ? "b-pass" : tl.trend === "drifting" ? "b-fail" : "b-info";

    const cards = [
      { title: "Invariant Violations", vals: commits.map((c) => c.failures + c.warnings), curVal: String(cur.failures + cur.warnings), sub: cur.failures + " fail · " + cur.warnings + " warn", color: "#ff8a8a", invert: true },
      { title: "Direct Test Coverage", vals: commits.map((c) => c.coveragePct), curVal: cur.coveragePct + "%", sub: "tested source files", color: "#5fd9a0", invert: false },
      { title: "Circular Tangles", vals: commits.map((c) => c.tangles), curVal: String(cur.tangles), sub: "SCC module cycles", color: "#f5c26b", invert: true },
      { title: "Source Files & Edges", vals: commits.map((c) => c.files), curVal: String(cur.files), sub: cur.edges + " import edges · " + cur.loc + "L", color: "#7cc8ff", invert: false },
    ];

    const cardsHtml = cards.map((card) => {
      const sp = renderSparklineSvg(card.vals, card.color, card.invert);
      const deltaTxt = sp.delta === 0 ? "0" : (sp.delta > 0 ? "+" : "") + sp.delta;
      return (
        '<div class="tl-card">' +
        '<div class="tl-card-head"><span class="sec-title">' + esc(card.title) + '</span><span class="badge ' + (sp.delta === 0 ? "b-na" : sp.good ? "b-pass" : "b-fail") + '">' + esc(deltaTxt) + "</span></div>" +
        '<div class="tl-val">' + esc(card.curVal) + ' <span class="muted mono" style="font-size:12px">' + esc(card.sub) + "</span></div>" +
        sp.svg +
        "</div>"
      );
    }).join("");

    const rowsHtml = commits.map((c, i) => {
      const isSel = i === selIdx;
      return (
        '<tr style="cursor:pointer' + (isSel ? ";background:rgba(124,200,255,0.12)" : "") + '" data-tl-idx="' + i + '">' +
        '<td class="mono" style="color:var(--accent)">' + esc(c.sha) + "</td>" +
        '<td class="mono muted">' + esc(c.date) + "</td>" +
        '<td>' + esc(c.subject) + "</td>" +
        '<td class="mono">' + c.files + "</td>" +
        '<td class="mono">' + (c.failures > 0 ? '<span class="status-fail">' + c.failures + "F</span> " : "") + (c.warnings > 0 ? '<span class="status-warn">' + c.warnings + "W</span>" : c.failures === 0 ? '<span class="status-pass">0</span>' : "") + "</td>" +
        '<td class="mono">' + c.tangles + "</td>" +
        '<td class="mono">' + c.coveragePct + "%</td>" +
        "</tr>"
      );
    }).reverse().join("");

    return (
      '<div class="table-wrap" style="display:flex;flex-direction:column;gap:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
      '<div><div class="drawer-title">Architecture Drift Timeline</div><div class="drawer-sub">' + esc(tl.summary) + "</div></div>" +
      '<span class="badge ' + trendCls + '">' + esc(tl.trend.toUpperCase()) + "</span></div>" +
      '<div class="tl-grid">' + cardsHtml + "</div>" +
      '<div class="story-box"><strong>Selected Commit (' + esc(cur.sha) + " · " + esc(cur.date) + "):</strong> " + esc(cur.subject) +
      (prev ? " · Δ files " + (cur.files - prev.files >= 0 ? "+" : "") + (cur.files - prev.files) + ", Δ coverage " + (Math.round((cur.coveragePct - prev.coveragePct) * 10) / 10 >= 0 ? "+" : "") + (Math.round((cur.coveragePct - prev.coveragePct) * 10) / 10) + "%, Δ violations " + ((cur.failures + cur.warnings) - (prev.failures + prev.warnings)) : "") +
      "</div>" +
      '<table class="data-tbl"><thead><tr><th>Commit</th><th>Date</th><th>Subject</th><th>Files</th><th>Issues</th><th>Tangles</th><th>Coverage</th></tr></thead><tbody>' +
      rowsHtml +
      "</tbody></table></div>"
    );
  }
`;
}
