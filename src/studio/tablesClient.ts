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
    const issuesBtnLabel = state.dataSubtab === "endpoints"
      ? "Unguarded / Public (" + unguardedEpCount + ")"
      : state.dataSubtab === "entities" && entityIssueCount > 0
        ? "Issues only (" + entityIssueCount + ")"
        : "";
    const subBtns =
      '<div class="sub-toggles" style="margin-bottom:10px;justify-content:space-between">' +
      '<div class="sub-toggles">' +
      '<button class="pill-btn' + (state.dataSubtab === "entities" ? " active" : "") + '" data-data-sub="entities" title="Database tables and document collections accessed by code">Entities (' + DATA.entities.length + ")</button>" +
      (DATA.surfaces.foreignKeys.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "fks" ? " active" : "") + '" data-data-sub="fks">Foreign Keys (' + DATA.summary.foreignKeys + ")</button>" : "") +
      (DATA.surfaces.endpoints.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "endpoints" ? " active" : "") + '" data-data-sub="endpoints" title="All statically indexed HTTP routes and auth guards">HTTP Endpoints (' + DATA.summary.httpEndpoints + ")</button>" : "") +
      (DATA.surfaces.envBindings.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "env" ? " active" : "") + '" data-data-sub="env" title="Environment variables and secret bindings across units">Env & Secrets (' + DATA.summary.envBindings + ")</button>" : "") +
      (issuesBtnLabel ? '<button class="pill-btn' + (state.dataIssuesOnly ? " active" : "") + '" data-data-issues="1">' + esc(issuesBtnLabel) + "</button>" : "") +
      '<input class="search" style="width:220px" id="data-filter" placeholder="Filter table..." value="' + esc(state.dataFilter) + '" />' +
      '</div><button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="What am I looking at?">?</button></div>';

    if (state.dataSubtab === "fks") {
      const rows = DATA.surfaces.foreignKeys.filter((f) => !q || f.fromTable.includes(q) || f.toTable.includes(q));
      return '<div class="table-wrap" style="position:relative">' + subBtns + renderInfoPopoverHtml() +
        '<table class="data-tbl"><thead><tr><th>From</th><th>References</th><th>On Delete</th><th>Migration</th></tr></thead><tbody>' +
        rows.slice(0, 120).map((f) => '<tr><td class="mono">' + esc(f.fromTable + "." + f.fromColumn) + '</td><td class="mono">' + esc(f.toTable + "." + f.toColumn) + '</td><td>' + (f.onDelete ? '<span class="badge ' + (f.onDelete === "CASCADE" ? "b-warn" : "b-info") + '">' + esc(f.onDelete) + "</span>" : '<span class="muted">RESTRICT</span>') + '</td><td class="mono muted">' + esc(f.file) + "</td></tr>").join("") +
        "</tbody></table></div>";
    }
    if (state.dataSubtab === "endpoints") {
      const rows = DATA.surfaces.endpoints.filter((e) =>
        (!state.dataIssuesOnly || !e.authGuard || e.authGuard === "public") &&
        (!q || e.path.toLowerCase().includes(q) || e.unit.toLowerCase().includes(q) || (e.authGuard || "").toLowerCase().includes(q))
      );
      return '<div class="table-wrap" style="position:relative">' + subBtns + renderInfoPopoverHtml() +
        '<table class="data-tbl"><thead><tr><th>Method</th><th>Path</th><th>Auth Guard</th><th>Unit</th><th>Authority</th></tr></thead><tbody>' +
        rows.slice(0, 180).map((e) => '<tr><td><span class="badge b-info">' + esc(e.method) + '</span></td><td class="mono">' + esc(e.path) + '</td><td><span class="badge ' + (e.authGuard === "public" || !e.authGuard ? "b-warn" : "b-pass") + '" title="' + (e.authGuard ? "Auth middleware detected" : "No auth guard statically detected — verify route protection") + '">' + esc(e.authGuard || "unannotated") + '</span></td><td class="mono">' + esc(shortPkg(e.unit)) + '</td><td class="mono muted">' + esc(e.resolution || e.source) + "</td></tr>").join("") +
        "</tbody></table></div>";
    }
    if (state.dataSubtab === "env") {
      const rows = DATA.surfaces.envBindings.filter((e) => !q || e.name.toLowerCase().includes(q) || e.units.join(",").toLowerCase().includes(q));
      return '<div class="table-wrap" style="position:relative">' + subBtns + renderInfoPopoverHtml() +
        '<table class="data-tbl"><thead><tr><th>Env Variable</th><th>Sources</th><th>Units</th><th>Secret</th></tr></thead><tbody>' +
        rows.slice(0, 150).map((e) => '<tr><td class="mono">' + esc(e.name) + '</td><td class="mono muted">' + esc(e.sources.join(", ")) + '</td><td class="mono">' + esc(e.units.map(shortPkg).join(", ")) + '</td><td>' + (e.isSecret ? '<span class="badge b-warn">secret</span>' : '<span class="muted">config</span>') + "</td></tr>").join("") +
        "</tbody></table></div>";
    }

    const showFkCol = DATA.entities.some((e) => e.fkCount > 0);
    const showTenCol = DATA.entities.some((e) => e.hasTenancyKey);
    const rows = DATA.entities
      .filter((e) => {
        const hasIss = flaggedEntities.has(e.entity) || flaggedEntities.has(e.datastore + ":" + e.entity);
        if (state.dataIssuesOnly && !hasIss) return false;
        return !q || e.entity.toLowerCase().includes(q) || e.domains.join(",").toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const ai = flaggedEntities.has(a.entity) || flaggedEntities.has(a.datastore + ":" + a.entity) ? 0 : 1;
        const bi = flaggedEntities.has(b.entity) || flaggedEntities.has(b.datastore + ":" + b.entity) ? 0 : 1;
        return ai - bi || b.totalRefs - a.totalRefs;
      });
    return '<div class="table-wrap" style="position:relative">' + subBtns + renderInfoPopoverHtml() +
      '<table class="data-tbl"><thead><tr><th>Entity</th><th>Store</th><th>Refs</th>' + (showFkCol ? "<th>FKs</th>" : "") + (showTenCol ? "<th>Tenancy</th>" : "") + "<th>Domains</th><th>Layers</th></tr></thead><tbody>" +
      rows.slice(0, 150).map((e) => {
        const hasIss = flaggedEntities.has(e.entity) || flaggedEntities.has(e.datastore + ":" + e.entity);
        return '<tr><td class="mono"><strong>' + esc(e.entity) + "</strong>" +
          (hasIss ? ' <span class="badge b-warn" title="Flagged by multi-domain ownership invariant">issue</span>' : "") +
          (e.authorizedShared ? ' <span class="badge b-info" title="Explicitly declared as shared across domains">shared</span>' : "") +
          '</td><td class="mono muted">' + esc(e.datastore) +
          '</td><td class="mono">' + e.totalRefs +
          (showFkCol ? '</td><td class="mono">' + e.fkCount : "") +
          (showTenCol ? "</td><td>" + (e.hasTenancyKey ? '<span class="badge b-pass">tenant</span>' : '<span class="muted">—</span>') : "") +
          '</td><td class="mono">' + esc(e.domains.join(", ") || "—") +
          '</td><td class="mono muted">' + esc(e.layers.join(", ") || "—") + "</td></tr>";
      }).join("") +
      "</tbody></table></div>";
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
      "</div></div>"
    );
  }
`;
}
