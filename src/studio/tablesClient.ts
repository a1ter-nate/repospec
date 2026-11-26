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
`;
}
