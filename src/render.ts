import { renderCameraClientScript } from "./studio/camera.ts";
import type { CommitArchDiff } from "./studio/commitDiff.ts";
import { renderDiffClientScript } from "./studio/diffClient.ts";
import type { DrilldownIndex } from "./studio/drilldown.ts";
import { renderDrilldownClientScript } from "./studio/drilldownClient.ts";
import { renderFileCallGraphClientScript } from "./studio/fileCallGraphClient.ts";
import { renderGuidesClientScript } from "./studio/guides.ts";
import { renderStudioCss } from "./studio/styles.ts";
import { renderSvgClientScript } from "./studio/svg.ts";
import { renderTablesClientScript } from "./studio/tablesClient.ts";
import type { RepoSpecV4 } from "./schema.ts";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCompactRenderPayload(
  spec: RepoSpecV4,
  digest: string,
  inline: boolean,
  drilldown?: DrilldownIndex,
  commitDiff?: CommitArchDiff,
): Record<string, unknown> {
  const includeDrilldown = drilldown && (!inline || drilldown.files.length <= 160);
  const compactDrilldown = includeDrilldown
    ? { files: drilldown.files, edges: drilldown.edges }
    : undefined;
  return {
    schemaVersion: spec.schemaVersion,
    digest,
    repo: spec.repo,
    summary: spec.summary,
    verification: spec.verification,
    diagnostics: spec.diagnostics,
    ...(compactDrilldown ? { drilldown: compactDrilldown } : {}),
    ...(commitDiff ? { commitDiff } : {}),
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      domain: n.domain,
      kind: n.kind,
      role: n.role,
      label: n.label,
      group: n.group,
      ownerId: n.ownerId,
      provenance: n.provenance,
      findings: n.findings,
      meta: inline
        ? {
            dir: n.meta.dir ?? null,
            archetype: n.meta.archetype ?? null,
            layerAxis: n.meta.layerAxis ?? null,
            layerRank: n.meta.layerRank ?? null,
          }
        : n.meta,
    })),
    edges: spec.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
      weight: e.weight,
      violation: e.violation,
      ruleIds: e.ruleIds,
      confidence: e.confidence,
      evidence: e.evidence?.slice(0, inline ? 2 : 5),
    })),
    invariants: spec.invariants.map((inv) => ({
      ...inv,
      evidence: inv.evidence.slice(0, inline ? 8 : 15),
    })),
    entities: spec.entities.slice(0, inline ? 60 : 250),
    stateMachines: spec.stateMachines.slice(0, inline ? 20 : 40),
    loops: spec.loops.slice(0, inline ? 20 : 40),
    modules: spec.modules.slice(0, inline ? 80 : 300).map((m) => ({
      ...m,
      topExports: m.topExports.slice(0, inline ? 8 : 12),
      files: m.files.slice(0, inline ? 10 : 40),
    })),
    traces: spec.traces,
    surfaces: {
      endpoints: spec.surfaces.endpoints.slice(0, inline ? 50 : 420),
      foreignKeys: spec.surfaces.foreignKeys.slice(0, inline ? 40 : 180),
      envBindings: spec.surfaces.envBindings.slice(0, inline ? 40 : 160),
      govRules: spec.surfaces.govRules.slice(0, inline ? 40 : 160),
    },
    diagrams: inline
      ? spec.diagrams
          .filter((d) => d.category !== "subsystem" || spec.diagrams.length <= 10)
          .slice(0, 16)
          .map((d) => ({
            ...d,
            edges: d.edges.map((e) => ({
              ...e,
              evidence: e.violation ? e.evidence?.slice(0, 2) : undefined,
            })),
          }))
      : spec.diagrams,
  };
}

