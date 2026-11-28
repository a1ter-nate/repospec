import { renderSvgClientScript } from "../studio/svg.ts";

export function renderInspectorClientScript(): string {
  return `
  function renderFindingDisclosure(inv, opts) {
    const matchingEv = opts.filterEv ? inv.evidence.filter(opts.filterEv) : inv.evidence;
    const allEv = matchingEv.length > 0 ? matchingEv : inv.evidence;
    const shownEv = allEv.slice(0, 6);
    const hasAnchor = Boolean(shownEv.some((e) => e.anchors && e.anchors.length > 0) || inv.evidence.some((e) => e.anchors && e.anchors.length > 0));
    const tone = inv.status === "fail" ? "fail" : inv.status === "warn" ? "warn" : "pass";
    const evRows = shownEv.length > 0
      ? '<div class="ev-list">' + shownEv.map((ev) => {
          const openFileBtn = ddIdxByPath.has(ev.file) ? '<button class="tbtn" data-open-file="' + esc(ev.file) + '" data-open-file-line="' + (ev.line || 1) + '" title="Open source code at this exact line">Inspect code →</button>' : "";
          return '<div class="ev-row"><div class="ev-main"><div class="ev-detail">' + esc(ev.detail) + '</div><div class="ev-loc">' + provenanceLinksHtml(ev.file, ev.line) + '</div></div><div class="ev-act">' + openFileBtn + "</div></div>";
        }).join("") +
        (inv.violationCount > shownEv.length ? '<div class="ev-more">Showing ' + shownEv.length + " of " + inv.violationCount + " hits</div>" : "") +
        "</div>"
      : "";
    const summaryText = inv.statement || inv.why;
    const sourcesHtml = Array.isArray(inv.sources) && inv.sources.length > 0
      ? '<div class="finding-note" style="margin-top:6px"><strong>Sources:</strong> ' +
        inv.sources.map((s) => '<a class="ext-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + " ↗</a>").join(" · ") +
        "</div>"
      : "";
    const bodyHtml =
      (summaryText ? '<div class="finding-note"><strong>What is wrong:</strong> ' + esc(summaryText) + "</div>" : "") +
      (inv.why ? '<div class="finding-note"><strong>Why it matters:</strong> ' + esc(inv.why) + "</div>" : "") +
      evRows +
      (inv.fix ? '<div class="finding-fix"><strong>How to fix it:</strong> ' + esc(inv.fix) + "</div>" : "") +
      (inv.benefit ? '<div class="finding-note"><strong>Why this helps:</strong> ' + esc(inv.benefit) + "</div>" : "") +
      sourcesHtml +
      '<div class="finding-actions">' +
      (hasAnchor ? '<button class="tbtn tbtn-accent" data-show-inv="' + esc(inv.id) + '" title="Jump to this violation on the architecture map">Highlight on map</button>' : "") +
      '<button class="tbtn" data-copy-inv="' + esc(inv.id) + '" title="Copy rule, evidence, and fix instructions as Markdown">Copy Fix Brief</button>' +
      (opts.hideChecksLink || state.tab === "checks" ? "" : '<button class="tbtn" data-jump-check-id="' + esc(inv.id) + '">Open in Checks</button>') +
      "</div>";
    return renderDisclosure({
      title: inv.name,
      badge: opts.countOverride !== undefined ? opts.countOverride : inv.violationCount,
      badgeClass: tone === "fail" ? "b-fail" : tone === "warn" ? "b-warn" : "b-pass",
      tone,
      open: Boolean(opts.open),
      bodyHtml,
    });
  }

  function activeDiagram() {
    if (state.tab === "behavior") {
      return diagById.get(state.activeBehaviorId) || behaviorDiags[0] || null;
    }
    if (state.tab === "delivery") return deliveryDiag;
    if (state.tab === "map") {
      if (state.e2eTraceSeed) {
        const e2e = buildCrossFileTraceDiagram(state.e2eTraceSeed);
        if (e2e) return e2e;
      }
      if (state.activeFileGraph) {
        const fg = buildFileCallGraphDiagram(state.activeFileGraph);
        if (fg) return fg;
      }
      if (state.activeFolder) {
        const fd = buildFolderContextDiagram(state.activeFolder.unitSlug, state.activeFolder.folderPath);
        if (fd) return fd;
      }
      if (state.activeLayerDiagId && diagById.has(state.activeLayerDiagId)) {
        return diagById.get(state.activeLayerDiagId);
      }
      if (state.mapMode === "packages" && packagesDiag) return packagesDiag;
      if (state.mapMode === "domains" && domainsDiag) return domainsDiag;
      if (state.mapMode === "delivery" && deliveryDiag) return deliveryDiag;
      return runtimeDiag;
    }
    return null;
  }

  function supportsMatrix(diag) {
    return Boolean(diag && diag.nodes.length >= 3 && ["modules", "subsystem", "layers", "domains", "packages", "runtime"].includes(diag.category));
  }

  function buildBowTieLayout(diag, centerId) {
    const center = diag.nodes.find((n) => n.id === centerId);
    if (!center) return diag;
    const inEdges = diag.edges.filter((e) => e.to === centerId);
    const outEdges = diag.edges.filter((e) => e.from === centerId);
    const leftNodes = [];
    const rightNodes = [];
    const seenL = new Set();
    const seenR = new Set();
    for (const e of inEdges) {
      if (!seenL.has(e.from)) {
        seenL.add(e.from);
        const n = diag.nodes.find((x) => x.id === e.from);
        if (n) leftNodes.push(n);
      }
    }
    for (const e of outEdges) {
      if (!seenR.has(e.to)) {
        seenR.add(e.to);
        const n = diag.nodes.find((x) => x.id === e.to);
        if (n) rightNodes.push(n);
      }
    }
    const maxPerSide = 8;
    const keptL = leftNodes.slice(0, maxPerSide);
    const keptR = rightNodes.slice(0, maxPerSide);
    const folded = Math.max(0, leftNodes.length - keptL.length) + Math.max(0, rightNodes.length - keptR.length);

    const colX = [148, 430, 712];
    const rowGap = 68;
    const maxRows = Math.max(1, keptL.length, keptR.length);
    const height = Math.max(240, maxRows * rowGap + 74);
    const midY = height / 2;

    const nodes = [];
    const pos = new Map();
    const placeCol = (arr, x) => {
      const startY = midY - ((arr.length - 1) * rowGap) / 2;
      arr.forEach((n, i) => {
        const copy = { ...n, x, y: startY + i * rowGap };
        nodes.push(copy);
        pos.set(copy.id, copy);
      });
    };
    placeCol(keptL, colX[0]);
    const centerCopy = { ...center, x: colX[1], y: midY };
    nodes.push(centerCopy);
    pos.set(centerCopy.id, centerCopy);
    placeCol(keptR, colX[2]);

    const edges = [];
    for (const e of [...inEdges, ...outEdges]) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const sx = a.x < b.x ? a.x + a.w / 2 : a.x - a.w / 2;
      const tx = a.x < b.x ? b.x - b.w / 2 : b.x + b.w / 2;
      const dx = (tx - sx) * 0.45;
      edges.push({
        ...e,
        tier: e.violation ? "violation" : "spine",
        points: [
          { x: sx, y: a.y },
          { x: sx + dx, y: a.y },
          { x: tx - dx, y: b.y },
          { x: tx, y: b.y },
        ],
      });
    }

    return {
      ...diag,
      title: "Focus — " + center.label,
      subtitle: "Bow-tie 1-hop neighborhood (callers left, dependencies right). Press F or Esc to exit Focus.",
      width: 870,
      height,
      lanes: [
        { id: "upstream", label: "Upstream / Callers", x: 20, y: 20, w: 256, h: height - 40 },
        { id: "selected", label: "Selected", x: 302, y: 20, w: 256, h: height - 40 },
        { id: "downstream", label: "Downstream / Deps", x: 584, y: 20, w: 256, h: height - 40 },
      ],
      foldedCount: folded,
      nodes,
      edges,
    };
  }

  function statusHue(findings, violation) {
    if (violation) return "#ef4444";
    if (!findings || findings.length === 0) return null;
    if (findings.some((f) => f.severity === "error")) return "#ef4444";
    if (findings.some((f) => f.severity === "warn")) return "#f59e0b";
    return null;
  }
  ${renderSvgClientScript()}

  function renderBriefingDrawer() {
    const apps = DATA.nodes.filter((n) => n.kind === "app" || n.kind === "native_app");
    const pkgs = DATA.nodes.filter((n) => n.kind === "package" || n.kind === "analyzer");
    const stores = DATA.nodes.filter((n) => n.kind === "datastore");
    const exts = DATA.nodes.filter((n) => n.kind === "external_service");
    const allActive = sortInvariantsByUrgency(DATA.invariants.filter((i) => i.status === "fail" || i.status === "warn"));
    const curDiag = activeDiagram();

    if (state.activeFolder) {
      const af = state.activeFolder;
      const folderIdxs = (ddByUnit.get(af.unitSlug) || []).filter((idx) => {
        const rel = ddLogicalRel(DD_FILES[idx], ddUnitPeelPrefix(af.unitSlug));
        return rel === af.folderPath || rel.startsWith(af.folderPath + "/");
      });
      const folderFileSet = new Set(folderIdxs.map((i) => DD_FILES[i].p));
      const folderInvs = allActive.filter((inv) => inv.evidence.some((ev) => folderFileSet.has(ev.file)));
      const totalLines = folderIdxs.reduce((s, i) => s + DD_FILES[i].l, 0);
      const extSet = new Set();
      const envSet = new Set();
      for (const i of folderIdxs) {
        for (const x of DD_FILES[i].x) extSet.add(x);
        for (const v of DD_FILES[i].v) envSet.add(v);
      }
      const biggest = [...folderIdxs].sort((a, b) => DD_FILES[b].l - DD_FILES[a].l).slice(0, 8);
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(af.folderPath + "/") + '</div><div class="drawer-sub">' + esc(af.unitSlug) + " · " + folderIdxs.length + " files · " + totalLines + " lines</div></div></div>" +
        '<div class="story-box">Folder Context Map for <strong>' + esc(af.folderPath + "/") + "</strong>. Left shows callers, center shows files inside, right shows dependencies & external APIs." +
        (folderInvs.length > 0 ? ' <span class="status-fail">' + folderInvs.length + " active issue" + (folderInvs.length === 1 ? "" : "s") + " inside this folder.</span>" : ' <span class="status-pass">0 active rule violations in this folder.</span>') + "</div>" +
        (folderInvs.length > 0
          ? '<div class="sec"><div class="sev-group-hdr fail"><span>Issues Inside ' + esc(af.folderPath + "/") + " (" + folderInvs.length + ")</span></div>" +
            folderInvs.map((inv) => renderFindingDisclosure(inv, { open: inv.status === "fail", filterEv: (ev) => folderFileSet.has(ev.file) })).join("") + "</div>"
          : "") +
        (extSet.size > 0 || envSet.size > 0
          ? '<div class="sec"><div class="sec-title">Folder Surfaces</div>' +
            (extSet.size > 0 ? '<div class="row"><span class="muted">External APIs</span><span class="mono">' + esc(Array.from(extSet).slice(0, 6).join(", ")) + "</span></div>" : "") +
            (envSet.size > 0 ? '<div class="row"><span class="muted">Env Vars</span><span class="mono">' + esc(Array.from(envSet).slice(0, 6).join(", ")) + "</span></div>" : "") + "</div>"
          : "") +
        '<div class="sec"><div class="sec-title"><span>Largest Files (click for code)</span></div>' +
        biggest.map((i) => {
          const f = DD_FILES[i];
          return '<div class="row"><span class="row-link mono" data-open-file-graph="' + esc(f.p) + '">' + esc(f.p.split("/").pop()) + '</span><span class="mono muted">' + f.l + "L · " + f.e + " exp</span></div>";
        }).join("") + "</div>" +
        (typeof renderLocationFlowsSection === "function" ? renderLocationFlowsSection({ files: Array.from(folderFileSet) }) : "")
      );
    }

    const scopedUnitSlug = curDiag?.ownerId ? curDiag.id.replace(/^(?:modules|layers|subsystem):/, "").split(":")[0] : null;
    const scopedUnitNode = curDiag?.ownerId ? nodeById.get(curDiag.ownerId) : null;
    const scopedDir = typeof scopedUnitNode?.meta?.dir === "string" ? scopedUnitNode.meta.dir : "";
    const unitInvs = scopedUnitSlug
      ? allActive.filter((inv) => inv.evidence.some((ev) => (scopedDir && ev.file.startsWith(scopedDir + "/")) || ev.targetNodeId === curDiag?.ownerId))
      : allActive;
    const displayInvs = unitInvs.length > 0 ? unitInvs : allActive;
    const fails = displayInvs.filter((i) => i.status === "fail");
    const warns = displayInvs.filter((i) => i.status === "warn");

    const scopedTangleMods = scopedUnitSlug
      ? (DATA.modules || []).filter((m) => m.unitSlug === scopedUnitSlug && m.inTangle)
      : [];
    const tangleBanner = scopedTangleMods.length > 0
      ? '<div class="tangle-banner"><div><strong>⚠ Circular Dependency Tangle (' + scopedTangleMods.length + ' modules)</strong><div class="muted" style="color:#fecaca;margin-top:2px">Mutual imports between ' + esc(scopedTangleMods.slice(0, 5).map((m) => m.name).join(", ")) + (scopedTangleMods.length > 5 ? " +" + (scopedTangleMods.length - 5) : "") + ' make changes ripple unpredictably.</div></div><div class="links-row"><button class="action-btn sec-btn" data-open-viol-matrix="1">Inspect Cycle in Matrix →</button></div></div>'
      : "";

    const storyHtml = buildArchitectureStory();
    const shapeLine =
      isLibraryDefault
        ? "A " + DATA.repo.ecosystem + " library (" + pkgs.map((p) => esc(shortPkg(p.label))).join(", ") + ") with " + DATA.stateMachines.length + " declared state machine(s)."
        : "A " + DATA.repo.ecosystem + " system with " + apps.length + " app/binary unit(s), " + pkgs.length + " package(s), " + (DATA.modules || []).length + " indexed modules, and " + DATA.summary.indexedSourceFiles + " source files.";

    const findingsScopeLabel = scopedUnitSlug && unitInvs.length > 0 ? " in " + scopedUnitSlug : "";
    const findingsHtml =
      '<div class="sec"><div class="sec-title"><span>Health &amp; Checks' + esc(findingsScopeLabel) + '</span><button class="tbtn" data-jump-checks="1">Open Checks (' + displayInvs.length + ") →</button></div>" +
      (displayInvs.length === 0
        ? '<div class="muted" style="font-size:12px">All applicable architectural checks pass.</div>'
        : renderDisclosure({
            title: (fails.length > 0 ? fails.length + " blocker" + (fails.length === 1 ? "" : "s") + " · " : "") + warns.length + " warning" + (warns.length === 1 ? "" : "s"),
            meta: "expand to inspect or click Open Checks",
            badge: displayInvs.length,
            badgeClass: fails.length > 0 ? "b-fail" : "b-warn",
            tone: fails.length > 0 ? "fail" : "warn",
            open: false,
            bodyHtml:
              (fails.length > 0 ? fails.slice(0, 4).map((inv) => renderFindingDisclosure(inv, { open: false })).join("") : "") +
              (warns.length > 0 ? warns.slice(0, 4).map((inv) => renderFindingDisclosure(inv, { open: false })).join("") : ""),
          })) +
      "</div>";

    const drawerSub = scopedUnitSlug
      ? (curDiag?.category === "layers" ? "Clean Architecture Layers" : "Module Dependency Topology") + " · double-click to drill in"
      : DATA.repo.ecosystem + " · " + DATA.summary.indexedSourceFiles + " files";

    const edgeDegree = new Map();
    for (const e of DATA.edges || []) {
      edgeDegree.set(e.from, (edgeDegree.get(e.from) || 0) + 1);
      edgeDegree.set(e.to, (edgeDegree.get(e.to) || 0) + 1);
    }
    const topApp = [...apps].sort((a, b) => (edgeDegree.get(b.id) || 0) - (edgeDegree.get(a.id) || 0))[0] || pkgs[0] || null;
    const topStore = stores[0] || null;
    const hottestFlow = typeof ALL_FLOWS !== "undefined" && ALL_FLOWS.length > 0
      ? [...ALL_FLOWS].sort((a, b) => (b.hazardCount || 0) - (a.hazardCount || 0) || (b.serialAwaitCount || 0) - (a.serialAwaitCount || 0))[0]
      : null;
    const topBlocker = fails[0] || null;

    const startCards = [];
    if (!scopedUnitSlug && topApp) {
      const deg = edgeDegree.get(topApp.id) || 0;
      startCards.push(
        '<button class="start-card" data-select-node="' + esc(topApp.id) + '">' +
        '<div><div class="start-title">' + esc(shortPkg(topApp.label)) + '</div><div class="start-why">Core ' + esc(topApp.kind) + " · " + deg + " connections</div></div>" +
        '<span class="badge b-info">Inspect →</span></button>'
      );
    }
    if (!scopedUnitSlug && topStore) {
      startCards.push(
        '<button class="start-card" data-select-node="' + esc(topStore.id) + '">' +
        '<div><div class="start-title">' + esc(shortPkg(topStore.label)) + '</div><div class="start-why">Primary datastore · ' + DATA.summary.datastoreEntities + " collections</div></div>" +
        '<span class="badge b-purple">Data →</span></button>'
      );
    }
    if (!scopedUnitSlug && hottestFlow) {
      startCards.push(
        '<button class="start-card" data-jump-flow="' + esc(hottestFlow.id) + '">' +
        '<div><div class="start-title">▶ ' + esc(hottestFlow.name) + '</div><div class="start-why">Hottest flow · ' + hottestFlow.serialAwaitCount + " serial awaits" + (hottestFlow.hazardCount > 0 ? " · " + hottestFlow.hazardCount + " flags" : "") + "</div></div>" +
        '<span class="badge ' + (hottestFlow.hazardCount > 0 ? "b-warn" : "b-cyan") + '">Flows →</span></button>'
      );
    }
    if (topBlocker) {
      startCards.push(
        '<button class="start-card" data-jump-checks="1">' +
        '<div><div class="start-title">' + esc(topBlocker.name) + '</div><div class="start-why">' + topBlocker.violationCount + " architectural blocker" + (topBlocker.violationCount === 1 ? "" : "s") + "</div></div>" +
        '<span class="badge b-fail">Fix →</span></button>'
      );
    }

    const statStrip = !scopedUnitSlug
      ? '<div class="stat-strip">' +
        '<div class="stat-cell"><div class="stat-num">' + apps.length + '</div><div class="stat-lbl">Apps &amp; Services</div></div>' +
        '<div class="stat-cell"><div class="stat-num">' + pkgs.length + '</div><div class="stat-lbl">Libraries</div></div>' +
        '<div class="stat-cell"><div class="stat-num">' + (stores.length + exts.length) + '</div><div class="stat-lbl">State &amp; APIs</div></div>' +
        "</div>"
      : (storyHtml || "");

    const startSec = startCards.length > 0
      ? '<div class="sec"><div class="sec-title"><span>Worth Looking At First</span></div>' + startCards.join("") + "</div>"
      : "";

    const scopedHealthSec = scopedUnitSlug ? findingsHtml : "";
    const tipFoot = '<div class="muted" style="font-size:11.5px;line-height:1.5;margin-top:auto;padding-top:10px;border-top:1px solid #161e30">Click any card on the map to inspect · Double-click to drill into files · Press <span class="keycap">]</span> to hide this panel.</div>';

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(scopedUnitSlug ? scopedUnitSlug : DATA.repo.name) + '</div><div class="drawer-sub">' + esc(scopedUnitSlug ? drawerSub : DATA.repo.ecosystem + " · " + DATA.summary.indexedSourceFiles + " files") + "</div></div></div>" +
      (DATA.customUi?.briefingHtml ? '<div class="sec">' + DATA.customUi.briefingHtml + "</div>" : "") +
      statStrip +
      startSec +
      tangleBanner +
      scopedHealthSec +
      tipFoot
    );
  }

  function renderModuleInspector(modId) {
    const mod = moduleById.get(modId);
    const diag = activeDiagram();
    if (!mod) {
      const diagNode = diag?.nodes.find((n) => n.id === modId);
      if (!diagNode) return renderBriefingDrawer();
      const inEdges = (diag?.edges || []).filter((e) => e.to === modId);
      const outEdges = (diag?.edges || []).filter((e) => e.from === modId);
      const nameOf = (id) => diag?.nodes.find((x) => x.id === id)?.label || id;
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(diagNode.label) + '</div><div class="drawer-sub">' + esc(diagNode.sublabel || "submodule") + "</div></div></div>" +
        provenanceLinksHtml(diagNode.provenance?.file, diagNode.provenance?.line) +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + '</button><button class="action-btn sec-btn" data-clear-sel="1">Briefing</button></div>' +
        renderInlineSourceDisclosure(diagNode.provenance?.file, diagNode.provenance?.line, { open: true }) +
        '<div class="sec"><div class="sec-title">Control & Data Flow</div>' +
        outEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.to) + '">→ ' + esc(nameOf(e.to)) + '</span><span class="muted mono">' + (e.weight || 1) + "</span></div>").join("") +
        inEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.from) + '">← ' + esc(nameOf(e.from)) + '</span><span class="muted mono">' + (e.weight || 1) + "</span></div>").join("") +
        "</div>"
      );
    }

    const subDiagId = "subsystem:" + mod.unitSlug + ":" + mod.name;
    const subDiag = mod.hasSubsystemDiagram ? diagById.get(subDiagId) : null;
    const ddFolderCount = mod.kind === "directory" ? unitHasFolderFiles(mod.unitSlug, mod.name) : 0;
    const modDiag = diagById.get("modules:" + mod.unitSlug) || diag;
    const outEdges = (modDiag?.edges || []).filter((e) => e.from === mod.id);
    const inEdges = (modDiag?.edges || []).filter((e) => e.to === mod.id);
    const labelOf = (id) => {
      const m = moduleById.get(id);
      return m ? (m.kind === "directory" ? m.name + "/" : m.name) : id;
    };

    const depthRatio = mod.exportCount > 0 ? Math.round(mod.lines / mod.exportCount) : mod.lines;
    const depthBadgeCls = mod.depth === "deep" ? "b-pass" : mod.depth === "contract" ? "b-purple" : mod.depth === "shallow" ? "b-warn" : "b-info";
    const roleBadgeCls = mod.role === "entry" ? "b-cyan" : mod.role === "foundation" ? "b-purple" : mod.role === "adapter" ? "b-warn" : "b-info";

    const pillsHtml =
      '<div class="pill-row">' +
      '<span class="badge ' + roleBadgeCls + '">' + esc(mod.role) + " · L" + mod.level + "</span>" +
      '<span class="badge ' + depthBadgeCls + '">' + esc(mod.depth) + " (" + mod.lines + "L / " + mod.exportCount + " exp)</span>" +
      mod.capabilities.map((c) => '<span class="badge ' + capBadgeClass(c) + '">' + esc(c) + "</span>").join("") +
      (mod.inTangle ? '<span class="badge b-fail">⚠ ' + esc(mod.tangleId || "cycle") + "</span>" : "") +
      "</div>";

    const singleFilePath = mod.files.length === 1 && ddIdxByPath.has(mod.files[0].file) ? mod.files[0].file : "";
    const singleFileSyms = singleFilePath ? (DD_FILES[ddIdxByPath.get(singleFilePath)]?.m || []).length : 0;
    const modPrimary = singleFilePath
      ? '<button class="action-btn" data-open-file-graph="' + esc(singleFilePath) + '">Callstack &amp; Code (' + singleFileSyms + ") →</button>"
      : ddFolderCount > 0
        ? '<button class="action-btn" data-open-folder="' + esc(mod.unitSlug + "::" + mod.name) + '">Open ' + esc(mod.name) + "/ (" + ddFolderCount + ") →</button>"
        : subDiag
          ? '<button class="action-btn" data-open-layers="' + esc(subDiag.id) + '">Drill into ' + esc(mod.name) + "/ (" + subDiag.nodes.length + ") →</button>"
          : "";
    const modMore =
      '<details class="more-wrap"><summary class="action-btn sec-btn" title="More actions">•••</summary><div class="more-menu">' +
      '<button class="tbtn" data-toggle-blast="' + esc(mod.id) + '">' + (state.blastSeedId === mod.id ? "Exit Blast Radius" : "Blast Radius") + "</button>" +
      '<button class="tbtn" data-copy-ctx="module" data-copy-ctx-id="' + esc(mod.id) + '">Copy Agent Context</button>' +
      '<button class="tbtn" data-clear-sel="1">Back to Overview</button>' +
      "</div></details>";
    const actions = [
      modPrimary,
      '<button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus" : "Focus (F)") + "</button>",
      modMore,
    ].filter(Boolean).join(" ");

    const apiSec =
      '<div class="sec"><div class="sec-title"><span>Public API Surface (' + mod.exportCount + ')</span><span class="muted">' + depthRatio + "L/exp</span></div>" +
      (mod.topExports.length === 0
        ? '<div class="muted" style="font-size:11px">No public symbols exported (entry script or internal helper).</div>'
        : mod.topExports.map((sym) => {
            const canJump = ddIdxByPath.has(sym.file);
            const gh = githubUrl(sym.file, sym.line);
            const loc = canJump
              ? '<button class="tbtn" data-open-file="' + esc(sym.file) + '" data-open-file-line="' + sym.line + '" title="Open code at line ' + sym.line + '">:' + sym.line + "</button>"
              : gh
                ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">:' + sym.line + " ↗</a>"
                : '<span class="mono muted">:' + sym.line + "</span>";
            const nameSpan = canJump
              ? '<span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-open-file="' + esc(sym.file) + '" data-open-file-line="' + sym.line + '">' + esc(sym.name) + "</span>"
              : '<span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sym.name) + "</span>";
            return '<div class="api-row">' + nameSpan + '<span style="display:flex;gap:5px;align-items:center;flex-shrink:0"><span class="badge b-na">' + esc(sym.kind) + "</span>" + loc + "</span></div>";
          }).join("")) +
      "</div>";

    const flowSec =
      '<div class="sec"><div class="sec-title"><span>Dependencies</span><span class="muted">in ' + mod.fanIn + " · out " + mod.fanOut + "</span></div>" +
      (inEdges.length > 0
        ? renderDisclosure({
            title: "Upstream Callers (←)",
            badge: inEdges.length,
            badgeClass: "b-pass",
            tone: "pass",
            open: inEdges.length <= 6,
            bodyHtml: inEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.from) + '">← ' + esc(labelOf(e.from)) + '</span><span class="muted mono">' + (e.weight || 1) + "</span></div>").join(""),
          })
        : "") +
      (outEdges.length > 0
        ? renderDisclosure({
            title: "Downstream Imports (→)",
            badge: outEdges.length,
            badgeClass: outEdges.some((e) => e.violation) ? "b-fail" : "b-info",
            tone: outEdges.some((e) => e.violation) ? "fail" : "info",
            open: outEdges.length <= 8,
            bodyHtml: outEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.to) + '">→ ' + esc(labelOf(e.to)) + "</span>" + (e.violation ? '<span class="badge b-fail">cycle</span>' : '<span class="muted mono">' + (e.weight || 1) + "</span>") + "</div>").join(""),
          })
        : "") +
      (inEdges.length === 0 && outEdges.length === 0 ? '<div class="muted" style="font-size:11px">Standalone module (0 internal edges).</div>' : "") +
      "</div>";

    const filesSec =
      '<div class="sec"><div class="sec-title"><span>Files (' + mod.fileCount + ')</span><span class="muted">' + mod.lines + " lines</span></div>" +
      renderDisclosure({
        title: mod.fileCount === 1 ? mod.files[0]?.file || mod.relPath : mod.fileCount + " source files in " + mod.name + "/",
        badge: mod.lines + "L",
        badgeClass: "b-na",
        open: mod.fileCount <= 6,
        bodyHtml: mod.files.map((f) => {
          const hasDd = ddIdxByPath.has(f.file);
          const gh = githubUrl(f.file, 1);
          const nameHtml = hasDd
            ? '<span class="row-link mono" data-open-file="' + esc(f.file) + '">' + esc(f.file) + "</span>"
            : gh
              ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">' + esc(f.file) + " ↗</a>"
              : '<span class="mono">' + esc(f.file) + "</span>";
          const io = f.capabilities.filter((c) => c !== "PURE").join(",");
          return '<div class="row">' + nameHtml + '<span class="mono muted">' + f.lines + "L" + (io ? " · " + esc(io) : "") + "</span></div>";
        }).join(""),
      }) +
      "</div>";

    const singleFileCodeSec = singleFilePath
      ? renderInlineSourceDisclosure(singleFilePath, 1, { open: true })
      : "";
    const singleFileLaunch = singleFilePath && typeof renderFileFlowLaunchPills === "function"
      ? renderFileFlowLaunchPills(singleFilePath)
      : "";
    const modFlowsSec = !singleFilePath && typeof renderLocationFlowsSection === "function"
      ? renderLocationFlowsSection({ files: mod.files.map((f) => f.file) })
      : "";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(mod.kind === "directory" ? mod.name + "/" : mod.name) + '</div><div class="drawer-sub">' + esc(mod.unitSlug + " · " + mod.language + " · " + mod.relPath) + "</div></div></div>" +
      pillsHtml +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + actions + "</div>" +
      singleFileLaunch +
      singleFileCodeSec +
      apiSec +
      flowSec +
      modFlowsSec +
      filesSec
    );
  }

`;
}
