export function renderTablesClientScript(): string {
  return `
  function renderEdgeInspector(diag, edgeId) {
    const e = diag.edges.find((x) => x.id === edgeId);
    if (!e) return renderBriefingDrawer();
    const labelFor = (id) => {
      const m = moduleById.get(id);
      if (m) return m.kind === "directory" ? m.name + "/" : m.name;
      const dn = diag.nodes.find((n) => n.id === id);
      if (dn) return dn.label;
      return shortPkg(nodeById.get(id)?.label || id);
    };
    const fromLabel = labelFor(e.from);
    const toLabel = labelFor(e.to);
    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(fromLabel) + (e.bidirectional ? " ⇄ " : " → ") + esc(toLabel) + '</div><div class="drawer-sub">' + esc(e.kind) + " · " + esc(e.confidence) + (e.weight ? " · weight " + e.weight : "") + "</div></div></div>" +
      '<div><button class="action-btn sec-btn" data-clear-sel="1">Briefing (Esc)</button></div>' +
      (e.ruleIds && e.ruleIds.length > 0
        ? '<div class="sec"><div class="sec-title">Triggered Invariants</div>' + e.ruleIds.map((rid) => {
            const inv = invById.get(rid);
            if (!inv) return '<div class="ev-box warn"><strong class="mono">' + esc(rid) + "</strong></div>";
            return renderFindingDisclosure(inv, {
              open: true,
              filterEv: (ev) => (ev.edgeFromId === e.from && ev.edgeToId === e.to) || (e.bidirectional && ev.edgeFromId === e.to && ev.edgeToId === e.from),
            });
          }).join("") + "</div>"
        : "") +
      '<div class="sec"><div class="sec-title">Source Evidence (' + (e.evidence?.length || 0) + ")</div>" +
      ((e.evidence || []).length === 0
        ? '<div class="muted" style="font-size:11px">Structural edge without line-level evidence items.</div>'
        : e.evidence.map((ev) => '<div class="ev-box ' + (e.violation ? "fail" : "") + '">' + provenanceLinksHtml(ev.file, ev.line) + "<div>" + esc(ev.detail) + "</div></div>").join("")) +
      "</div>"
    );
  }

  function renderSearchDropdown() {
    const q = state.search.trim().toLowerCase();
    if (!q) return '<div class="search-dropdown" id="search-dd"></div>';
    const hits = [];
    for (const f of DD_FILES) {
      if (f.p.toLowerCase().includes(q)) {
        hits.push({ kind: "file · " + f.u, label: f.p, action: "file", id: f.p });
      } else {
        const syms = f.m || [];
        for (let si = 0; si < syms.length; si += 1) {
          const symHit = syms[si];
          if (symHit[0].toLowerCase().includes(q)) {
            hits.push({ kind: (symHit[1] === "pub" ? "pub " : "priv ") + symHit[2], label: formatSymDisplayName(symHit) + " (" + f.p.split("/").pop() + ")", action: "sym", id: f.p + "::" + si + "::" + symHit[3] });
            break;
          }
        }
      }
      if (hits.length >= 10) break;
    }
    for (const m of (DATA.modules || [])) {
      if (m.name.toLowerCase().includes(q) || m.relPath.toLowerCase().includes(q)) {
        hits.push({ kind: m.role + " · L" + m.level, label: m.unitSlug + " / " + (m.kind === "directory" ? m.name + "/" : m.name), action: "module", id: m.id });
      } else {
        const symHit = m.topExports.find((s) => s.name.toLowerCase().includes(q));
        if (symHit) {
          hits.push({ kind: symHit.kind, label: symHit.name + " (" + m.name + ")", action: "module", id: m.id });
        }
      }
      if (hits.length >= 8) break;
    }
    for (const n of DATA.nodes) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        hits.push({ kind: n.kind, label: shortPkg(n.label), action: "node", id: n.id });
      }
      if (hits.length >= 14) break;
    }
    for (const ep of DATA.surfaces.endpoints) {
      if (ep.path.toLowerCase().includes(q)) {
        hits.push({ kind: ep.method, label: ep.path + " (" + (ep.authGuard || "unannotated") + ")", action: "endpoints", id: ep.path });
      }
      if (hits.length >= 18) break;
    }
    for (const e of DATA.entities) {
      if (e.entity.toLowerCase().includes(q)) {
        hits.push({ kind: e.datastore, label: e.entity, action: "entity", id: e.entity });
      }
      if (hits.length >= 22) break;
    }
    return (
      '<div class="search-dropdown open" id="search-dd">' +
      (hits.length === 0
        ? '<div class="search-item"><span class="muted">No matches</span></div>'
        : hits.map((h) => '<div class="search-item" data-search-action="' + esc(h.action) + '" data-search-id="' + esc(h.id) + '"><span class="search-item-main">' + esc(h.label) + '</span><span class="search-item-kind">' + esc(h.kind) + "</span></div>").join("")) +
      "</div>"
    );
  }

  function renderMatrixView(diag) {
    const laneIdx = new Map((diag.lanes || []).map((l, i) => [l.id, i]));
    const laneColors = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f472b6", "#94a3b8"];
    const violNodeIds = new Set();
    let violEdgeCount = 0;
    for (const e of diag.edges) {
      if (e.violation) {
        violEdgeCount += 1;
        violNodeIds.add(e.from);
        violNodeIds.add(e.to);
      }
    }
    const baseOrdered = [...diag.nodes].sort((a, b) => {
      const ra = a.layerRank !== undefined ? a.layerRank : (laneIdx.get(a.lane || "") ?? 99);
      const rb = b.layerRank !== undefined ? b.layerRank : (laneIdx.get(b.lane || "") ?? 99);
      return ra - rb || a.label.localeCompare(b.label);
    });
    const ordered = state.dsmViolOnly && violNodeIds.size > 0
      ? baseOrdered.filter((n) => violNodeIds.has(n.id))
      : baseOrdered;

    const edgeByPair = new Map();
    let maxWeight = 1;
    for (const e of diag.edges) {
      edgeByPair.set(e.from + "|" + e.to, e);
      if (e.bidirectional) edgeByPair.set(e.to + "|" + e.from, e);
      if ((e.weight || 1) > maxWeight) maxWeight = e.weight || 1;
    }

    const headCols = ordered.map((n, ci) =>
      '<th class="dsm-col-th" data-dsm-col="' + ci + '" data-select-node="' + esc(n.id) + '" title="' + esc(n.label) + '">' +
      '<div class="dsm-col-lbl">' + esc(n.label) + "</div></th>"
    ).join("");

    const rowsHtml = ordered.map((rowNode, ri) => {
      const lColor = laneColors[(laneIdx.get(rowNode.lane || "") ?? 5) % laneColors.length];
      const cells = ordered.map((colNode, ci) => {
        if (ri === ci) return '<td class="dsm-cell diag">·</td>';
        const e = edgeByPair.get(rowNode.id + "|" + colNode.id);
        if (!e) return '<td class="dsm-cell"></td>';
        const w = e.weight || 1;
        const alpha = (0.18 + Math.min(0.65, (Math.log(w + 1) / Math.log(maxWeight + 1)) * 0.65)).toFixed(2);
        const bg = e.violation ? "" : ' style="background:rgba(56,189,248,' + alpha + ')"';
        const cls = "dsm-cell " + (e.violation ? "viol" : "hit") + (state.selectedEdgeId === e.id ? " sel" : "");
        const tip = rowNode.label + " imports " + colNode.label + " (" + w + " ref" + (w === 1 ? "" : "s") + (e.violation ? " · RULE VIOLATION / CYCLE" : "") + ")";
        return '<td class="' + cls + '"' + bg + ' data-edge="' + esc(e.id) + '" data-dsm-r="' + ri + '" data-dsm-c="' + ci + '" title="' + esc(tip) + '">' + (w > 99 ? "99+" : w) + "</td>";
      }).join("");
      return (
        "<tr>" +
        '<th class="dsm-row-th" data-dsm-row="' + ri + '" data-select-node="' + esc(rowNode.id) + '">' +
        '<span class="dsm-lane-dot" style="background:' + lColor + '"></span>' + esc(rowNode.label) +
        "</th>" +
        cells +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="dsm-wrap">' +
      '<div class="dsm-note">' +
      '<span><strong>Design Structure Matrix (Row imports Column)</strong> · ' + ordered.length + " nodes · " + diag.edges.length + " deps · 0 crossings</span>" +
      (violEdgeCount > 0 ? '<button class="pill-btn' + (state.dsmViolOnly ? " active" : "") + '" data-dsm-viol-only="1" title="Show only rows and columns involved in rule violations or cycles">Violations only (' + violEdgeCount + ")</button>" : "") +
      '<span>Click any cell for file:line evidence · <span style="color:#fca5a5">Red</span> = violation / cycle</span>' +
      "</div>" +
      '<table class="dsm-table"><thead><tr><th class="dsm-corner">FROM ↓ / TO →</th>' + headCols + "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table></div>"
    );
  }

  function renderDataTab() {
    const q = state.dataFilter.toLowerCase();
    const flaggedEntities = new Set();
    for (const inv of DATA.invariants) {
      if (inv.status !== "fail" && inv.status !== "warn") continue;
      if (inv.id.includes("entity") || inv.id.includes("collection") || inv.id.includes("firestore")) {
        for (const ev of inv.evidence) {
          flaggedEntities.add(ev.subject.split(":").pop());
          flaggedEntities.add(ev.subject);
        }
      }
    }
    const entityIssueCount = DATA.entities.filter((e) => flaggedEntities.has(e.entity) || flaggedEntities.has(e.datastore + ":" + e.entity)).length;
    const unguardedEpCount = DATA.surfaces.endpoints.filter((e) => !e.authGuard || e.authGuard === "public").length;
    const secretEnvCount = DATA.surfaces.envBindings.filter((e) => e.isSecret).length;
    const issuesBtnLabel = state.dataSubtab === "endpoints"
      ? "Unguarded / Public (" + unguardedEpCount + ")"
      : state.dataSubtab === "entities" && entityIssueCount > 0
        ? "Issues only (" + entityIssueCount + ")"
        : state.dataSubtab === "env" && secretEnvCount > 0
          ? "Secrets only (" + secretEnvCount + ")"
          : "";
    const subBtns =
      '<div class="sub-toggles" style="margin-bottom:10px;justify-content:space-between">' +
      '<div class="sub-toggles">' +
      (DATA.surfaces.endpoints.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "endpoints" ? " active" : "") + '" data-data-sub="endpoints" title="HTTP routes grouped by API domain">HTTP Endpoints (' + DATA.summary.httpEndpoints + ")</button>" : "") +
      '<button class="pill-btn' + (state.dataSubtab === "entities" ? " active" : "") + '" data-data-sub="entities" title="Database collections & tables grouped by owning domain">Entities (' + DATA.entities.length + ")</button>" +
      (DATA.surfaces.envBindings.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "env" ? " active" : "") + '" data-data-sub="env" title="Environment variables & secrets grouped by service">Env & Secrets (' + DATA.summary.envBindings + ")</button>" : "") +
      (DATA.surfaces.foreignKeys.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "fks" ? " active" : "") + '" data-data-sub="fks">Foreign Keys (' + DATA.summary.foreignKeys + ")</button>" : "") +
      (issuesBtnLabel ? '<button class="pill-btn' + (state.dataIssuesOnly ? " active" : "") + '" data-data-issues="1">' + esc(issuesBtnLabel) + "</button>" : "") +
      '<input class="search" style="width:230px" id="data-filter" placeholder="Filter groups or items..." value="' + esc(state.dataFilter) + '" />' +
      '</div><button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="What am I looking at?">?</button></div>';

    const renderSurfaceGroups = (summaryText, groups, emptyText) => {
      const openAll = Boolean(q) || groups.length <= 2;
      const body = groups.length === 0
        ? '<div class="ev-box"><div class="muted">' + esc(emptyText) + "</div></div>"
        : '<div class="surf-groups">' + groups.map((g) => renderDisclosure({
            title: g.title,
            meta: g.meta,
            badge: g.badge,
            badgeClass: g.badgeClass,
            tone: g.tone,
            open: openAll,
            bodyHtml: '<table class="data-tbl surf-tbl"><thead><tr>' + g.headHtml + "</tr></thead><tbody>" + g.rowsHtml + "</tbody></table>" + (g.moreHtml || ""),
          })).join("") + "</div>";
      return '<div class="table-wrap" style="position:relative">' + subBtns + renderInfoPopoverHtml() +
        '<div class="surf-summary">' + esc(summaryText) + "</div>" + body + "</div>";
    };

    if (state.dataSubtab === "fks") {
      const rows = DATA.surfaces.foreignKeys.filter((f) => !q || f.fromTable.toLowerCase().includes(q) || f.toTable.toLowerCase().includes(q));
      const byTarget = new Map();
      for (const f of rows) {
        const list = byTarget.get(f.toTable) || [];
        list.push(f);
        byTarget.set(f.toTable, list);
      }
      const groups = Array.from(byTarget.entries())
        .sort((a, b) => {
          const ac = a[1].some((x) => x.onDelete === "CASCADE") ? 1 : 0;
          const bc = b[1].some((x) => x.onDelete === "CASCADE") ? 1 : 0;
          return bc - ac || b[1].length - a[1].length || a[0].localeCompare(b[0]);
        })
        .map(([tbl, items]) => {
          const cascades = items.filter((x) => x.onDelete === "CASCADE").length;
          return {
            title: tbl,
            meta: items.length + " referencing column" + (items.length === 1 ? "" : "s") + (cascades > 0 ? " · " + cascades + " CASCADE" : ""),
            badge: items.length,
            badgeClass: cascades > 0 ? "b-warn" : "b-info",
            tone: cascades > 0 ? "warn" : "info",
            headHtml: "<th>From</th><th>References</th><th>On Delete</th><th>Migration</th>",
            rowsHtml: items.slice(0, 80).map((f) =>
              '<tr><td class="mono">' + esc(f.fromTable + "." + f.fromColumn) + '</td><td class="mono">' + esc(f.toTable + "." + f.toColumn) + '</td><td>' + (f.onDelete ? '<span class="badge ' + (f.onDelete === "CASCADE" ? "b-warn" : "b-info") + '">' + esc(f.onDelete) + "</span>" : '<span class="muted">RESTRICT</span>') + '</td><td class="mono muted">' + esc(f.file) + "</td></tr>"
            ).join(""),
          };
        });
      return renderSurfaceGroups(groups.length + " referenced tables · " + rows.length + " foreign keys · click any group to expand", groups, "No matching foreign keys.");
    }

    if (state.dataSubtab === "endpoints") {
      const rows = DATA.surfaces.endpoints.filter((e) =>
        (!state.dataIssuesOnly || !e.authGuard || e.authGuard === "public") &&
        (!q || e.path.toLowerCase().includes(q) || e.unit.toLowerCase().includes(q) || (e.authGuard || "").toLowerCase().includes(q))
      );
      const skipPrefix = new Set(["admin", "internal", "public"]);
      const versionRe = new RegExp("^v[0-9]+$", "i");
      const rawMap = new Map();
      for (const e of rows) {
        const segs = e.path.split("/").filter(Boolean);
        const meaningful = segs.filter((s) => !versionRe.test(s) && s.toLowerCase() !== "api" && !s.startsWith("{") && !s.startsWith(":"));
        const picked = meaningful.find((s) => !skipPrefix.has(s.toLowerCase())) || meaningful[0] || shortPkg(e.unit) || "root";
        const key = picked.toLowerCase();
        const entry = rawMap.get(key) || { label: picked, items: [] };
        entry.items.push(e);
        rawMap.set(key, entry);
      }
      const rawList = Array.from(rawMap.values()).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
      const merged = [];
      const tailItems = [];
      const foldSmall = !q && rawList.length > 14;
      for (const g of rawList) {
        if (foldSmall && g.items.length < 4) tailItems.push(...g.items);
        else merged.push(g);
      }
      if (tailItems.length > 0) merged.push({ label: "Other Routes", items: tailItems, isTail: true });
      const groups = merged.map((g) => {
        const pubCount = g.items.filter((e) => !e.authGuard || e.authGuard === "public").length;
        const authCount = g.items.length - pubCount;
        const units = Array.from(new Set(g.items.map((e) => shortPkg(e.unit))));
        const sortedItems = [...g.items].sort((a, b) => {
          const ap = !a.authGuard || a.authGuard === "public" ? 0 : 1;
          const bp = !b.authGuard || b.authGuard === "public" ? 0 : 1;
          return ap - bp || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
        });
        const shown = sortedItems.slice(0, 120);
        return {
          title: g.label,
          meta: (authCount > 0 ? authCount + " protected" : "") + (authCount > 0 && pubCount > 0 ? " · " : "") + (pubCount > 0 ? pubCount + " public/unannotated" : "") + (units.length > 0 ? " · " + units.slice(0, 3).join(", ") : ""),
          badge: g.items.length,
          badgeClass: pubCount > 0 ? "b-warn" : "b-info",
          tone: pubCount > 0 ? "warn" : "info",
          headHtml: "<th>Method</th><th>Path</th><th>Auth</th><th>Unit</th><th>Trace</th>",
          rowsHtml: shown.map((e) => {
            const canTrace = e.file && ddIdxByPath.has(e.file);
            const traceCell = canTrace ? '<button class="tbtn" data-open-e2e="' + esc(e.file + "::-1") + '">Trace E2E →</button>' : '<span class="muted">—</span>';
            return '<tr><td><span class="badge b-info">' + esc(e.method) + '</span></td><td class="mono">' + esc(e.path) + '</td><td><span class="badge ' + (e.authGuard === "public" || !e.authGuard ? "b-warn" : "b-pass") + '">' + esc(e.authGuard || "unannotated") + '</span></td><td class="mono muted">' + esc(shortPkg(e.unit)) + "</td><td>" + traceCell + "</td></tr>";
          }).join(""),
          moreHtml: sortedItems.length > shown.length ? '<div class="muted" style="font-size:11px;padding-top:6px">Showing first ' + shown.length + " of " + sortedItems.length + " routes — use the filter box to narrow.</div>" : "",
        };
      });
      return renderSurfaceGroups(groups.length + " API domains · " + rows.length + " endpoints · click any domain to expand routes", groups, "No matching HTTP endpoints.");
    }

    if (state.dataSubtab === "env") {
      const rows = DATA.surfaces.envBindings.filter((e) =>
        (!state.dataIssuesOnly || e.isSecret) &&
        (!q || e.name.toLowerCase().includes(q) || e.units.join(",").toLowerCase().includes(q) || e.sources.join(",").toLowerCase().includes(q))
      );
      const byUnit = new Map();
      for (const e of rows) {
        const key = e.units.length > 1 ? "__shared__" : (shortPkg(e.units[0] || "repo-wide") || "repo-wide");
        const label = key === "__shared__" ? "Shared across services" : key;
        const cur = byUnit.get(key) || { key, label, items: [] };
        cur.items.push(e);
        byUnit.set(key, cur);
      }
      const groups = Array.from(byUnit.values())
        .sort((a, b) => {
          if (a.key === "__shared__") return -1;
          if (b.key === "__shared__") return 1;
          const as = a.items.filter((x) => x.isSecret).length;
          const bs = b.items.filter((x) => x.isSecret).length;
          return bs - as || b.items.length - a.items.length || a.label.localeCompare(b.label);
        })
        .map((g) => {
          const secCount = g.items.filter((x) => x.isSecret).length;
          const cfgCount = g.items.length - secCount;
          const showUnits = g.key === "__shared__";
          const sortedItems = [...g.items].sort((a, b) => (b.isSecret ? 1 : 0) - (a.isSecret ? 1 : 0) || a.name.localeCompare(b.name));
          return {
            title: g.label,
            meta: (secCount > 0 ? secCount + " secrets" : "") + (secCount > 0 && cfgCount > 0 ? " · " : "") + (cfgCount > 0 ? cfgCount + " config" : ""),
            badge: g.items.length,
            badgeClass: secCount > 0 ? "b-warn" : "b-info",
            tone: secCount > 0 ? "warn" : "info",
            headHtml: "<th>Variable</th><th>Kind</th><th>Sources</th>" + (showUnits ? "<th>Services</th>" : ""),
            rowsHtml: sortedItems.slice(0, 140).map((e) =>
              '<tr><td class="mono"><strong>' + esc(e.name) + '</strong></td><td>' + (e.isSecret ? '<span class="badge b-warn">secret</span>' : '<span class="muted">config</span>') + '</td><td class="mono muted">' + esc(e.sources.join(", ")) + "</td>" + (showUnits ? '<td class="mono">' + esc(e.units.map(shortPkg).join(", ")) + "</td>" : "") + "</tr>"
            ).join(""),
          };
        });
      return renderSurfaceGroups(groups.length + " service groups · " + rows.length + " variables · click any service to expand", groups, "No matching environment variables.");
    }

    const showFkCol = DATA.entities.some((e) => e.fkCount > 0);
    const showTenCol = DATA.entities.some((e) => e.hasTenancyKey);
    const rows = DATA.entities.filter((e) => {
      const hasIss = flaggedEntities.has(e.entity) || flaggedEntities.has(e.datastore + ":" + e.entity);
      if (state.dataIssuesOnly && !hasIss) return false;
      return !q || e.entity.toLowerCase().includes(q) || e.domains.join(",").toLowerCase().includes(q) || e.datastore.toLowerCase().includes(q);
    });
    const hubByEntity = new Map((DATA.flows?.dataHubs || []).map((h) => [h.entity.toLowerCase(), h]));
    const byDomain = new Map();
    for (const e of rows) {
      const isCoreShared = e.authorizedShared || e.domains.length >= 3;
      const key = isCoreShared ? "__shared__" : (e.domains.length > 0 ? e.domains[0] : "__unassigned__");
      const label = key === "__shared__" ? "Shared / Cross-Domain Core" : (key === "__unassigned__" ? "Unassigned / Direct Store" : key);
      const cur = byDomain.get(key) || { key, label, items: [] };
      cur.items.push(e);
      byDomain.set(key, cur);
    }
    const groups = Array.from(byDomain.values())
      .sort((a, b) => {
        if (a.key === "__shared__") return -1;
        if (b.key === "__shared__") return 1;
        if (a.key === "__unassigned__") return 1;
        if (b.key === "__unassigned__") return -1;
        const ai = a.items.filter((x) => flaggedEntities.has(x.entity) || flaggedEntities.has(x.datastore + ":" + x.entity)).length;
        const bi = b.items.filter((x) => flaggedEntities.has(x.entity) || flaggedEntities.has(x.datastore + ":" + x.entity)).length;
        return bi - ai || b.items.length - a.items.length || a.label.localeCompare(b.label);
      })
      .map((g) => {
        const sortedItems = [...g.items].sort((a, b) => {
          const ai = flaggedEntities.has(a.entity) || flaggedEntities.has(a.datastore + ":" + a.entity) ? 0 : 1;
          const bi = flaggedEntities.has(b.entity) || flaggedEntities.has(b.datastore + ":" + b.entity) ? 0 : 1;
          return ai - bi || b.totalRefs - a.totalRefs;
        });
        const issCount = sortedItems.filter((x) => flaggedEntities.has(x.entity) || flaggedEntities.has(x.datastore + ":" + x.entity)).length;
        const hubCount = sortedItems.filter((x) => hubByEntity.has(x.entity.toLowerCase())).length;
        const stores = Array.from(new Set(sortedItems.map((x) => x.datastore)));
        return {
          title: g.label,
          meta: [
            issCount > 0 ? issCount + " ownership issue" + (issCount === 1 ? "" : "s") : "",
            hubCount > 0 ? hubCount + " Data Hub" + (hubCount === 1 ? "" : "s") : "",
            stores.join(", "),
          ].filter(Boolean).join(" · "),
          badge: sortedItems.length,
          badgeClass: issCount > 0 ? "b-warn" : g.key === "__shared__" ? "b-cyan" : "b-info",
          tone: issCount > 0 ? "warn" : "info",
          headHtml: "<th>Entity</th><th>Refs</th>" + (showFkCol ? "<th>FKs</th>" : "") + (showTenCol ? "<th>Tenancy</th>" : "") + "<th>Shared With</th><th>Lifecycle</th>",
          rowsHtml: sortedItems.map((e) => {
            const hasIss = flaggedEntities.has(e.entity) || flaggedEntities.has(e.datastore + ":" + e.entity);
            const hubMatch = hubByEntity.get(e.entity.toLowerCase());
            const hubCell = hubMatch
              ? '<button class="tbtn" data-jump-hub="' + esc(hubMatch.entity + "::" + (hubMatch.fields?.[0]?.field || "")) + '">Data Hub (' + hubMatch.fieldCount + ") ↗</button>"
              : '<span class="muted">—</span>';
            const otherDoms = g.key === "__shared__" ? e.domains : e.domains.filter((d) => d !== g.key);
            const domSummary = otherDoms.length === 0
              ? '<span class="muted">single domain</span>'
              : otherDoms.length <= 3
                ? '<span class="mono muted">' + esc(otherDoms.join(", ")) + "</span>"
                : '<span class="mono muted" title="' + esc(otherDoms.join(", ")) + '">' + esc(otherDoms.slice(0, 2).join(", ")) + " +" + (otherDoms.length - 2) + " more</span>";
            return '<tr><td class="mono"><strong>' + esc(e.entity) + "</strong>" +
              (hasIss ? ' <span class="badge b-warn" title="Flagged by multi-domain ownership invariant">issue</span>' : "") +
              (e.authorizedShared ? ' <span class="badge b-info" title="Explicitly declared as shared across domains">shared</span>' : "") +
              '</td><td class="mono">' + e.totalRefs +
              (showFkCol ? '</td><td class="mono">' + e.fkCount : "") +
              (showTenCol ? "</td><td>" + (e.hasTenancyKey ? '<span class="badge b-pass">tenant</span>' : '<span class="muted">—</span>') : "") +
              "</td><td>" + domSummary +
              "</td><td>" + hubCell + "</td></tr>";
          }).join(""),
        };
      });
    return renderSurfaceGroups(groups.length + " domains · " + rows.length + " entities · click any domain to expand collections", groups, "No matching entities.");
  }

  function renderChecksTab() {
    const sorted = sortInvariantsByUrgency(DATA.invariants);
    const failCount = sorted.filter((i) => i.status === "fail").length;
    const warnCount = sorted.filter((i) => i.status === "warn").length;
    const passCount = sorted.filter((i) => i.status === "pass").length;
    const naCount = sorted.filter((i) => i.status === "na").length;
    const invs = sorted.filter((i) => {
      if (state.checksFilter === "fail") return i.status === "fail";
      if (state.checksFilter === "warn") return i.status === "warn";
      if (state.checksFilter === "active") return i.status === "fail" || i.status === "warn";
      if (state.checksFilter === "pass") return i.status === "pass";
      if (state.checksFilter === "na") return i.status === "na";
      return true;
    });
    return (
      '<div class="table-wrap" style="position:relative">' +
      '<div class="sub-toggles" style="margin-bottom:10px;justify-content:space-between">' +
      '<div class="sub-toggles">' +
      '<button class="pill-btn" data-tab="map">← Back to Map</button>' +
      '<button class="pill-btn' + (state.checksFilter === "active" ? " active" : "") + '" data-checks-filter="active">Active (' + (failCount + warnCount) + ")</button>" +
      '<button class="pill-btn' + (state.checksFilter === "fail" ? " active" : "") + '" data-checks-filter="fail">Failures (' + failCount + ")</button>" +
      '<button class="pill-btn' + (state.checksFilter === "warn" ? " active" : "") + '" data-checks-filter="warn">Warnings (' + warnCount + ")</button>" +
      '<button class="pill-btn' + (state.checksFilter === "pass" ? " active" : "") + '" data-checks-filter="pass">Passed (' + passCount + ")</button>" +
      '<button class="pill-btn' + (state.checksFilter === "all" ? " active" : "") + '" data-checks-filter="all">All (' + sorted.length + ")</button>" +
      (naCount > 0 ? '<button class="pill-btn' + (state.checksFilter === "na" ? " active" : "") + '" data-checks-filter="na">N/A (' + naCount + ")</button>" : "") +
      '</div><button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="What do these checks mean?">?</button></div>' +
      renderInfoPopoverHtml() +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      (invs.length === 0
        ? '<div class="ev-box" style="border-left-color:#5fd9a0;padding:14px 16px;gap:8px"><strong style="color:#6ee7b0;font-size:14px">All applicable architectural checks pass</strong><div class="muted">0 blockers and 0 warnings for the current filter (' + passCount + " passed, " + naCount + ' N/A).</div>' +
          (passCount > 0 && state.checksFilter !== "pass" ? '<div><button class="tbtn" data-checks-filter="pass">View Passed (' + passCount + ")</button></div>" : "") + "</div>"
        : invs.map((inv) => {
            if (inv.status === "pass" || inv.status === "na") {
              return renderDisclosure({
                title: inv.name,
                meta: inv.id + " · " + inv.rung,
                badge: inv.status.toUpperCase(),
                badgeClass: inv.status === "pass" ? "b-pass" : "b-na",
                tone: inv.status === "pass" ? "pass" : "",
                open: false,
                bodyHtml:
                  '<div class="muted">' + esc(inv.statement) + "</div>" +
                  (inv.applicabilityReason ? '<div class="mono muted">N/A: ' + esc(inv.applicabilityReason) + "</div>" : ""),
              });
            }
            return renderFindingDisclosure(inv, { open: inv.status === "fail", hideChecksLink: true });
          }).join("")) +
      "</div>" +
      '<div style="margin-top:12px">' +
      renderDisclosure({
        title: "Verification Scope",
        meta: DATA.verification && DATA.verification.coverageSource !== "static_reachability_1hop"
          ? DATA.verification.coverageSource + " coverage"
          : "static 1-hop reach",
        open: false,
        bodyHtml:
          '<div class="muted" style="font-size:11px;line-height:1.5">' +
          esc((DATA.verification && DATA.verification.scopeNotes && DATA.verification.scopeNotes[0]) || "Static structural graph & local invariant analysis only. Behavioral semantics, runtime auth enforcement, and cross-repo wire contracts require runtime E2E/contract proofs.") +
          "</div>",
      }) +
      "</div></div>"
    );
  }
`;
}