export function renderVisualHtml(
  spec: RepoSpecV4,
  digest: string,
  options?: { inline?: boolean; drilldown?: DrilldownIndex; commitDiff?: CommitArchDiff },
): string {
  const inline = options?.inline ?? false;
  const payload = buildCompactRenderPayload(spec, digest, inline, options?.drilldown, options?.commitDiff);
  const embeddedJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  const includeSrcBlob = Boolean(options?.drilldown?.sourcesGzipBase64 && (!inline || (options?.drilldown?.files.length ?? 0) <= 160));
  const srcScriptTag = includeSrcBlob
    ? `\n<script id="repospec-src" type="application/octet-stream">${options?.drilldown?.sourcesGzipBase64}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RepoSpec v${escapeHtml(spec.schemaVersion)} · ${escapeHtml(spec.repo.name)}</title>
<style>${renderStudioCss(inline)}</style>
</head>
<body>
<div class="app" id="app"></div>
<script id="repospec-data" type="application/json">${embeddedJson}</script>${srcScriptTag}
<script>
(() => {
  const DATA = JSON.parse(document.getElementById("repospec-data").textContent);
  const INLINE = ${inline ? "true" : "false"};

  const nodeById = new Map(DATA.nodes.map((n) => [n.id, n]));
  const diagById = new Map(DATA.diagrams.map((d) => [d.id, d]));
  const invById = new Map(DATA.invariants.map((i) => [i.id, i]));
  const moduleById = new Map((DATA.modules || []).map((m) => [m.id, m]));
  const layerDiagByOwner = new Map();
  const moduleDiagByOwner = new Map();
  for (const d of DATA.diagrams) {
    if (d.category === "layers" && d.ownerId) layerDiagByOwner.set(d.ownerId, d);
    if (d.category === "modules" && d.ownerId) moduleDiagByOwner.set(d.ownerId, d);
  }
  const moduleDiags = DATA.diagrams.filter((d) => d.category === "modules");
  const behaviorDiags = DATA.diagrams.filter((d) => d.category === "behavior");
  const deliveryDiag = DATA.diagrams.find((d) => d.category === "delivery") || null;
  const runtimeDiag = DATA.diagrams.find((d) => d.category === "runtime") || DATA.diagrams[0] || null;
  const packagesDiag = DATA.diagrams.find((d) => d.category === "packages") || null;
  const domainsDiag = DATA.diagrams.find((d) => d.category === "domains") || null;

  const nonTestUnits = DATA.nodes.filter((n) => n.kind === "app" || n.kind === "package" || n.kind === "native_app");
  const isSingleUnitAtlas = nonTestUnits.length <= 1 && moduleDiags.length >= 1;
  const isLibraryDefault =
    !isSingleUnitAtlas &&
    behaviorDiags.length > 0 &&
    DATA.entities.length === 0 &&
    DATA.nodes.filter((n) => n.kind === "app").length <= 1;

  const state = {
    tab: DATA.commitDiff ? "diff" : isLibraryDefault ? "behavior" : "map",
    mapMode: "runtime",
    viewMode: "flow",
    showAllEdges: false,
    dsmViolOnly: false,
    dataIssuesOnly: false,
    showGuide: false,
    diffMode: "overlay",
    diffDiagramId: DATA.commitDiff?.diagrams?.[0]?.id || null,
    activeLayerDiagId: isSingleUnitAtlas ? moduleDiags[0].id : null,
    activeFolder: null,
    activeFileGraph: null,
    codeFocusLine: 1,
    codeFullFile: false,
    activeBehaviorId: behaviorDiags[0]?.id || null,
    selectedNodeId: null,
    selectedEdgeId: null,
    focusMode: false,
    activeTraceId: null,
    dataFilter: "",
    dataSubtab: "entities",
    checksFilter: "active",
    search: "",
    tx: 0,
    ty: 0,
    scale: 1,
    fittedDiagId: null,
    justNavigated: false,
  };
  ${renderDrilldownClientScript()}
  ${renderFileCallGraphClientScript()}
  ${renderGuidesClientScript()}
  ${renderDiffClientScript()}

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortPkg(s) {
    return String(s || "").replace(new RegExp("^@[^/]+/"), "");
  }

  function githubUrl(relFile, line) {
    if (!DATA.repo.remote || !DATA.repo.commitSha || !relFile || relFile === ".") return null;
    const base = DATA.repo.scopeRootRel && DATA.repo.scopeRootRel !== "."
      ? (DATA.repo.scopeRootRel + "/" + relFile).replace(new RegExp("\\\\\\\\", "g"), "/")
      : relFile;
    const parts = [];
    for (const seg of base.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    const cleanPath = parts.join("/");
    return DATA.repo.remote + "/blob/" + DATA.repo.commitSha + "/" + cleanPath + (line ? "#L" + line : "");
  }

  function provenanceLinksHtml(file, line) {
    if (!file || file === ".") return "";
    const gh = githubUrl(file, line);
    const label = esc(file + (line ? ":" + line : ""));
    if (gh) {
      return '<span class="links-row"><span class="mono muted">' + label + '</span><a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">GitHub ↗</a></span>';
    }
    return '<span class="mono muted">' + label + '</span>';
  }

  function renderDisclosure(opts) {
    const toneCls = opts.tone ? " tone-" + opts.tone : "";
    const openAttr = opts.open ? " open" : "";
    const badgeHtml = opts.badge !== undefined && opts.badge !== ""
      ? '<span class="badge ' + (opts.badgeClass || "b-info") + '">' + esc(opts.badge) + "</span>"
      : "";
    const metaHtml = opts.meta ? '<div class="disc-meta">' + esc(opts.meta) + "</div>" : "";
    return (
      '<details class="disc' + toneCls + '"' + openAttr + ">" +
      '<summary class="disc-sum">' +
      '<span class="disc-left"><span class="disc-chev">▸</span><span style="min-width:0;display:flex;flex-direction:column;gap:1px"><span class="disc-title">' + esc(opts.title) + "</span>" + metaHtml + "</span></span>" +
      badgeHtml +
      "</summary>" +
      '<div class="disc-body">' + opts.bodyHtml + "</div>" +
      "</details>"
    );
  }

  function sortInvariantsByUrgency(list) {
    const rank = { fail: 0, warn: 1, pass: 2, na: 3 };
    return [...list].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (b.violationCount || 0) - (a.violationCount || 0));
  }

  function renderFindingDisclosure(inv, opts) {
    const matchingEv = opts.filterEv ? inv.evidence.filter(opts.filterEv) : inv.evidence;
    const shownEv = (matchingEv.length > 0 ? matchingEv : inv.evidence).slice(0, 6);
    const hasAnchor = Boolean(shownEv.some((e) => e.anchors && e.anchors.length > 0) || inv.evidence.some((e) => e.anchors && e.anchors.length > 0));
    const tone = inv.status === "fail" ? "fail" : inv.status === "warn" ? "warn" : "pass";
    const evRows = shownEv.map((ev) => {
      const openFileBtn = ddIdxByPath.has(ev.file) ? '<button class="tbtn" data-open-file="' + esc(ev.file) + '" title="Open file in Folder Context Map">Inspect file</button>' : "";
      return '<div class="ev-item"><div>' + esc(ev.detail) + '</div><div class="links-row">' + provenanceLinksHtml(ev.file, ev.line) + openFileBtn + "</div></div>";
    }).join("");
    const bodyHtml =
      '<div class="muted">' + esc(inv.statement) + "</div>" +
      (inv.why ? '<div class="why-note"><strong>Why it matters:</strong> ' + esc(inv.why) + "</div>" : "") +
      evRows +
      (inv.fix ? '<div class="fix-note"><strong>How to fix:</strong> ' + esc(inv.fix) + "</div>" : "") +
      '<div class="links-row">' +
      (hasAnchor ? '<button class="tbtn" data-show-inv="' + esc(inv.id) + '" title="Jump to this violation on the architecture map">Highlight on map</button>' : "") +
      '<button class="tbtn" data-copy-inv="' + esc(inv.id) + '" title="Copy rule, evidence, and fix instructions as Markdown">Copy Fix Brief</button>' +
      (opts.hideChecksLink || state.tab === "checks" ? "" : '<button class="tbtn" data-jump-checks="1">Open in Checks</button>') +
      "</div>";
    return renderDisclosure({
      title: inv.name,
      meta: inv.id + " · " + inv.rung + (inv.status === "fail" ? " · BLOCKER" : inv.status === "warn" ? " · WARNING" : ""),
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

  function capBadgeClass(cap) {
    if (cap === "DB") return "b-purple";
    if (cap === "HTTP") return "b-cyan";
    if (cap === "FS") return "b-warn";
    if (cap === "PROC") return "b-fail";
    if (cap === "ENV") return "b-info";
    return "b-pass";
  }

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
        '<div class="sec"><div class="sec-title"><span>Largest Files (click to inspect)</span></div>' +
        biggest.map((i) => {
          const f = DD_FILES[i];
          return '<div class="row"><span class="row-link mono" data-select-node="' + esc("file:" + f.p) + '">' + esc(f.p.split("/").pop()) + '</span><span class="mono muted">' + f.l + "L · " + f.e + " exp</span></div>";
        }).join("") + "</div>"
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
      '<div class="sec"><div class="sec-title"><span>Needs Attention' + esc(findingsScopeLabel) + " (" + displayInvs.length + ')</span><span class="muted">sorted by severity</span></div>' +
      (displayInvs.length === 0
        ? '<div class="muted" style="font-size:12px">All applicable SQL invariants pass.</div>'
        : (fails.length > 0 ? '<div class="sev-group-hdr fail"><span>Blockers (' + fails.length + ' FAIL)</span><span>act first</span></div>' + fails.slice(0, 6).map((inv, i) => renderFindingDisclosure(inv, { open: i === 0 })).join("") : "") +
          (warns.length > 0 ? '<div class="sev-group-hdr warn"><span>Warnings (' + warns.length + " WARN)</span></div>" + warns.slice(0, 6).map((inv) => renderFindingDisclosure(inv, { open: false })).join("") : "")) +
      "</div>";

    const scopedTraces = scopedUnitSlug ? DATA.traces.filter((t) => t.diagramId === curDiag?.id) : DATA.traces;
    const traceHtml = scopedTraces.length > 0
      ? '<div class="sec"><div class="sec-title">Static Paths (click to trace)</div>' +
        scopedTraces.map((t) => {
          const active = state.activeTraceId === t.id ? " active" : "";
          return '<div class="trace-card' + active + '" data-trace="' + esc(t.id) + '">' +
            '<div style="font-weight:600;font-size:12px">' + esc(t.title) + " (" + t.steps.length + " steps)</div>" +
            '<div class="trace-note">' + esc(t.disclaimer) + "</div></div>";
        }).join("") +
        "</div>"
      : "";

    const drawerHeading = scopedUnitSlug ? scopedUnitSlug + " Briefing" : "Architecture Briefing";
    const drawerSub = scopedUnitSlug
      ? (curDiag?.category === "layers" ? "Clean Architecture Layers" : "Module Dependency Topology") + " · double-click any folder with ›"
      : DATA.repo.name + " · " + DATA.repo.languages.join(", ");

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(drawerHeading) + '</div><div class="drawer-sub">' + esc(drawerSub) + "</div></div></div>" +
      (storyHtml || '<div style="font-size:12px;color:#cbd5e1">' + shapeLine + "</div>") +
      tangleBanner +
      findingsHtml +
      traceHtml +
      (!scopedUnitSlug
        ? '<div class="sec"><div class="sec-title">System Makeup</div>' +
          (apps.length > 0 ? '<div class="row"><span class="muted">Entry / Apps</span><span class="mono">' + esc(apps.slice(0, 4).map((a) => shortPkg(a.label)).join(", ")) + (apps.length > 4 ? " +" + (apps.length - 4) : "") + "</span></div>" : "") +
          (pkgs.length > 0 ? '<div class="row"><span class="muted">Libraries</span><span class="mono">' + esc(pkgs.slice(0, 4).map((p) => shortPkg(p.label)).join(", ")) + (pkgs.length > 4 ? " +" + (pkgs.length - 4) : "") + "</span></div>" : "") +
          (stores.length > 0 ? '<div class="row"><span class="muted">State</span><span class="mono">' + esc(stores.map((s) => s.label).join(", ")) + " (" + DATA.summary.datastoreEntities + ")</span></div>" : "") +
          (exts.length > 0 ? '<div class="row"><span class="muted">External</span><span class="mono">' + esc(exts.slice(0, 5).map((x) => x.label).join(", ")) + (exts.length > 5 ? " +" + (exts.length - 5) : "") + "</span></div>" : "") +
          (DATA.summary.govRules > 0 ? '<div class="row"><span class="muted">Gov Rules</span><span class="mono">' + DATA.summary.govRules + " scoped rules</span></div>" : "") +
          "</div>"
        : "")
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

    const actions = [
      ddFolderCount > 0
        ? '<button class="action-btn" data-open-folder="' + esc(mod.unitSlug + "::" + mod.name) + '">Open ' + esc(mod.name) + "/ (" + ddFolderCount + " files) →</button>"
        : subDiag
          ? '<button class="action-btn" data-open-layers="' + esc(subDiag.id) + '">Drill into ' + esc(mod.name) + "/ (" + subDiag.nodes.length + ")</button>"
          : "",
      '<button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + "</button>",
      '<button class="action-btn sec-btn" data-clear-sel="1">Briefing</button>',
    ].filter(Boolean).join(" ");

    const apiSec =
      '<div class="sec"><div class="sec-title"><span>Public API Surface (' + mod.exportCount + ')</span><span class="muted">' + depthRatio + "L/exp</span></div>" +
      (mod.topExports.length === 0
        ? '<div class="muted" style="font-size:11px">No public symbols exported (entry script or internal helper).</div>'
        : mod.topExports.map((sym) => {
            const gh = githubUrl(sym.file, sym.line);
            const loc = gh
              ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">:' + sym.line + " ↗</a>"
              : '<span class="mono muted">:' + sym.line + "</span>";
            return '<div class="api-row"><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sym.name) + '</span><span style="display:flex;gap:5px;align-items:center;flex-shrink:0"><span class="badge b-na">' + esc(sym.kind) + "</span>" + loc + "</span></div>";
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

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(mod.kind === "directory" ? mod.name + "/" : mod.name) + '</div><div class="drawer-sub">' + esc(mod.unitSlug + " · " + mod.language + " · " + mod.relPath) + "</div></div></div>" +
      pillsHtml +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + actions + "</div>" +
      apiSec +
      flowSec +
      filesSec
    );
  }

  function groupEdgesForInspector(edges, dir) {
    const groups = new Map();
    const labelMap = {
      calls_external: dir === "out" ? "Calls External Services" : "Called By",
      reads_writes: dir === "out" ? "Reads / Writes Datastore" : "Accessed By",
      depends_on: dir === "out" ? "Depends On Units" : "Depended On By",
      imports_layer: dir === "out" ? "Imports Layers" : "Imported By Layers",
      imports_domain: dir === "out" ? "Imports Domains" : "Imported By Domains",
      routes_to: dir === "out" ? "Routes To" : "Receives Traffic From",
      verifies: dir === "out" ? "Verifies" : "Verified By CI & Tests",
      deploys: dir === "out" ? "Deploys" : "Deployed By",
      builds_image: dir === "out" ? "Builds Image" : "Built By",
      governs: dir === "out" ? "Governs" : "Governed By Policies",
      analyzes: dir === "out" ? "Analyzes" : "Analyzed By",
    };
    for (const e of edges) {
      if (e.kind === "contains") continue;
      const key = dir + ":" + e.kind;
      const cur = groups.get(key) || { title: labelMap[e.kind] || ((dir === "out" ? "→ " : "← ") + e.kind), kind: e.kind, dir, items: [], hasViol: false };
      cur.items.push(e);
      if (e.violation) cur.hasViol = true;
      groups.set(key, cur);
    }
    return Array.from(groups.values()).sort((a, b) => (b.hasViol ? 1 : 0) - (a.hasViol ? 1 : 0) || b.items.length - a.items.length);
  }

  function renderNodeInspector(nodeId) {
    const folderInsp = renderFolderNodeInspector(nodeId, activeDiagram());
    if (folderInsp) return folderInsp;
    if (moduleById.has(nodeId) || nodeId.startsWith("mod:") || nodeId.startsWith("sub:")) {
      return renderModuleInspector(nodeId);
    }
    const node = nodeById.get(nodeId);
    if (!node) return renderBriefingDrawer();
    const outEdges = DATA.edges.filter((e) => e.from === nodeId);
    const inEdges = DATA.edges.filter((e) => e.to === nodeId);
    const modDiag = moduleDiagByOwner.get(nodeId);
    const layerDiag = layerDiagByOwner.get(nodeId);
    const linkedLayerMod = node.kind === "code_layer" && node.group ? moduleById.get("mod:" + node.group + ":" + node.label) : null;
    const layerFolderCount = node.kind === "code_layer" && node.group ? unitHasFolderFiles(node.group, node.label) : 0;
    const unitName = node.label;
    const unitSlug = shortPkg(unitName);
    const unitDir = typeof node.meta?.dir === "string" ? node.meta.dir : "";
    const unitEndpoints = DATA.surfaces.endpoints.filter((ep) => ep.unit === unitName);
    const unitEnvs = DATA.surfaces.envBindings.filter((eb) => eb.units.includes(unitName));
    const unitGovs = DATA.surfaces.govRules.filter((g) => !g.scopePrefix || (unitDir && (unitDir === g.scopePrefix || unitDir.startsWith(g.scopePrefix + "/"))));

    const actions = [
      layerFolderCount > 0 ? '<button class="action-btn" data-open-folder="' + esc(node.group + "::" + node.label) + '">Open ' + esc(node.label) + "/ (" + layerFolderCount + " files) →</button>" : "",
      modDiag ? '<button class="action-btn" data-open-layers="' + esc(modDiag.id) + '">Open Modules (' + modDiag.nodes.length + ")</button>" : "",
      layerDiag ? '<button class="action-btn sec-btn" data-open-layers="' + esc(layerDiag.id) + '">Layers (' + layerDiag.nodes.length + ")</button>" : "",
      '<button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + "</button>",
      '<button class="action-btn sec-btn" data-clear-sel="1">Briefing</button>',
    ].filter(Boolean).join(" ");

    const findingsList = node.findings || [];
    const findingsSec = findingsList.length > 0
      ? '<div class="sec"><div class="sec-title"><span>1. Active Findings (' + findingsList.length + ')</span><span class="muted">expandable</span></div>' +
        findingsList.map((f) => {
          const inv = invById.get(f.ruleId);
          if (!inv) {
            return renderDisclosure({
              title: f.ruleId,
              badge: f.count,
              badgeClass: f.severity === "error" ? "b-fail" : "b-warn",
              tone: f.severity === "error" ? "fail" : "warn",
              open: false,
              bodyHtml: '<div class="muted">Invariant rule ' + esc(f.ruleId) + " reported " + f.count + " hit(s).</div>",
            });
          }
          return renderFindingDisclosure(inv, {
            countOverride: f.count,
            open: f.severity === "error" || findingsList.length <= 2,
            filterEv: (ev) =>
              ev.targetNodeId === nodeId ||
              ev.edgeFromId === nodeId ||
              ev.edgeToId === nodeId ||
              (unitDir && ev.file.startsWith(unitDir + "/")) ||
              ev.subject.includes(unitSlug),
          });
        }).join("") +
        "</div>"
      : "";

    const connGroups = [...groupEdgesForInspector(outEdges, "out"), ...groupEdgesForInspector(inEdges, "in")];
    const connSec =
      '<div class="sec"><div class="sec-title"><span>' + (findingsList.length > 0 ? "2. " : "1. ") + "Connections (" + connGroups.reduce((s, g) => s + g.items.length, 0) + ')</span><span class="muted">grouped</span></div>' +
      (connGroups.length === 0
        ? '<div class="muted" style="font-size:11px">No direct graph connections indexed.</div>'
        : connGroups.map((g, gi) => {
            const rows = g.items
              .sort((a, b) => (b.violation ? 1 : 0) - (a.violation ? 1 : 0) || (b.weight || 1) - (a.weight || 1))
              .slice(0, 25)
              .map((e) => {
                const peerId = g.dir === "out" ? e.to : e.from;
                const peerLabel = shortPkg(nodeById.get(peerId)?.label || peerId);
                const arrow = g.dir === "out" ? "→ " : "← ";
                const extra = e.violation ? '<span class="badge b-fail">violation</span>' : (e.weight && e.weight > 1 ? '<span class="muted mono">' + e.weight + "</span>" : "");
                return '<div class="row"><span class="row-link mono" data-select-node="' + esc(peerId) + '">' + arrow + esc(peerLabel) + "</span>" + extra + "</div>";
              }).join("");
            const more = g.items.length > 25 ? '<div class="muted" style="font-size:10px">+' + (g.items.length - 25) + " more</div>" : "";
            return renderDisclosure({
              title: g.title,
              badge: g.items.length,
              badgeClass: g.hasViol ? "b-fail" : g.kind === "verifies" ? "b-pass" : "b-info",
              tone: g.hasViol ? "fail" : g.kind === "verifies" ? "pass" : "info",
              open: g.hasViol || (gi === 0 && g.items.length <= 8),
              bodyHtml: rows + more,
            });
          }).join("")) +
      "</div>";

    let surfaceItemsHtml = "";
    if (unitEndpoints.length > 0) {
      const byPrefix = new Map();
      for (const ep of unitEndpoints) {
        const segs = ep.path.split("/").filter(Boolean);
        const prefix = segs.length >= 2 && new RegExp("^v\\d+$", "i").test(segs[0]) ? "/" + segs[0] + "/" + segs[1] : (segs[0] ? "/" + segs[0] : "/");
        const list = byPrefix.get(prefix) || [];
        list.push(ep);
        byPrefix.set(prefix, list);
      }
      const prefixGroups = Array.from(byPrefix.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      surfaceItemsHtml += renderDisclosure({
        title: "HTTP Endpoints (" + prefixGroups.length + " groups)",
        meta: unitEndpoints.some((e) => e.source === "openapi") ? "OpenAPI contract + mounted routes" : "AST routes",
        badge: unitEndpoints.length,
        badgeClass: "b-info",
        tone: "info",
        open: false,
        bodyHtml: prefixGroups.slice(0, 14).map(([pref, eps]) =>
          renderDisclosure({
            title: pref,
            badge: eps.length,
            badgeClass: "b-info",
            open: false,
            bodyHtml: eps.slice(0, 15).map((ep) =>
              '<div class="row"><span class="mono">' + esc(ep.method + " " + ep.path) + '</span><span class="badge ' + (ep.authGuard && ep.authGuard !== "public" ? "b-pass" : "b-warn") + '">' + esc(ep.authGuard || "unannotated") + "</span></div>"
            ).join("") + (eps.length > 15 ? '<div class="muted">+' + (eps.length - 15) + " more</div>" : ""),
          })
        ).join(""),
      });
    }
    if (unitEnvs.length > 0) {
      const secrets = unitEnvs.filter((x) => x.isSecret);
      const configs = unitEnvs.filter((x) => !x.isSecret);
      surfaceItemsHtml += renderDisclosure({
        title: "Environment & Secrets",
        meta: secrets.length + " secrets · " + configs.length + " config",
        badge: unitEnvs.length,
        badgeClass: secrets.length > 0 ? "b-warn" : "b-info",
        tone: secrets.length > 0 ? "warn" : "info",
        open: false,
        bodyHtml: unitEnvs.slice(0, 24).map((x) =>
          '<div class="row"><span class="mono">' + esc(x.name) + '</span><span class="badge ' + (x.isSecret ? "b-warn" : "b-na") + '">' + (x.isSecret ? "secret" : "config") + "</span></div>"
        ).join("") + (unitEnvs.length > 24 ? '<div class="muted">+' + (unitEnvs.length - 24) + " more (see Data tab)</div>" : ""),
      });
    }
    const surfaceSec = surfaceItemsHtml
      ? '<div class="sec"><div class="sec-title">Surfaces</div>' + surfaceItemsHtml + "</div>"
      : "";

    const govSec =
      '<div class="sec"><div class="sec-title">Governance (' + unitGovs.length + ")</div>" +
      (unitGovs.length === 0
        ? '<div class="muted" style="font-size:11px">No scoped governance rules indexed.</div>'
        : unitGovs.slice(0, 8).map((g) => {
            const scopeTag = g.scopePrefix ? g.scopePrefix : "repo root";
            const bullets = g.rationale ? g.rationale.split(" | ").filter(Boolean) : [];
            const body =
              '<div class="muted">' + esc(g.text) + "</div>" +
              (bullets.length > 0 ? bullets.map((b) => '<div class="ev-item">• ' + esc(b) + "</div>").join("") : "") +
              provenanceLinksHtml(g.file, g.line);
            return renderDisclosure({
              title: (g.symbol || g.kind) + " · " + scopeTag,
              badge: g.kind,
              badgeClass: "b-na",
              open: false,
              bodyHtml: body,
            });
          }).join("")) +
      "</div>";

    const layerAnatomySec = linkedLayerMod
      ? '<div class="sec"><div class="sec-title"><span>Folder Anatomy (' + linkedLayerMod.fileCount + ' files)</span><span class="muted">' + linkedLayerMod.lines + "L · " + linkedLayerMod.exportCount + " exp</span></div>" +
        '<div class="pill-row">' + linkedLayerMod.capabilities.map((c) => '<span class="badge ' + capBadgeClass(c) + '">' + esc(c) + "</span>").join("") + "</div>" +
        renderDisclosure({
          title: "Files in " + linkedLayerMod.name + "/ (click any file)",
          badge: linkedLayerMod.fileCount,
          badgeClass: "b-info",
          open: linkedLayerMod.fileCount <= 8,
          bodyHtml: linkedLayerMod.files.slice(0, 20).map((f) =>
            '<div class="row"><span class="row-link mono" data-open-file="' + esc(f.file) + '">' + esc(f.file.split("/").pop()) + '</span><span class="mono muted">' + f.lines + "L · " + f.exports + " exp</span></div>"
          ).join(""),
        }) +
        "</div>"
      : "";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(shortPkg(node.label)) + '</div><div class="drawer-sub">' + esc(node.kind) + (node.meta?.archetype ? " · " + esc(node.meta.archetype) : "") + (node.meta?.layerAxis ? " · " + esc(node.meta.layerAxis) : "") + "</div></div></div>" +
      provenanceLinksHtml(node.provenance?.file, node.provenance?.line) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + actions + "</div>" +
      findingsSec +
      layerAnatomySec +
      connSec +
      surfaceSec +
      govSec
    );
  }

  ${renderTablesClientScript()}

  ${renderCameraClientScript()}

  function clearHoverSpotlight() {
    const svg = document.getElementById("diagram-svg");
    if (svg) {
      svg.classList.remove("hover-focus");
      svg.querySelectorAll(".hover-active").forEach((el) => el.classList.remove("hover-active"));
      svg.querySelectorAll(".hover-out,.hover-in,.hover-viol").forEach((el) => el.classList.remove("hover-out", "hover-in", "hover-viol"));
    }
    const tip = document.getElementById("edge-tooltip");
    if (tip) tip.style.display = "none";
  }

  function applyNodeHoverSpotlight(nodeId) {
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    clearHoverSpotlight();
    svg.classList.add("hover-focus");
    const connected = new Set([nodeId]);
    const edgeEls = Array.from(svg.querySelectorAll("[data-edge]"));
    if (nodeId.startsWith("sym:")) {
      const downReach = new Set([nodeId]);
      const upReach = new Set([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const el of edgeEls) {
          const fr = el.getAttribute("data-from");
          const to = el.getAttribute("data-to");
          if (downReach.has(fr) && to && !downReach.has(to)) { downReach.add(to); changed = true; }
          if (upReach.has(to) && fr && !upReach.has(fr)) { upReach.add(fr); changed = true; }
        }
      }
      for (const el of edgeEls) {
        const fr = el.getAttribute("data-from");
        const to = el.getAttribute("data-to");
        if (downReach.has(fr) && downReach.has(to)) {
          connected.add(fr); connected.add(to); el.classList.add("hover-out");
        } else if (upReach.has(fr) && upReach.has(to)) {
          connected.add(fr); connected.add(to); el.classList.add("hover-in");
        }
      }
    } else {
      for (const el of edgeEls) {
        const fr = el.getAttribute("data-from");
        const to = el.getAttribute("data-to");
        const viol = el.getAttribute("data-viol") === "1";
        if (fr === nodeId || to === nodeId) {
          connected.add(fr);
          connected.add(to);
          if (viol) el.classList.add("hover-viol");
          else if (fr === nodeId) el.classList.add("hover-out");
          else el.classList.add("hover-in");
        }
      }
    }
    svg.querySelectorAll("[data-node]").forEach((el) => {
      if (connected.has(el.getAttribute("data-node"))) el.classList.add("hover-active");
    });
  }

  function showEdgeTooltip(ev, diag, edgeId) {
    const tip = document.getElementById("edge-tooltip");
    const shell = document.getElementById("canvas-shell");
    if (!tip || !shell) return;
    const e = diag.edges.find((x) => x.id === edgeId);
    if (!e) return;
    const labelFor = (id) => {
      const m = moduleById.get(id);
      if (m) return m.kind === "directory" ? m.name + "/" : m.name;
      const dn = diag.nodes.find((n) => n.id === id);
      if (dn) return dn.label;
      return shortPkg(nodeById.get(id)?.label || id);
    };
    const fromL = labelFor(e.from);
    const toL = labelFor(e.to);
    const parts = [fromL + (e.bidirectional ? " ⇄ " : " → ") + toL];
    if (e.weight) parts.push(e.weight + " ref" + (e.weight === 1 ? "" : "s"));
    if (e.violation && e.ruleIds?.length) parts.push("⚠ " + e.ruleIds[0]);
    tip.textContent = parts.join(" · ");
    const r = shell.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(8, ev.clientX - r.left + 12), Math.max(8, r.width - 280)) + "px";
    tip.style.top = Math.max(8, ev.clientY - r.top - 34) + "px";
    tip.style.display = "block";
  }

  function render() {
    const rawDiag = activeDiagram();
    const diag = rawDiag && state.focusMode && state.selectedNodeId ? buildBowTieLayout(rawDiag, state.selectedNodeId) : rawDiag;
    const nextFitKey = diag ? diag.id + (state.focusMode ? ":f" : "") : null;
    if (diag && state.fittedDiagId !== nextFitKey) {
      state.justNavigated = state.fittedDiagId !== null;
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      syncCameraTargetImmediate();
      state.fittedDiagId = nextFitKey;
    } else {
      state.justNavigated = false;
    }

    const v = DATA.verification;
    const statusHtml =
      '<button class="s-dot ' + (v.invariantsFailed > 0 ? "err status-fail" : "ok status-pass") + '" data-jump-checks-filter="fail" title="Click to view failing architectural checks">' + v.invariantsFailed + " fail</button>" +
      (v.invariantsWarned > 0 ? '<button class="s-dot warn status-warn" data-jump-checks-filter="warn" title="Click to view architectural warnings">' + v.invariantsWarned + " warn</button>" : "") +
      "<span>" + DATA.summary.indexedSourceFiles + " files · " + v.directTestCoveragePct + "% tested</span>" +
      (DATA.repo.commitSha ? "<span>@" + esc(DATA.repo.commitSha.slice(0, 7)) + "</span>" : "");

    const tabs = [
      { id: "diff", label: "Diff (" + (DATA.commitDiff?.baseSha || "") + "→" + (DATA.commitDiff?.headSha || "") + ")", show: Boolean(DATA.commitDiff) },
      { id: "map", label: "Map", show: Boolean(runtimeDiag) },
      { id: "behavior", label: "Behavior (" + behaviorDiags.length + ")", show: behaviorDiags.length > 0 },
      { id: "data", label: "Data (" + DATA.entities.length + ")", show: DATA.entities.length > 0 || DATA.surfaces.endpoints.length > 0 || DATA.surfaces.envBindings.length > 0 },
      { id: "delivery", label: "Delivery", show: Boolean(deliveryDiag) },
      { id: "checks", label: "Checks (" + (v.invariantsFailed + v.invariantsWarned) + ")", show: true },
    ].filter((t) => t.show);

    let subNav = "";
    if (state.tab === "map") {
      if (state.activeFileGraph) {
        const fgPath = state.activeFileGraph;
        const fIdx = ddIdxByPath.get(fgPath);
        const fObj = fIdx !== undefined ? DD_FILES[fIdx] : null;
        const crumbs = ['<button class="pill-btn" data-back-map="1">System</button>'];
        if (fObj) {
          const unitModId = "modules:" + fObj.u;
          if (diagById.has(unitModId)) {
            crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(unitModId) + '">' + esc(fObj.u) + "</button>");
          }
          const logical = ddLogicalRel(fObj, ddUnitPeelPrefix(fObj.u));
          const segs = logical.split("/").filter(Boolean);
          let acc = "";
          for (let si = 0; si < segs.length - 1; si += 1) {
            acc = acc ? acc + "/" + segs[si] : segs[si];
            crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-folder="' + esc(fObj.u + "::" + acc) + '">' + esc(segs[si]) + "/</button>");
          }
        }
        crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(fgPath.split("/").pop()) + "</span>");
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else if (state.activeFolder) {
        const af = state.activeFolder;
        const crumbs = ['<button class="pill-btn" data-back-map="1">System</button>'];
        const unitModDiag = diagById.get("modules:" + af.unitSlug);
        const unitLayerDiag = diagById.get("layers:" + af.unitSlug);
        const unitReturnId = af.returnDiagId || unitModDiag?.id || unitLayerDiag?.id || null;
        if (unitReturnId) {
          crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(unitReturnId) + '">' + esc(af.unitSlug) + "</button>");
        } else {
          crumbs.push('<span class="crumb-sep">›</span><span class="mono muted">' + esc(af.unitSlug) + "</span>");
        }
        const segs = af.folderPath.split("/").filter(Boolean);
        let acc = "";
        segs.forEach((seg, si) => {
          acc = acc ? acc + "/" + seg : seg;
          if (si < segs.length - 1) {
            crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-folder="' + esc(af.unitSlug + "::" + acc) + '">' + esc(seg) + "/</button>");
          } else {
            crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(seg) + "/</span>");
          }
        });
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else if (state.activeLayerDiagId) {
        const ld = diagById.get(state.activeLayerDiagId);
        const ownerModDiag = ld?.ownerId ? moduleDiagByOwner.get(ld.ownerId) : null;
        const ownerLayerDiag = ld?.ownerId ? layerDiagByOwner.get(ld.ownerId) : null;
        const parentDiag = ld?.parentDiagramId ? diagById.get(ld.parentDiagramId) : null;
        const crumbs = [];
        if (!isSingleUnitAtlas || runtimeDiag) {
          crumbs.push('<button class="pill-btn" data-back-map="1">System</button>');
        }
        if (parentDiag) {
          crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(parentDiag.id) + '">' + esc(parentDiag.id.replace(/^modules:/, "")) + "</button>");
        }
        if (ld) {
          const shortTitle = ld.category === "subsystem"
            ? ld.id.split(":").slice(2).join(":") + "/"
            : ld.id.replace(/^(?:modules|layers):/, "");
          crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(shortTitle) + "</span>");
        }
        if (ownerModDiag && ownerLayerDiag && ld && ld.category !== "subsystem") {
          crumbs.push('<span class="seg-group" style="margin-left:4px">' +
            '<button class="seg-btn' + (ld.category === "modules" ? " active" : "") + '" data-open-layers="' + esc(ownerModDiag.id) + '" title="Top-level module dependency graph ordered from entry points to foundations">Modules</button>' +
            '<button class="seg-btn' + (ld.category === "layers" ? " active" : "") + '" data-open-layers="' + esc(ownerLayerDiag.id) + '" title="Clean Architecture layers — red backward arrows highlight layer inversions">Layers</button>' +
            "</span>");
        }
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else {
        subNav = '<div class="sub-toggles">' +
          (moduleDiags.length === 1 ? '<button class="pill-btn" data-open-layers="' + esc(moduleDiags[0].id) + '" title="Drill into top-level module topology">Modules (' + moduleDiags[0].nodes.length + ")</button>" : "") +
          '<button class="pill-btn' + (state.mapMode === "runtime" ? " active" : "") + '" data-map-mode="runtime" title="Apps, services, datastores, and external APIs flowing left-to-right">Runtime</button>' +
          (packagesDiag ? '<button class="pill-btn' + (state.mapMode === "packages" ? " active" : "") + '" data-map-mode="packages" title="Internal workspace package dependency graph">Packages</button>' : "") +
          (domainsDiag ? '<button class="pill-btn' + (state.mapMode === "domains" ? " active" : "") + '" data-map-mode="domains" title="Business domain coupling graph — red arrows show bidirectional coupling">Domains</button>' : "") +
          "</div>";
      }
    } else if (state.tab === "behavior" && behaviorDiags.length > 1) {
      subNav = '<div class="sub-toggles">' +
        behaviorDiags.slice(0, 8).map((b) => '<button class="pill-btn' + (state.activeBehaviorId === b.id ? " active" : "") + '" data-behavior-id="' + esc(b.id) + '">' + esc(b.title.split("—")[0]?.trim()) + "</button>").join("") +
        "</div>";
    }

    let bodyHtml = "";
    if (state.tab === "diff") {
      bodyHtml = renderDiffTab();
    } else if (state.tab === "data") {
      bodyHtml = renderDataTab();
    } else if (state.tab === "checks") {
      bodyHtml = renderChecksTab();
    } else if (diag) {
      const canMatrix = supportsMatrix(diag) && !state.focusMode;
      const inMatrix = canMatrix && state.viewMode === "matrix";
      const detailCount = diag.edges.filter((e) => e.tier === "detail" && !e.violation).length;
      const visibleSpineCount = diag.edges.length - detailCount;

      const drawerHtml = state.activeFileGraph
        ? renderFileCallGraphDrawer(state.activeFileGraph, diag)
        : state.selectedEdgeId
          ? renderEdgeInspector(diag, state.selectedEdgeId)
          : state.selectedNodeId
            ? renderNodeInspector(state.selectedNodeId)
            : renderBriefingDrawer();

      const trayHtml = !inMatrix && diag.unconnectedNodes && diag.unconnectedNodes.length > 0
        ? '<div class="tray" title="Units indexed without static runtime edges to the core graph — click any chip to inspect"><span>No edges extracted:</span>' +
          diag.unconnectedNodes.map((u) => '<span class="tray-chip" data-select-node="' + esc(u.id) + '">' + esc(u.label) + "</span>").join("") +
          "</div>"
        : "";

      const viewToggleHtml = canMatrix
        ? '<span class="seg-group">' +
          '<button class="seg-btn' + (!inMatrix ? " active" : "") + '" data-view-mode="flow" title="Visual node-and-wire dependency flow">Flow</button>' +
          '<button class="seg-btn' + (inMatrix ? " active" : "") + '" data-view-mode="matrix" title="Design Structure Matrix: grid showing every dependency with zero crossing lines">Matrix (DSM)</button>' +
          "</span>"
        : "";

      const wireToggleHtml = !inMatrix && detailCount > 0
        ? '<button class="tbtn' + (state.showAllEdges ? " active" : "") + '" data-toggle-wires="1" title="Spine hides low-weight wires until hover; click to show all wires">' + (state.showAllEdges ? "All wires (" + diag.edges.length + ")" : "Spine (" + visibleSpineCount + "/" + diag.edges.length + ")") + "</button>"
        : "";

      const canStepUp = Boolean(state.activeFileGraph || state.activeFolder || (state.activeLayerDiagId && !isSingleUnitAtlas));
      const hudTopLeft = subNav ? '<div class="hud-pill hud-top-left">' + subNav + "</div>" : "";
      const hudTopRight =
        '<div class="hud-pill hud-top-right">' +
        viewToggleHtml +
        wireToggleHtml +
        (state.selectedNodeId && !inMatrix ? '<button class="tbtn' + (state.focusMode ? " active" : "") + '" data-toggle-focus="1" title="Bow-Tie focus: isolate only direct callers and dependencies of the selected card">Focus <span class="keycap">F</span></button>' : "") +
        '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read this graph">?</button>' +
        "</div>";
      const hudBottomLeft = !inMatrix
        ? '<div class="hud-pill hud-bottom-left">' +
          '<button class="tbtn" data-zoom="in" title="Zoom in (+)">+</button>' +
          '<button class="zoom-pct" id="zoom-pct" data-zoom="fit" title="Reset zoom (0)">' + Math.round(state.scale * 100) + "%</button>" +
          '<button class="tbtn" data-zoom="out" title="Zoom out (-)">−</button>' +
          '<button class="tbtn" data-zoom="fit" title="Fit view (0)">Fit</button>' +
          (canStepUp ? '<button class="tbtn" data-step-up="1" title="Up one level (Backspace)">↑</button>' : "") +
          "</div>"
        : "";
      const hudLegend = !inMatrix
        ? '<div class="hud-pill hud-bottom-center">' + renderLegend(diag).replace('<div class="legend">', "").replace("</div>", "") + '<span class="leg-item"><span class="keycap">2×</span> Drill in</span></div>'
        : "";

      bodyHtml =
        '<div class="workspace">' +
        '<div class="canvas-panel">' +
        hudTopLeft +
        hudTopRight +
        renderInfoPopoverHtml() +
        hudBottomLeft +
        hudLegend +
        (!inMatrix ? renderMinimapHtml(diag) : "") +
        trayHtml +
        '<div class="edge-tooltip" id="edge-tooltip"></div>' +
        '<div class="canvas-shell' + (inMatrix ? " matrix-mode" : "") + '" id="canvas-shell">' +
        (inMatrix ? renderMatrixView(diag) : renderDiagramSvg(diag)) +
        "</div>" +
        "</div>" +
        '<div class="drawer" id="drawer">' + drawerHtml + "</div>" +
        "</div>";
    }

    document.getElementById("app").innerHTML =
      '<div class="studio-bar">' +
      '<div class="bar-left">' +
      '<div class="brand"><span class="brand-dot"></span><span>' + esc(DATA.repo.name) + '</span><span class="brand-ver">v' + esc(DATA.schemaVersion) + "</span></div>" +
      '<div class="tabs">' +
      tabs.map((t) => '<button class="tab' + (state.tab === t.id ? " active" : "") + '" data-tab="' + esc(t.id) + '">' + esc(t.label) + "</button>").join("") +
      "</div>" +
      "</div>" +
      '<div class="bar-right">' +
      '<div class="status-pills">' + statusHtml + "</div>" +
      '<div class="search-wrap"><input class="search" id="global-search" placeholder="Jump to module, file, symbol..." value="' + esc(state.search) + '" /><span class="search-kbd">/</span>' + renderSearchDropdown() + "</div>" +
      "</div>" +
      "</div>" +
      bodyHtml;
    applyTransform();
    const focusEl = document.querySelector("#code-viewer-box .focus-line");
    if (focusEl && typeof focusEl.scrollIntoView === "function") {
      focusEl.scrollIntoView({ block: "center" });
    }
  }

  const appEl = document.getElementById("app");

  appEl.addEventListener("mouseover", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const svgNode = target.closest("[data-node]");
    if (svgNode) {
      const nid = svgNode.getAttribute("data-node");
      if (nid) applyNodeHoverSpotlight(nid);
      return;
    }
    const drawerLink = target.closest(".drawer [data-select-node]");
    if (drawerLink) {
      const nid = drawerLink.getAttribute("data-select-node");
      if (nid) applyNodeHoverSpotlight(nid);
      return;
    }
    const svgEdge = target.closest("g[data-edge]");
    if (svgEdge) {
      const rawDiag = activeDiagram();
      const diag = rawDiag && state.focusMode && state.selectedNodeId ? buildBowTieLayout(rawDiag, state.selectedNodeId) : rawDiag;
      const eid = svgEdge.getAttribute("data-edge");
      if (diag && eid) showEdgeTooltip(ev, diag, eid);
      return;
    }
    const dsmCell = target.closest("td[data-dsm-r]");
    if (dsmCell) {
      const r = dsmCell.getAttribute("data-dsm-r");
      const c = dsmCell.getAttribute("data-dsm-c");
      appEl.querySelectorAll(".dsm-row-th.hl,.dsm-col-th.hl").forEach((el) => el.classList.remove("hl"));
      appEl.querySelector('[data-dsm-row="' + r + '"]')?.classList.add("hl");
      appEl.querySelector('[data-dsm-col="' + c + '"]')?.classList.add("hl");
    }
  });

  appEl.addEventListener("mouseout", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-node]") || target.closest("g[data-edge]") || target.closest(".drawer [data-select-node]")) {
      const rel = ev.relatedTarget;
      if (!(rel instanceof Element) || (!rel.closest("[data-node]") && !rel.closest("g[data-edge]") && !rel.closest(".drawer [data-select-node]"))) {
        clearHoverSpotlight();
      }
    }
    if (target.closest("td[data-dsm-r]")) {
      appEl.querySelectorAll(".dsm-row-th.hl,.dsm-col-th.hl").forEach((el) => el.classList.remove("hl"));
    }
  });

  let lastNodeClickId = null;
  let lastNodeClickAt = 0;

  function drillIntoNode(id) {
    if (!id) return false;
    const curDiag = activeDiagram();
    const diagNode = curDiag?.nodes.find((n) => n.id === id);
    if (id.startsWith("file:")) {
      const fPath = id.slice(5);
      if (ddIdxByPath.has(fPath)) {
        state.tab = "map";
        state.activeFileGraph = fPath;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        state.focusMode = false;
        state.codeFocusLine = 1;
        state.codeFullFile = false;
        ensureFileSourcesLoaded();
        render();
        return true;
      }
    }
    if (id.startsWith("folder:")) {
      const rest = id.slice(7);
      const colon = rest.indexOf(":");
      const uSlug = rest.slice(0, colon);
      const fPath = rest.slice(colon + 1);
      state.tab = "map";
      state.activeFolder = { unitSlug: uSlug, folderPath: fPath, returnDiagId: state.activeFolder?.returnDiagId || state.activeLayerDiagId };
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    if (diagNode?.ctxMeta?.folderPath && diagNode.ctxMeta.unitSlug) {
      state.tab = "map";
      state.activeFolder = { unitSlug: diagNode.ctxMeta.unitSlug, folderPath: diagNode.ctxMeta.folderPath, returnDiagId: state.activeFolder?.returnDiagId || state.activeLayerDiagId };
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    const mod = moduleById.get(id);
    if (mod && mod.kind === "directory") {
      if (unitHasFolderFiles(mod.unitSlug, mod.name) > 0) {
        state.tab = "map";
        state.activeFolder = { unitSlug: mod.unitSlug, folderPath: mod.name, returnDiagId: state.activeLayerDiagId };
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
        return true;
      }
      const subId = "subsystem:" + mod.unitSlug + ":" + mod.name;
      if (diagById.has(subId)) {
        state.tab = "map";
        state.activeFolder = null;
        state.activeLayerDiagId = subId;
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
        return true;
      }
    }
    const specNode = nodeById.get(id);
    if (specNode && specNode.kind === "code_layer" && specNode.group && unitHasFolderFiles(specNode.group, specNode.label) > 0) {
      state.tab = "map";
      state.activeFolder = { unitSlug: specNode.group, folderPath: specNode.label, returnDiagId: state.activeLayerDiagId };
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    const targetDiag = moduleDiagByOwner.get(id) || layerDiagByOwner.get(id) || null;
    if (targetDiag) {
      state.tab = "map";
      state.activeFolder = null;
      state.activeLayerDiagId = targetDiag.id;
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return true;
    }
    return false;
  }

  appEl.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const tabBtn = target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.getAttribute("data-tab") || "map";
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.activeFileGraph = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const mapModeBtn = target.closest("[data-map-mode]");
    if (mapModeBtn) {
      state.mapMode = mapModeBtn.getAttribute("data-map-mode") || "runtime";
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const viewModeBtn = target.closest("[data-view-mode]");
    if (viewModeBtn) {
      state.viewMode = viewModeBtn.getAttribute("data-view-mode") || "flow";
      state.focusMode = false;
      render();
      return;
    }

    if (target.closest("[data-toggle-wires]")) {
      state.showAllEdges = !state.showAllEdges;
      render();
      return;
    }

    const behBtn = target.closest("[data-behavior-id]");
    if (behBtn) {
      state.activeBehaviorId = behBtn.getAttribute("data-behavior-id");
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return;
    }

    function stepUpLevel() {
      if (state.activeFileGraph) {
        const prevFile = state.activeFileGraph;
        state.activeFileGraph = null;
        state.selectedNodeId = "file:" + prevFile;
        state.selectedEdgeId = null;
        state.focusMode = false;
        render();
        return;
      }
      if (state.activeFolder) {
        const parts = state.activeFolder.folderPath.split("/").filter(Boolean);
        if (parts.length > 1) {
          state.activeFolder = { ...state.activeFolder, folderPath: parts.slice(0, -1).join("/") };
        } else {
          const retId = state.activeFolder.returnDiagId || ("modules:" + state.activeFolder.unitSlug);
          state.activeFolder = null;
          state.activeLayerDiagId = diagById.has(retId) ? retId : null;
        }
      } else if (state.activeLayerDiagId) {
        const cur = diagById.get(state.activeLayerDiagId);
        state.activeLayerDiagId = cur?.parentDiagramId && diagById.has(cur.parentDiagramId) ? cur.parentDiagramId : null;
      }
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      render();
    }

    if (target.closest("[data-step-up]")) {
      stepUpLevel();
      return;
    }

    if (target.closest("[data-back-map]")) {
      state.activeLayerDiagId = null;
      state.activeFolder = null;
      state.activeFileGraph = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const openFileGraphBtn = target.closest("[data-open-file-graph]");
    if (openFileGraphBtn) {
      const fPath = openFileGraphBtn.getAttribute("data-open-file-graph") || "";
      if (ddIdxByPath.has(fPath)) {
        state.tab = "map";
        state.activeFileGraph = fPath;
        state.focusMode = false;
        state.selectedEdgeId = null;
        const jumpSym = openFileGraphBtn.getAttribute("data-jump-sym");
        if (jumpSym) {
          const p = jumpSym.split(":");
          state.selectedNodeId = "sym:" + p[0] + ":" + p[1];
          state.codeFocusLine = Number(p[2]) || 1;
        } else {
          state.selectedNodeId = null;
          state.codeFocusLine = 1;
        }
        state.codeFullFile = false;
        ensureFileSourcesLoaded();
        render();
      }
      return;
    }

    const jumpSymBtn = target.closest("[data-jump-sym]");
    if (jumpSymBtn) {
      const p = (jumpSymBtn.getAttribute("data-jump-sym") || "").split(":");
      if (p.length >= 3) {
        state.selectedNodeId = "sym:" + p[0] + ":" + p[1];
        state.selectedEdgeId = null;
        state.codeFocusLine = Number(p[2]) || 1;
        ensureFileSourcesLoaded();
        render();
      }
      return;
    }

    const jumpLineBtn = target.closest("[data-jump-line]");
    if (jumpLineBtn) {
      state.codeFocusLine = Number(jumpLineBtn.getAttribute("data-jump-line")) || 1;
      ensureFileSourcesLoaded();
      render();
      return;
    }

    const codeFullBtn = target.closest("[data-code-full]");
    if (codeFullBtn) {
      state.codeFullFile = codeFullBtn.getAttribute("data-code-full") === "1";
      ensureFileSourcesLoaded();
      render();
      return;
    }

    const openFolderBtn = target.closest("[data-open-folder]");
    if (openFolderBtn) {
      const raw = openFolderBtn.getAttribute("data-open-folder") || "";
      const sep = raw.indexOf("::");
      if (sep > 0) {
        const uSlug = raw.slice(0, sep);
        const fPath = raw.slice(sep + 2);
        const prevReturn = state.activeFolder?.returnDiagId || state.activeLayerDiagId;
        state.tab = "map";
        state.activeFileGraph = null;
        state.activeFolder = { unitSlug: uSlug, folderPath: fPath, returnDiagId: prevReturn };
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
      }
      return;
    }

    const openFileBtn = target.closest("[data-open-file]");
    if (openFileBtn) {
      const fPath = openFileBtn.getAttribute("data-open-file") || "";
      const fIdx = ddIdxByPath.get(fPath);
      if (fIdx !== undefined) {
        const f = DD_FILES[fIdx];
        const peel = ddUnitPeelPrefix(f.u);
        const logical = ddLogicalRel(f, peel);
        const parts = logical.split("/");
        const parentFolder = parts.length >= 2 ? parts.slice(0, -1).join("/") : "";
        const prevReturn = state.activeFolder?.returnDiagId || state.activeLayerDiagId;
        state.tab = "map";
        if (parentFolder) {
          state.activeFolder = { unitSlug: f.u, folderPath: parentFolder, returnDiagId: prevReturn };
        }
        state.selectedNodeId = "file:" + f.p;
        state.selectedEdgeId = null;
        state.focusMode = false;
        render();
      }
      return;
    }

    const openLayerBtn = target.closest("[data-open-layers]");
    if (openLayerBtn) {
      state.tab = "map";
      state.activeFileGraph = null;
      state.activeFolder = null;
      state.activeLayerDiagId = openLayerBtn.getAttribute("data-open-layers");
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return;
    }

    if (target.closest("[data-toggle-focus]")) {
      state.focusMode = !state.focusMode;
      render();
      return;
    }

    if (target.closest("[data-clear-sel]")) {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      state.activeTraceId = null;
      render();
      return;
    }

    const zoomBtn = target.closest("[data-zoom]");
    if (zoomBtn) {
      zoomByButton(zoomBtn.getAttribute("data-zoom") || "fit");
      return;
    }

    const traceCard = target.closest("[data-trace]");
    if (traceCard) {
      const tid = traceCard.getAttribute("data-trace");
      if (state.activeTraceId === tid) {
        state.activeTraceId = null;
      } else {
        state.activeTraceId = tid;
        const t = DATA.traces.find((x) => x.id === tid);
        if (t) {
          const d = diagById.get(t.diagramId);
          if (d) {
            state.viewMode = "flow";
            if (d.category === "layers" || d.category === "modules" || d.category === "subsystem") { state.tab = "map"; state.activeLayerDiagId = d.id; }
            else if (d.category === "behavior") { state.tab = "behavior"; state.activeBehaviorId = d.id; }
            else { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "runtime"; }
          }
        }
      }
      render();
      return;
    }

    const showInvBtn = target.closest("[data-show-inv]");
    if (showInvBtn) {
      const invId = showInvBtn.getAttribute("data-show-inv");
      const inv = invById.get(invId);
      const anchor = inv?.evidence?.find((e) => e.anchors && e.anchors.length > 0)?.anchors?.[0];
      if (anchor) {
        const d = diagById.get(anchor.diagramId);
        if (d) {
          state.focusMode = false;
          state.activeTraceId = null;
          if (d.category === "layers") { state.tab = "map"; state.activeLayerDiagId = d.id; }
          else if (d.category === "domains") { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "domains"; }
          else if (d.category === "delivery") { state.tab = "delivery"; }
          else { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "runtime"; }
          state.selectedEdgeId = anchor.edgeIds[0] || null;
          state.selectedNodeId = state.selectedEdgeId ? null : (anchor.nodeIds[0] || null);
          render();
        }
      }
      return;
    }

    if (target.closest("[data-toggle-guide]")) {
      state.showGuide = !state.showGuide;
      render();
      return;
    }

    const copyInvBtn = target.closest("[data-copy-inv]");
    if (copyInvBtn) {
      const inv = invById.get(copyInvBtn.getAttribute("data-copy-inv"));
      if (inv && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(buildFixBriefMarkdown(inv)).catch(() => {});
      }
      copyInvBtn.textContent = "Copied ✓";
      setTimeout(() => { copyInvBtn.textContent = "Copy Fix Brief"; }, 1400);
      return;
    }

    if (target.closest("[data-dsm-viol-only]")) {
      state.dsmViolOnly = !state.dsmViolOnly;
      render();
      return;
    }

    if (target.closest("[data-open-viol-matrix]")) {
      state.viewMode = "matrix";
      state.dsmViolOnly = true;
      state.focusMode = false;
      render();
      return;
    }

    if (target.closest("[data-data-issues]")) {
      state.dataIssuesOnly = !state.dataIssuesOnly;
      render();
      return;
    }

    const diffModeBtn = target.closest("[data-diff-mode]");
    if (diffModeBtn) {
      state.diffMode = diffModeBtn.getAttribute("data-diff-mode") || "overlay";
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      syncCameraTargetImmediate();
      render();
      return;
    }

    const diffDiagBtn = target.closest("[data-diff-diag]");
    if (diffDiagBtn) {
      state.diffDiagramId = diffDiagBtn.getAttribute("data-diff-diag");
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      syncCameraTargetImmediate();
      render();
      return;
    }

    const jumpFilterBtn = target.closest("[data-jump-checks-filter]");
    if (jumpFilterBtn) {
      state.tab = "checks";
      state.checksFilter = jumpFilterBtn.getAttribute("data-jump-checks-filter") || "active";
      state.showGuide = false;
      render();
      return;
    }

    if (target.closest("[data-jump-checks]")) {
      state.tab = "checks";
      state.checksFilter = "active";
      render();
      return;
    }

    const dataSub = target.closest("[data-data-sub]");
    if (dataSub) {
      state.dataSubtab = dataSub.getAttribute("data-data-sub") || "entities";
      state.dataIssuesOnly = false;
      render();
      return;
    }

    const checksF = target.closest("[data-checks-filter]");
    if (checksF) {
      state.checksFilter = checksF.getAttribute("data-checks-filter") || "active";
      render();
      return;
    }

    const searchItem = target.closest("[data-search-action]");
    if (searchItem) {
      const act = searchItem.getAttribute("data-search-action");
      const id = searchItem.getAttribute("data-search-id") || "";
      state.search = "";
      if (act === "file") {
        const fIdx = ddIdxByPath.get(id);
        if (fIdx !== undefined) {
          const f = DD_FILES[fIdx];
          const peel = ddUnitPeelPrefix(f.u);
          const logical = ddLogicalRel(f, peel);
          const parts = logical.split("/");
          const parentFolder = parts.length >= 2 ? parts.slice(0, -1).join("/") : "";
          state.tab = "map";
          if (parentFolder) state.activeFolder = { unitSlug: f.u, folderPath: parentFolder, returnDiagId: "modules:" + f.u };
          state.selectedNodeId = "file:" + f.p;
          state.selectedEdgeId = null;
        }
      } else if (act === "module") {
        const mod = moduleById.get(id);
        state.tab = "map";
        state.activeFolder = null;
        state.activeLayerDiagId = mod ? "modules:" + mod.unitSlug : state.activeLayerDiagId;
        state.selectedNodeId = id;
        state.selectedEdgeId = null;
      } else if (act === "node") {
        state.tab = "map";
        state.activeLayerDiagId = null;
        state.mapMode = "runtime";
        state.selectedNodeId = id;
        state.selectedEdgeId = null;
      } else if (act === "endpoints") {
        state.tab = "data";
        state.dataSubtab = "endpoints";
        state.dataFilter = id;
      } else if (act === "entity") {
        state.tab = "data";
        state.dataSubtab = "entities";
        state.dataFilter = id;
      }
      const selAfterSearch = state.selectedNodeId;
      render();
      if (selAfterSearch) centerCameraOnNode(selAfterSearch);
      return;
    }

    const selNodeEl = target.closest("[data-select-node]");
    if (selNodeEl) {
      state.selectedNodeId = selNodeEl.getAttribute("data-select-node");
      state.selectedEdgeId = null;
      render();
      return;
    }

    const svgNode = target.closest("[data-node]");
    if (svgNode) {
      const id = svgNode.getAttribute("data-node");
      const now = Date.now();
      const isDouble = Boolean(id && (ev.detail >= 2 || (lastNodeClickId === id && now - lastNodeClickAt <= 420)));
      lastNodeClickId = id;
      lastNodeClickAt = now;
      if (isDouble && drillIntoNode(id)) {
        lastNodeClickId = null;
        lastNodeClickAt = 0;
        return;
      }
      state.selectedNodeId = id;
      state.selectedEdgeId = null;
      render();
      return;
    }

    const svgEdge = target.closest("[data-edge]");
    if (svgEdge) {
      state.selectedEdgeId = svgEdge.getAttribute("data-edge");
      state.selectedNodeId = null;
      render();
      return;
    }
  });

  appEl.addEventListener("dblclick", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-node]")) {
      ev.preventDefault();
      return;
    }
    if (target.closest("#canvas-shell") && !target.closest(".matrix-mode") && !target.closest("[data-edge]") && !target.closest("button, .hud-pill, .hud-minimap, .tray")) {
      ev.preventDefault();
      zoomByButton("fit");
    }
  });

  appEl.addEventListener("input", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "global-search") {
      state.search = target.value;
      const dd = document.getElementById("search-dd");
      if (dd) dd.outerHTML = renderSearchDropdown();
    } else if (target.id === "data-filter") {
      state.dataFilter = target.value;
      render();
      const df = document.getElementById("data-filter");
      if (df instanceof HTMLInputElement) {
        df.focus();
        df.setSelectionRange(df.value.length, df.value.length);
      }
    }
  });

  appEl.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const mm = target.closest("#hud-minimap");
    if (mm) {
      ev.preventDefault();
      minimapDrag = true;
      mm.setPointerCapture(ev.pointerId);
      panCameraToMinimapEvent(ev);
      return;
    }
    if (target.closest("button, a, input, select, .hud-pill, .tray, .matrix-mode")) return;
    if (!spacePan && ev.button !== 1 && (target.closest("[data-node]") || target.closest("[data-edge]"))) return;
    const shell = target.closest("#canvas-shell");
    if (!shell) return;
    syncCameraTargetImmediate();
    dragActive = true;
    dragMoved = false;
    dragPointerId = ev.pointerId;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    lastMoveX = ev.clientX;
    lastMoveY = ev.clientY;
    lastMoveTs = performance.now();
    origTx = state.tx;
    origTy = state.ty;
  });

  appEl.addEventListener("pointermove", (ev) => {
    if (minimapDrag) {
      panCameraToMinimapEvent(ev);
      return;
    }
    if (!dragActive) return;
    const svg = document.getElementById("diagram-svg");
    const shell = document.getElementById("canvas-shell");
    if (!svg || !shell) return;
    const dxPx = ev.clientX - dragStartX;
    const dyPx = ev.clientY - dragStartY;
    if (!dragMoved && Math.hypot(dxPx, dyPx) < 3) return;
    if (!dragMoved) {
      dragMoved = true;
      shell.classList.add("dragging");
      if (typeof shell.setPointerCapture === "function" && dragPointerId >= 0) {
        shell.setPointerCapture(dragPointerId);
      }
    }
    const ppu = Math.max(0.0001, svgPixelsPerUnit(svg));
    const now = performance.now();
    const dt = Math.max(0.004, (now - lastMoveTs) / 1000);
    if (dt < 0.08) {
      const vx = ((ev.clientX - lastMoveX) / ppu) / dt;
      const vy = ((ev.clientY - lastMoveY) / ppu) / dt;
      panVelX = panVelX * 0.45 + vx * 0.55;
      panVelY = panVelY * 0.45 + vy * 0.55;
    }
    lastMoveX = ev.clientX;
    lastMoveY = ev.clientY;
    lastMoveTs = now;
    state.tx = origTx + dxPx / ppu;
    state.ty = origTy + dyPx / ppu;
    camTarget.tx = state.tx;
    camTarget.ty = state.ty;
    applyTransform();
  });

  appEl.addEventListener("pointerup", (ev) => {
    if (minimapDrag) {
      minimapDrag = false;
      const mm = document.getElementById("hud-minimap");
      if (mm && mm.hasPointerCapture(ev.pointerId)) mm.releasePointerCapture(ev.pointerId);
      return;
    }
    if (!dragActive) return;
    const wasDragged = dragMoved;
    dragActive = false;
    dragMoved = false;
    const shell = document.getElementById("canvas-shell");
    if (shell) {
      shell.classList.remove("dragging");
      if (shell.hasPointerCapture(ev.pointerId)) shell.releasePointerCapture(ev.pointerId);
    }
    if (wasDragged && !prefersReducedMotion && performance.now() - lastMoveTs < 65 && Math.hypot(panVelX, panVelY) > 60) {
      inertiaActive = true;
      if (!camRaf) {
        camLastTs = 0;
        camRaf = requestAnimationFrame(stepCameraFrame);
      }
    } else {
      panVelX = 0;
      panVelY = 0;
    }
  });

  appEl.addEventListener("wheel", (ev) => {
    if (INLINE) return;
    const target = ev.target;
    if (!(target instanceof Element) || !target.closest("#canvas-shell") || target.closest(".matrix-mode")) return;
    ev.preventDefault();
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    const mult = ev.deltaMode === 1 ? 26 : ev.deltaMode === 2 ? 240 : 1;
    const dx = ev.deltaX * mult;
    const dy = ev.deltaY * mult;
    const isHorizontalPan = !ev.ctrlKey && !ev.metaKey && ev.deltaMode === 0 && Math.abs(dx) > Math.abs(dy) * 1.15 && !ev.shiftKey;
    if (ev.shiftKey || isHorizontalPan) {
      const ppu = Math.max(0.0001, svgPixelsPerUnit(svg));
      const panDx = ev.shiftKey && Math.abs(dx) < 1 ? dy : dx;
      const panDy = ev.shiftKey && Math.abs(dx) < 1 ? 0 : dy;
      camTarget.tx -= panDx / ppu;
      camTarget.ty -= panDy / ppu;
      kickCameraLoop(22);
      return;
    }
    const pt = screenToSvg(svg, ev.clientX, ev.clientY);
    const factor = computeWheelZoomFactor(ev);
    zoomAroundSvgPoint(pt.x, pt.y, factor, ev.ctrlKey ? 30 : 18, false);
  }, { passive: false });

  document.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") spacePan = false;
  });

  document.addEventListener("keydown", (ev) => {
    const activeTag = document.activeElement?.tagName;
    if (ev.key === "Escape") {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      state.activeTraceId = null;
      state.search = "";
      render();
      return;
    }
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (ev.code === "Space") {
      spacePan = true;
      return;
    }
    if (ev.key === "/" || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k")) {
      ev.preventDefault();
      const input = document.getElementById("global-search");
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    if (ev.key === "Enter" && state.selectedNodeId) {
      if (drillIntoNode(state.selectedNodeId)) {
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === "Backspace" && (state.activeFileGraph || state.activeFolder || state.activeLayerDiagId)) {
      ev.preventDefault();
      if (state.activeFileGraph) {
        const prevFile = state.activeFileGraph;
        state.activeFileGraph = null;
        state.selectedNodeId = "file:" + prevFile;
        state.selectedEdgeId = null;
        state.focusMode = false;
        render();
        return;
      }
      if (state.activeFolder) {
        const parts = state.activeFolder.folderPath.split("/").filter(Boolean);
        if (parts.length > 1) state.activeFolder = { ...state.activeFolder, folderPath: parts.slice(0, -1).join("/") };
        else {
          const retId = state.activeFolder.returnDiagId || ("modules:" + state.activeFolder.unitSlug);
          state.activeFolder = null;
          state.activeLayerDiagId = diagById.has(retId) ? retId : null;
        }
      } else {
        state.activeLayerDiagId = null;
      }
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      render();
      return;
    }
    if (ev.key === "0") {
      zoomByButton("fit");
      return;
    }
    if (ev.key === "+" || ev.key === "=") {
      ev.preventDefault();
      zoomByButton("in");
      return;
    }
    if (ev.key === "-") {
      ev.preventDefault();
      zoomByButton("out");
      return;
    }
    if (ev.key.toLowerCase() === "f" && state.selectedNodeId) {
      ev.preventDefault();
      state.focusMode = !state.focusMode;
      render();
      return;
    }
    if (ev.key.toLowerCase() === "m") {
      const d = activeDiagram();
      if (supportsMatrix(d)) {
        ev.preventDefault();
        state.viewMode = state.viewMode === "matrix" ? "flow" : "matrix";
        state.focusMode = false;
        render();
      }
    }
  });

  render();
})();
</script>
</body>
</html>`;
}
