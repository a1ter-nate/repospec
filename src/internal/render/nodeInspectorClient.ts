import { renderCameraClientScript } from "../../studio/camera.ts";
import { renderTablesClientScript } from "../../studio/tablesClient.ts";

export function renderNodeInspectorClientScript(): string {
  return `
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
      '<button class="action-btn sec-btn" data-toggle-blast="' + esc(node.id) + '">' + (state.blastSeedId === node.id ? "Exit Blast" : "Blast Radius") + "</button>",
      '<button class="action-btn sec-btn" data-copy-ctx="node" data-copy-ctx-id="' + esc(node.id) + '">Copy Agent Context</button>',
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

`;
}
