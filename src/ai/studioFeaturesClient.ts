export function renderStudioFeaturesClientScript(): string {
  return `
  let liveWatchConnected = false;

  function initLiveWatchStream() {
    if (INLINE || typeof EventSource === "undefined") return;
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;
    try {
      const es = new EventSource("/api/live");
      es.addEventListener("connected", () => {
        liveWatchConnected = true;
        const dot = document.getElementById("live-watch-badge");
        if (dot) dot.style.display = "inline-flex";
      });
      es.addEventListener("reload", () => {
        syncHashFromState();
        window.location.reload();
      });
      es.onerror = () => {
        es.close();
      };
    } catch {}
  }

  function resolveCrossFileSymbolTarget(fileIdx, extLabel) {
    if (typeof fileIdx !== "number" || !extLabel) return null;
    const outLinks = ddOutByIdx.get(fileIdx) || [];
    const parts = String(extLabel).split(".");
    const modHint = (parts[0] || "").toLowerCase();
    const symHint = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    if (!symHint) return null;

    let bestMatch = null;
    for (const edge of outLinks) {
      const tf = DD_FILES[edge.to];
      if (!tf) continue;
      const base = (tf.p.split("/").pop() || "").replace(/\\.[a-z0-9]+$/i, "").toLowerCase();
      const syms = tf.m || [];
      for (let si = 0; si < syms.length; si += 1) {
        const s = syms[si];
        if (s[0] === symHint || formatSymDisplayName(s) === symHint) {
          const exactMod = modHint && (base === modHint || tf.p.toLowerCase().includes("/" + modHint + ".") || tf.p.toLowerCase().includes("/" + modHint + "/"));
          const candidate = { filePath: tf.p, fileIdx: edge.to, symIdx: si, line: s[3], label: tf.p.split("/").pop() + ":" + formatSymDisplayName(s) };
          if (exactMod) return candidate;
          if (!bestMatch) bestMatch = candidate;
        }
      }
      if (!bestMatch && modHint && base === modHint) {
        bestMatch = { filePath: tf.p, fileIdx: edge.to, symIdx: -1, line: 1, label: tf.p.split("/").pop() };
      }
    }
    return bestMatch;
  }

  function syncHashFromState() {
    if (INLINE || typeof history === "undefined" || !history.replaceState) return;
    const params = new URLSearchParams();
    if (state.tab && state.tab !== "map") params.set("tab", state.tab);
    if (state.mapMode && state.mapMode !== "runtime") params.set("mode", state.mapMode);
    if (state.viewMode && state.viewMode !== "flow") params.set("view", state.viewMode);
    if (state.activeLayerDiagId) params.set("diag", state.activeLayerDiagId);
    if (state.activeFolder) params.set("folder", state.activeFolder.unitSlug + "::" + state.activeFolder.folderPath);
    if (state.activeFileGraph) params.set("file", state.activeFileGraph);
    if (state.selectedNodeId) params.set("node", state.selectedNodeId);
    if (state.codeFocusLine && state.codeFocusLine > 1) params.set("line", String(state.codeFocusLine));
    if (state.focusMode) params.set("focus", "1");
    if (state.canvasLens && state.canvasLens !== "default") params.set("lens", state.canvasLens);
    if (state.blastSeedId) params.set("blast", state.blastSeedId);
    if (state.e2eTraceSeed) params.set("trace", state.e2eTraceSeed.filePath + "::" + state.e2eTraceSeed.symIdx);
    const nextHash = params.toString() ? "#" + params.toString() : "";
    if (window.location.hash !== nextHash) {
      try { history.replaceState(null, "", nextHash || window.location.pathname + window.location.search); } catch {}
    }
  }

  function restoreStateFromHash() {
    if (INLINE || !window.location.hash || window.location.hash.length < 2) return;
    try {
      const p = new URLSearchParams(window.location.hash.slice(1));
      const tab = p.get("tab");
      if (tab) state.tab = tab;
      const mode = p.get("mode");
      if (mode) state.mapMode = mode;
      const view = p.get("view");
      if (view) state.viewMode = view;
      const diag = p.get("diag");
      if (diag && diagById.has(diag)) state.activeLayerDiagId = diag;
      const folder = p.get("folder");
      if (folder && folder.includes("::")) {
        const sep = folder.indexOf("::");
        state.activeFolder = { unitSlug: folder.slice(0, sep), folderPath: folder.slice(sep + 2), returnDiagId: state.activeLayerDiagId };
      }
      const file = p.get("file");
      if (file && ddIdxByPath.has(file)) {
        state.activeFileGraph = file;
        ensureFileSourcesLoaded();
      }
      const node = p.get("node");
      if (node) state.selectedNodeId = node;
      const line = Number(p.get("line"));
      if (line > 0) state.codeFocusLine = line;
      if (p.get("focus") === "1") state.focusMode = true;
      const lens = p.get("lens");
      if (lens === "coverage" || lens === "churn") state.canvasLens = lens;
      const blast = p.get("blast");
      if (blast) state.blastSeedId = blast;
      const trace = p.get("trace");
      if (trace && trace.includes("::")) {
        const sep = trace.indexOf("::");
        const fp = trace.slice(0, sep);
        const si = Number(trace.slice(sep + 2));
        if (ddIdxByPath.has(fp)) {
          state.e2eTraceSeed = { filePath: fp, symIdx: Number.isFinite(si) ? si : -1 };
          ensureFileSourcesLoaded();
        }
      }
    } catch {}
  }

  function copyShareDeepLink(btn) {
    syncHashFromState();
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    const prev = btn.textContent;
    btn.textContent = "✓ Link Copied";
    btn.style.color = "#5fd9a0";
    setTimeout(() => { btn.textContent = prev || "Share"; btn.style.color = ""; }, 1400);
  }

  function buildAgentContextPack(kind, id) {
    const lines = [];
    if (kind === "symbol" && state.activeFileGraph) {
      const fIdx = ddIdxByPath.get(state.activeFileGraph);
      const f = fIdx !== undefined ? DD_FILES[fIdx] : null;
      const symIdx = Number(id);
      const sym = f && Array.isArray(f.m) ? f.m[symIdx] : null;
      if (f && sym) {
        const name = formatSymDisplayName(sym);
        const callers = (f.k || []).filter((c) => c[1] === symIdx).map((c) => formatSymDisplayName(f.m[c[0]]) + " :" + c[2]);
        const callees = (f.k || []).filter((c) => c[0] === symIdx).map((c) => formatSymDisplayName(f.m[c[1]]) + " :" + c[2]);
        const exts = (f.o || []).filter((o) => o[0] === symIdx).map((o) => o[1] + " :" + o[2]);
        const fileCallers = (ddInByIdx.get(fIdx) || []).slice(0, 8).map((e) => DD_FILES[e.from].p + ":" + e.line);
        const raw = FILE_SOURCES && typeof FILE_SOURCES[fIdx] === "string" ? FILE_SOURCES[fIdx] : "";
        const snippet = raw ? raw.split("\\n").slice(Math.max(0, sym[3] - 1), sym[4]).join("\\n") : "";
        lines.push("# Agent Context Pack — " + name);
        lines.push("- **File:** \`" + f.p + ":" + sym[3] + "-" + sym[4] + "\` (" + (sym[1] === "pub" ? "PUBLIC" : "PRIVATE") + " " + sym[2] + ")");
        lines.push("- **Unit / Capabilities:** " + f.u + " · " + (f.c || []).join(", ") + " · " + (f.tc ? "directly tested" : "untested") + (f.ch ? " · " + f.ch + " recent commits" : ""));
        if (callers.length > 0) lines.push("- **Intra-file callers:** " + callers.join(", "));
        if (callees.length > 0) lines.push("- **Intra-file callees:** " + callees.join(", "));
        if (exts.length > 0) lines.push("- **External / imported calls:** " + exts.join(", "));
        if (fileCallers.length > 0) lines.push("- **Upstream file importers:** " + fileCallers.join(", "));
        if (snippet) {
          lines.push("");
          lines.push("\`\`\`");
          lines.push(snippet.slice(0, 2600));
          lines.push("\`\`\`");
        }
        return lines.join("\\n");
      }
    }
    if (kind === "file") {
      const fIdx = ddIdxByPath.get(id);
      const f = fIdx !== undefined ? DD_FILES[fIdx] : null;
      if (f) {
        const inL = (ddInByIdx.get(fIdx) || []).slice(0, 12).map((e) => DD_FILES[e.from].p + ":" + e.line);
        const outL = (ddOutByIdx.get(fIdx) || []).slice(0, 12).map((e) => DD_FILES[e.to].p);
        const findings = DATA.invariants.filter((inv) => (inv.status === "fail" || inv.status === "warn") && inv.evidence.some((ev) => ev.file === f.p));
        lines.push("# Agent Context Pack — " + f.p);
        lines.push("- **Unit:** " + f.u + " · **Lines:** " + f.l + " · **Exports:** " + f.e + " · **Tested:** " + (f.tc ? "yes" : "no") + " · **Capabilities:** " + (f.c || []).join(", "));
        if (f.s.length > 0) lines.push("- **Public API:** " + f.s.map((s) => s[0] + " (:" + s[2] + ")").join(", "));
        if (f.x.length > 0) lines.push("- **External APIs:** " + f.x.join(", "));
        if (f.t.length > 0) lines.push("- **Datastores:** " + f.t.join(", "));
        if (inL.length > 0) lines.push("- **Imported by (" + (ddInByIdx.get(fIdx) || []).length + "):** " + inL.join(", "));
        if (outL.length > 0) lines.push("- **Imports (" + (ddOutByIdx.get(fIdx) || []).length + "):** " + outL.join(", "));
        if (findings.length > 0) lines.push("- **Active Findings:** " + findings.map((i) => i.id + " (" + i.status + ")").join(", "));
        return lines.join("\\n");
      }
    }
    const mod = moduleById.get(id);
    if (mod) {
      lines.push("# Agent Context Pack — " + (mod.kind === "directory" ? mod.name + "/" : mod.name));
      lines.push("- **Module:** \`" + mod.relPath + "\` (" + mod.unitSlug + " · L" + mod.level + " " + mod.role + " · " + mod.depth + " · " + mod.lines + "L)");
      lines.push("- **Capabilities:** " + mod.capabilities.join(", ") + (mod.inTangle ? " · IN CYCLE (" + mod.tangleId + ")" : ""));
      lines.push("- **Fan-in / Fan-out:** " + mod.fanIn + " callers / " + mod.fanOut + " dependencies");
      if (mod.topExports.length > 0) lines.push("- **Public API:** " + mod.topExports.map((s) => s.name + " (" + s.file + ":" + s.line + ")").join(", "));
      lines.push("- **Files:** " + mod.files.slice(0, 15).map((f) => f.file).join(", "));
      return lines.join("\\n");
    }
    return "# Agent Context Pack — " + DATA.repo.name + "\\n- Target: " + id;
  }

  function computeBlastRadiusForDiagram(diag, seedId) {
    if (!diag || !seedId) return null;
    const nodeIds = new Set((diag.nodes || []).map((n) => n.id));
    if (!nodeIds.has(seedId)) return null;
    const revAdj = new Map();
    for (const e of diag.edges || []) {
      const arr = revAdj.get(e.to) || [];
      arr.push(e.from);
      revAdj.set(e.to, arr);
      if (e.bidirectional) {
        const arr2 = revAdj.get(e.from) || [];
        arr2.push(e.to);
        revAdj.set(e.from, arr2);
      }
    }
    const hopById = new Map();
    hopById.set(seedId, 0);
    const queue = [seedId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const d = hopById.get(cur) || 0;
      if (d >= 4) continue;
      for (const prev of revAdj.get(cur) || []) {
        if (!hopById.has(prev)) {
          hopById.set(prev, d + 1);
          queue.push(prev);
        }
      }
    }

    const impactedFiles = new Set();
    if (seedId.startsWith("file:")) {
      const sIdx = ddIdxByPath.get(seedId.slice(5));
      if (sIdx !== undefined) {
        const fq = [sIdx];
        const fSeen = new Set([sIdx]);
        while (fq.length > 0) {
          const fi = fq.shift();
          impactedFiles.add(DD_FILES[fi].p);
          for (const inc of ddInByIdx.get(fi) || []) {
            if (!fSeen.has(inc.from)) {
              fSeen.add(inc.from);
              fq.push(inc.from);
            }
          }
        }
      }
    } else {
      for (const [nid] of hopById.entries()) {
        const m = moduleById.get(nid);
        if (m) for (const mf of m.files || []) impactedFiles.add(mf.file);
        else if (nid.startsWith("file:")) impactedFiles.add(nid.slice(5));
      }
    }

    let testedCount = 0;
    let untestedCount = 0;
    for (const fp of impactedFiles) {
      const fi = ddIdxByPath.get(fp);
      if (fi === undefined) continue;
      if (DD_FILES[fi].tc) testedCount += 1;
      else untestedCount += 1;
    }
    const impactedEndpoints = DATA.surfaces.endpoints.filter((ep) => ep.file && impactedFiles.has(ep.file));
    const byHop = { 1: [], 2: [], 3: [] };
    for (const [nid, h] of hopById.entries()) {
      if (h === 0) continue;
      const dn = diag.nodes.find((n) => n.id === nid);
      const label = dn ? dn.label : nid;
      if (h === 1) byHop[1].push({ id: nid, label });
      else if (h === 2) byHop[2].push({ id: nid, label });
      else byHop[3].push({ id: nid, label });
    }
    return { seedId, hopById, byHop, totalUpstream: hopById.size - 1, impactedFilesCount: impactedFiles.size, testedCount, untestedCount, impactedEndpoints };
  }

  function renderBlastRadiusPanel(diag) {
    if (!state.blastSeedId) return "";
    const br = computeBlastRadiusForDiagram(diag, state.blastSeedId);
    if (!br) return "";
    const seedNode = diag.nodes.find((n) => n.id === br.seedId);
    const covPct = br.testedCount + br.untestedCount > 0 ? Math.round((br.testedCount / (br.testedCount + br.untestedCount)) * 100) : 0;
    const hopSection = (title, items, badgeCls) =>
      items.length > 0
        ? '<div class="sec"><div class="sec-title"><span>' + title + " (" + items.length + ')</span><span class="badge ' + badgeCls + '">' + title.split(" ")[0] + '</span></div><div class="pill-row">' +
          items.slice(0, 14).map((it) => '<button class="tray-chip" data-select-node="' + esc(it.id) + '">' + esc(it.label) + "</button>").join("") +
          (items.length > 14 ? '<span class="muted">+' + (items.length - 14) + " more</span>" : "") + "</div></div>"
        : "";
    return (
      '<div class="blast-banner">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<div><div class="sec-title" style="color:#ff9a9a">Blast Radius Simulation</div><strong style="color:var(--text-1);font-size:14px">' + esc(seedNode ? seedNode.label : br.seedId) + "</strong></div>" +
      '<button class="tbtn" data-toggle-blast="">Exit Blast</button></div>' +
      '<div class="pill-row">' +
      '<span class="badge b-fail">' + br.totalUpstream + " upstream nodes</span>" +
      (br.impactedFilesCount > 0 ? '<span class="badge b-warn">' + br.impactedFilesCount + " files</span>" : "") +
      (br.testedCount + br.untestedCount > 0 ? '<span class="badge ' + (covPct >= 60 ? "b-pass" : "b-fail") + '">' + covPct + "% static 1-hop reach (" + br.untestedCount + " unreached)</span>" : "") +
      (br.impactedEndpoints.length > 0 ? '<span class="badge b-info">' + br.impactedEndpoints.length + " HTTP routes</span>" : "") +
      "</div>" +
      hopSection("1-Hop Direct Callers", br.byHop[1], "b-fail") +
      hopSection("2-Hop Transitive Callers", br.byHop[2], "b-warn") +
      hopSection("3+ Hop Ripple", br.byHop[3], "b-info") +
      (br.impactedEndpoints.length > 0
        ? '<div class="sec"><div class="sec-title">Affected HTTP Endpoints (' + br.impactedEndpoints.length + ")</div>" +
          br.impactedEndpoints.slice(0, 8).map((ep) => '<div class="row"><span class="mono">' + esc(ep.method + " " + ep.path) + '</span><span class="badge b-na">' + esc(ep.authGuard || "public") + "</span></div>").join("") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function handleFeatureClick(target) {
    const defBtn = target.closest("[data-jump-def]");
    if (defBtn) {
      const raw = defBtn.getAttribute("data-jump-def") || "";
      const p = raw.split("::");
      if (p.length >= 3) {
        openFileCodeView(p[0], Number(p[2]) || 1, Number(p[1]));
      }
      return true;
    }
    const shareBtn = target.closest("[data-copy-share]");
    if (shareBtn) {
      copyShareDeepLink(shareBtn);
      return true;
    }
    const ctxBtn = target.closest("[data-copy-ctx]");
    if (ctxBtn) {
      const kind = ctxBtn.getAttribute("data-copy-ctx") || "module";
      const id = ctxBtn.getAttribute("data-copy-ctx-id") || "";
      const md = buildAgentContextPack(kind, id);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).catch(() => {});
      }
      const prev = ctxBtn.textContent;
      ctxBtn.textContent = "✓ Context Copied";
      ctxBtn.style.color = "#5fd9a0";
      setTimeout(() => { ctxBtn.textContent = prev || "Copy Agent Context"; ctxBtn.style.color = ""; }, 1400);
      return true;
    }
    const blastBtn = target.closest("[data-toggle-blast]");
    if (blastBtn) {
      const nextSeed = blastBtn.getAttribute("data-toggle-blast") || "";
      state.blastSeedId = nextSeed && state.blastSeedId !== nextSeed ? nextSeed : null;
      if (state.blastSeedId) state.focusMode = false;
      render();
      return true;
    }
    const lensBtn = target.closest("[data-lens]");
    if (lensBtn) {
      state.canvasLens = lensBtn.getAttribute("data-lens") || "default";
      render();
      return true;
    }
    const e2eBtn = target.closest("[data-open-e2e]");
    if (e2eBtn) {
      const raw = e2eBtn.getAttribute("data-open-e2e") || "";
      const sep = raw.indexOf("::");
      const fp = sep >= 0 ? raw.slice(0, sep) : raw;
      const si = sep >= 0 ? Number(raw.slice(sep + 2)) : -1;
      if (ddIdxByPath.has(fp)) {
        state.tab = "map";
        state.e2eTraceSeed = { filePath: fp, symIdx: Number.isFinite(si) ? si : -1 };
        state.activeFileGraph = null;
        state.blastSeedId = null;
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        ensureFileSourcesLoaded();
        render();
      }
      return true;
    }
    if (target.closest("[data-close-e2e]")) {
      state.e2eTraceSeed = null;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    const hunkBtn = target.closest("[data-toggle-hunk]");
    if (hunkBtn) {
      const p = hunkBtn.getAttribute("data-toggle-hunk") || "";
      state.diffSelectedFile = state.diffSelectedFile === p ? null : p;
      render();
      return true;
    }
    const prAiBtn = target.closest("[data-pr-ai-ask]");
    if (prAiBtn) {
      requestPrAiSummary(prAiBtn.getAttribute("data-pr-ai-ask") || "whole");
      return true;
    }
    const visPrBtn = target.closest("[data-copy-visual-pr]");
    if (visPrBtn) {
      const md = buildShowMeVisualPrMarkdown();
      if (md && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).catch(() => {});
      }
      visPrBtn.textContent = "✓ PR Outline Copied";
      visPrBtn.style.color = "#5fd9a0";
      setTimeout(() => { visPrBtn.textContent = "Copy Visual PR"; visPrBtn.style.color = ""; }, 1400);
      return true;
    }
    const tlPt = target.closest("[data-tl-idx]");
    if (tlPt) {
      state.timelineIdx = Number(tlPt.getAttribute("data-tl-idx"));
      render();
      return true;
    }
    return false;
  }
`;
}
