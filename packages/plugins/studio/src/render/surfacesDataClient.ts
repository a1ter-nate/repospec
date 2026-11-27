export function renderSurfacesDataClientScript(): string {
  return `
  function shortDomainCol(d) {
    const clean = d.replace(/[^a-z0-9]/gi, "");
    if (d === "quality-control") return "qc";
    if (d === "water-chemistry") return "wat";
    return clean.slice(0, 3).toLowerCase();
  }

  function renderSurfacesRelations(sm) {
    const fks = sm.foreignKeys;
    const q = (state.dataFilter || "").trim().toLowerCase();
    const byTarget = new Map();
    for (const fk of fks) {
      const cur = byTarget.get(fk.toTable) || { key: fk.toTable, label: fk.toTable, items: [], cascadeCount: 0 };
      cur.items.push(fk);
      if (fk.isCascade) cur.cascadeCount += 1;
      byTarget.set(fk.toTable, cur);
    }
    const groups = Array.from(byTarget.values()).sort((a, b) => b.cascadeCount - a.cascadeCount || b.items.length - a.items.length || a.label.localeCompare(b.label));
    const maxC = groups.reduce((m, g) => Math.max(m, g.items.length), 1);
    const selKey = state.surfGroup && byTarget.has(state.surfGroup) ? state.surfGroup : (groups[0]?.key || null);
    const selGrp = selKey ? byTarget.get(selKey) : null;
    const shownItems = (selGrp?.items || []).filter((f) => !q || f.fromTable.toLowerCase().includes(q) || f.toTable.toLowerCase().includes(q) || f.fromColumn.toLowerCase().includes(q));
    return (
      '<div class="surf-split-api">' +
      '<div class="surf-tile-pane"><div class="surf-tile-grid">' +
      groups.map((g) =>
        '<button class="surf-tile" data-surf-select-group="' + esc(g.key) + '" aria-selected="' + (selKey === g.key ? "true" : "false") + '">' +
        '<div class="surf-tile-top"><span class="chk-ico ' + (g.cascadeCount > 0 ? "t-warn" : "") + '">' + surfIconSvg("link") + '</span><span class="surf-tile-num">' + g.items.length + "</span></div>" +
        '<div class="surf-tile-title mono">' + esc(g.label) + "</div>" +
        renderSurfBar(g.items.length, g.cascadeCount, maxC, 0) +
        '<div class="surf-tile-sub">' + (g.cascadeCount > 0 ? g.cascadeCount + " CASCADE" : "RESTRICT") + "</div>" +
        "</button>"
      ).join("") +
      "</div></div>" +
      '<div class="surf-detail">' +
      '<div class="surf-det-head"><span class="surf-det-title mono">' + esc(selKey || "Foreign Keys") + '</span><span class="muted mono">' + shownItems.length + " references</span></div>" +
      '<div class="surf-det-list">' +
      (shownItems.length === 0
        ? '<div class="surf-empty">No foreign keys match.</div>'
        : shownItems.map((fk) =>
            '<div class="surf-det-row is-static">' +
            '<span class="mono">' + esc(fk.fromTable + "." + fk.fromColumn) + " → " + esc(fk.toTable + "." + fk.toColumn) + "</span>" +
            '<span class="surf-guard-col">' + (fk.isCascade ? '<span class="surf-warn-txt">CASCADE</span>' : (fk.onDelete && fk.onDelete !== "RESTRICT" ? '<span class="muted mono">' + esc(fk.onDelete) + "</span>" : "")) + "</span>" +
            '<span class="surf-loc-col mono">' + esc(fk.file.split("/").pop()) + "</span>" +
            "</div>"
          ).join("")) +
      "</div></div></div>"
    );
  }

  function renderEntityDetailPane(selEntity) {
    if (!selEntity) return '<div class="surf-empty">Select a collection tile to inspect domains, files, and field writers.</div>';
    const statusBits = [
      selEntity.datastore,
      selEntity.totalRefs + " refs",
      selEntity.declared ? "declared" : "undeclared",
      selEntity.authorizedShared ? "shared contract" : (selEntity.noContract ? "cross-domain, no contract" : ""),
    ].filter(Boolean).join(" · ");
    const domChips = selEntity.domains.length > 0
      ? '<div class="surf-det-sec"><div class="surf-sec-k">Domains (' + selEntity.domains.length + ')</div><div class="surf-chip-row">' +
        selEntity.domains.map((d) => '<button class="tbtn" data-surf-map-domain="' + esc(d) + '" title="Open ' + esc(d) + ' on Domain Map">' + esc(d) + "</button>").join("") +
        "</div></div>"
      : '<div class="surf-det-sec"><div class="surf-sec-k">Domains</div><div class="muted" style="font-size:12px">Not attributed to a domain.</div></div>';
    const hubSec = selEntity.hubEntity
      ? '<div class="surf-det-sec"><div class="surf-sec-k">Data Hub · ' + esc(selEntity.hubEntity) + " (" + selEntity.hubFieldCount + ' fields)</div>' +
        (selEntity.multiWriterFields.length > 0
          ? selEntity.multiWriterFields.slice(0, 6).map((mw) =>
              '<div class="surf-mini-row"><button class="row-link mono" data-jump-hub="' + esc(selEntity.hubEntity + "::" + mw.field) + '">' + esc(mw.field) + '</button><span class="surf-warn-txt mono">' + mw.writerCount + " writers ↗</span></div>"
            ).join("")
          : '<button class="tbtn" data-jump-hub="' + esc(selEntity.hubEntity + "::") + '">Open Data Hub ↗</button>') +
        "</div>"
      : "";
    const fileSec = selEntity.sampleFiles.length > 0
      ? '<div class="surf-det-sec"><div class="surf-sec-k">Sample Files (' + selEntity.sampleFiles.length + ")</div>" +
        selEntity.sampleFiles.slice(0, 8).map((f) =>
          '<div class="surf-mini-row"><button class="row-link mono" data-open-file="' + esc(f) + '" data-open-file-line="1">' + esc(f) + "</button></div>"
        ).join("") +
        "</div>"
      : "";
    const ownInv = selEntity.flagged ? DATA.invariants.find((i) => i.id === "sql:multi-domain-entity-ownership") : null;
    const invSec = ownInv
      ? '<div class="surf-det-sec">' + renderFindingDisclosure(ownInv, {
          open: true,
          filterEv: (ev) => ev.subject === selEntity.entity || ev.subject.endsWith(":" + selEntity.entity),
        }) + "</div>"
      : "";
    return (
      '<div class="surf-det-head"><span class="surf-det-title mono">' + esc(selEntity.entity) + '</span><span class="muted mono">' + esc(statusBits) + "</span></div>" +
      '<div class="surf-det-pad">' + domChips + hubSec + fileSec + invSec + "</div>"
    );
  }

  function renderSurfacesData(sm) {
    const t = sm.totals;
    const mode = sm.foreignKeys.length > 0 && state.surfDataMode === "relations"
      ? "relations"
      : state.surfDataMode === "matrix"
        ? "matrix"
        : "cards";
    const modeToggle =
      '<span class="seg-group">' +
      '<button class="seg-btn' + (mode === "cards" ? " active" : "") + '" data-surf-datamode-set="cards">Cards</button>' +
      '<button class="seg-btn' + (mode === "matrix" ? " active" : "") + '" data-surf-datamode-set="matrix">Matrix</button>' +
      (sm.foreignKeys.length > 0 ? '<button class="seg-btn' + (mode === "relations" ? " active" : "") + '" data-surf-datamode-set="relations">Relations (' + sm.foreignKeys.length + ")</button>" : "") +
      "</span>";
    if (mode === "relations") {
      const verdictRel = '<div class="surf-verdict-bar"><div class="surf-facets">' + modeToggle +
        (t.cascadeFks > 0 ? '<span class="surf-facet is-warn">' + t.cascadeFks + " cascading deletes</span>" : '<span class="muted mono">' + t.foreignKeys + " foreign keys</span>") +
        "</div></div>";
      return verdictRel + renderSurfacesRelations(sm);
    }

    const q = (state.dataFilter || "").trim().toLowerCase();
    const facet = state.surfFacet || "";
    const matches = (e) => {
      if (facet === "cross_domain" && !e.crossDomain) return false;
      if (facet === "no_contract" && !e.noContract) return false;
      if (facet === "no_domain" && !e.noDomain) return false;
      if (facet === "undeclared" && e.declared) return false;
      if (q && !e.entity.toLowerCase().includes(q) && !e.domains.join(",").toLowerCase().includes(q)) return false;
      return true;
    };
    const filtered = sm.entities.filter(matches);
    const head = (q || facet) ? filtered : filtered.filter((e) => !e.isTail);
    const tail = (q || facet) ? [] : filtered.filter((e) => e.isTail);
    const visibleRows = state.surfTailOpen ? [...head, ...tail] : head;
    const maxRefs = sm.entities.reduce((m, e) => Math.max(m, e.totalRefs), 1);
    const domains = sm.entityDomains;
    const selEntity = filtered.find((e) => e.id === state.surfRow) || visibleRows[0] || filtered[0] || null;

    const verdicts = [
      { id: "no_contract", label: "No contract", count: t.noContractEntities, warn: true },
      { id: "cross_domain", label: "Cross-domain", count: t.crossDomainEntities, warn: false },
      { id: "no_domain", label: "No domain", count: t.noDomainEntities, warn: false },
      { id: "undeclared", label: "Undeclared", count: t.undeclaredEntities, warn: false },
    ].filter((v) => v.count > 0);
    const verdictHtml =
      '<div class="surf-verdict-bar"><div class="surf-facets">' +
      verdicts.map((v) =>
        '<button class="surf-facet' + (v.warn ? " is-warn" : "") + (facet === v.id ? " active" : "") + '" data-surf-facet-toggle="' + v.id + '">' +
        esc(v.label) + ' <span class="mono">' + v.count + "</span></button>"
      ).join("") +
      "</div>" + modeToggle + "</div>";

    const tailToggle = tail.length > 0
      ? '<button class="surf-tail-btn" data-surf-toggle-tail="1">' +
        (state.surfTailOpen ? "Hide " + tail.length + " small collections" : tail.length + " small collections (≤3 refs, single domain or none) ›") +
        "</button>"
      : "";

    let leftHtml = "";
    if (visibleRows.length === 0) {
      leftHtml = '<div class="surf-empty">No collections match the current filter.</div>';
    } else if (mode === "cards") {
      leftHtml =
        '<div class="surf-tile-grid cols-3">' +
        visibleRows.map((e) => {
          const isSel = selEntity && selEntity.id === e.id;
          const domSet = new Set(e.domains);
          const dots = domains.map((d) => {
            if (!domSet.has(d)) return '<span class="surf-dot-off" title="' + esc(d) + '"></span>';
            return '<span class="' + (e.noContract ? "surf-dot-warn" : "surf-dot-on") + '" title="' + esc(d) + '"></span>';
          }).join("");
          const sub = [
            e.domains.length > 0 ? e.domains.length + " domain" + (e.domains.length === 1 ? "" : "s") : "no domain",
            e.hubFieldCount > 0 ? "Hub (" + e.hubFieldCount + ")" : (e.noContract ? "no contract" : ""),
          ].filter(Boolean).join(" · ");
          return (
            '<button class="surf-tile" data-surf-select-row="' + esc(e.id) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
            '<div class="surf-tile-top"><span class="chk-ico ' + (e.noContract ? "t-warn" : "") + '">' + surfIconSvg("db") + '</span><span class="surf-tile-num">' + e.totalRefs + "</span></div>" +
            '<div class="surf-tile-title mono">' + esc(e.entity) + "</div>" +
            '<div class="surf-dot-strip">' + dots + "</div>" +
            '<div class="surf-tile-sub">' + esc(sub) + "</div>" +
            "</button>"
          );
        }).join("") +
        "</div>";
    } else {
      const domHeadCells = domains.map((d) => '<th class="surf-mx-col" title="' + esc(d) + '">' + esc(shortDomainCol(d)) + "</th>").join("");
      const matrixRows = visibleRows.map((e) => {
        const domSet = new Set(e.domains);
        const isSel = selEntity && selEntity.id === e.id;
        const barPct = e.totalRefs > 0 ? Math.max(2, Math.min(100, (e.totalRefs / maxRefs) * 100)) : 0;
        const cells = domains.map((d) => !domSet.has(d) ? '<td class="surf-mx-cell"><span class="surf-dot-off"></span></td>' : '<td class="surf-mx-cell" title="' + esc(e.entity + " in " + d) + '"><span class="' + (e.noContract ? "surf-dot-warn" : "surf-dot-on") + '"></span></td>').join("");
        return '<tr class="surf-mx-row' + (isSel ? " is-sel" : "") + '" data-surf-select-row="' + esc(e.id) + '" aria-selected="' + (isSel ? "true" : "false") + '"><td class="surf-mx-name mono">' + esc(e.entity) + '</td><td class="surf-mx-ref"><span class="surf-bar-track sm"><span class="' + (e.noContract ? "surf-bar-warn" : "surf-bar-base") + '" style="width:' + barPct.toFixed(1) + '%"></span></span><span class="surf-mx-n mono">' + e.totalRefs + "</span></td>" + cells + "</tr>";
      }).join("");
      leftHtml = '<table class="surf-mx-tbl"><thead><tr><th class="surf-mx-name">Collection</th><th class="surf-mx-ref">Refs</th>' + domHeadCells + "</tr></thead><tbody>" + matrixRows + "</tbody></table>";
    }

    return verdictHtml +
      '<div class="surf-split-data">' +
      '<div class="surf-matrix-pane">' + leftHtml + tailToggle + "</div>" +
      '<div class="surf-detail">' + renderEntityDetailPane(selEntity) + "</div>" +
      "</div>";
  }

  function buildConfigServiceGroups(envVars) {
    const map = new Map();
    for (const v of envVars) {
      for (const svc of v.services) {
        const cur = map.get(svc) || { key: svc, label: svc, items: [], driftCount: 0, secretCount: 0 };
        cur.items.push(v);
        if (v.isDrift) cur.driftCount += 1;
        if (v.isSecret) cur.secretCount += 1;
        map.set(svc, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  }

  function renderSurfacesConfig(sm) {
    const allVars = sm.envVars;
    const t = sm.totals;
    const q = (state.dataFilter || "").trim().toLowerCase();
    const facet = state.surfFacet || "";
    const matches = (v) => {
      if (facet === "secrets" && !v.isSecret) return false;
      if (facet === "secrets_drift" && !(v.isSecret && v.isDrift)) return false;
      if (facet === "drift" && !v.isDrift) return false;
      if (facet === "declared_only" && !v.isDeclaredOnly) return false;
      if (q && !v.name.toLowerCase().includes(q) && !v.services.join(",").toLowerCase().includes(q)) return false;
      return true;
    };

    const groups = buildConfigServiceGroups(allVars);
    const maxCount = groups.reduce((m, g) => Math.max(m, g.items.length), 1);
    const byKey = new Map(groups.map((g) => [g.key, g]));
    let selKey = state.surfGroup && byKey.has(state.surfGroup) ? state.surfGroup : null;
    if (!selKey) {
      const worst = [...groups].sort((a, b) => b.driftCount - a.driftCount || b.items.length - a.items.length)[0];
      selKey = worst ? worst.key : null;
    }

    const verdicts = [
      { id: "secrets_drift", icon: "key", label: "Undeclared secrets", count: t.secretsDrift, warn: true },
      { id: "drift", icon: "unlock", label: "Read, undeclared", count: t.driftVars, warn: true },
      { id: "secrets", icon: "key", label: "Secrets", count: t.secrets, warn: false },
      { id: "declared_only", icon: "box", label: "Declared only", count: t.declaredOnlyVars, warn: false },
    ].filter((v) => v.count > 0);
    const verdictHtml =
      '<div class="surf-verdict-bar"><div class="surf-facets">' +
      verdicts.map((v) =>
        '<button class="surf-facet' + (v.warn ? " is-warn" : "") + (facet === v.id ? " active" : "") + '" data-surf-facet-toggle="' + v.id + '">' +
        surfIconSvg(v.icon) + " " + esc(v.label) + ' <span class="mono">' + v.count + "</span></button>"
      ).join("") +
      "</div></div>";

    const serviceTilesHtml =
      '<div class="surf-tile-grid">' +
      groups.map((g) => {
        const gMatched = g.items.filter(matches);
        const dimmed = (q || facet) && gMatched.length === 0;
        const isSel = selKey === g.key;
        const sub = [
          g.secretCount > 0 ? g.secretCount + " secrets" : "",
          g.driftCount > 0 ? g.driftCount + " drift" : "all declared",
        ].filter(Boolean).join(" · ");
        return (
          '<button class="surf-tile' + (dimmed ? " is-dim" : "") + '" data-surf-select-group="' + esc(g.key) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
          '<div class="surf-tile-top"><span class="chk-ico ' + (g.driftCount > 0 ? "t-warn" : "") + '">' + surfIconSvg(g.secretCount > 0 ? "key" : "box") + '</span><span class="surf-tile-num">' + ((q || facet) ? gMatched.length : g.items.length) + "</span></div>" +
          '<div class="surf-tile-title mono">' + esc(g.label) + "</div>" +
          renderSurfBar(g.items.length, g.driftCount, maxCount, 0) +
          '<div class="surf-tile-sub">' + esc(sub) + "</div>" +
          "</button>"
        );
      }).join("") +
      "</div>";

    const sourceList = (q || facet) ? allVars.filter(matches) : (byKey.get(selKey)?.items || []);
    const normalVars = sourceList.filter((v) => !v.isBuiltin).sort((a, b) => {
      const ra = (a.isSecret && a.isDrift) ? 0 : a.isDrift ? 1 : a.isSecret ? 2 : 3;
      const rb = (b.isSecret && b.isDrift) ? 0 : b.isDrift ? 1 : b.isSecret ? 2 : 3;
      return ra - rb || a.name.localeCompare(b.name);
    });
    const builtinVars = sourceList.filter((v) => v.isBuiltin).sort((a, b) => a.name.localeCompare(b.name));
    const shownVars = state.surfTailOpen ? [...normalVars, ...builtinVars] : normalVars;

    const dotCell = (present, isWarnHole, isSecretSq) => {
      if (!present) return '<td class="surf-cfg-c"><span class="surf-dot-off"></span></td>';
      if (isSecretSq) return '<td class="surf-cfg-c" title="Bound as IaC secret"><span class="surf-sq-sec"></span></td>';
      return '<td class="surf-cfg-c"><span class="' + (isWarnHole ? "surf-dot-warn" : "surf-dot-on") + '"></span></td>';
    };
    const cfgRows = shownVars.map((v) => {
      const clickAttr = v.hasSource ? ' data-open-file="' + esc(v.sampleFile) + '" data-open-file-line="1" title="Open ' + esc(v.sampleFile) + '"' : "";
      return (
        '<tr class="surf-cfg-row' + (v.isSecret ? " is-secret" : "") + (v.hasSource ? " is-link" : "") + '"' + clickAttr + ">" +
        '<td class="surf-cfg-name mono">' + esc(v.name) + "</td>" +
        dotCell(v.hasCode, v.isDrift, false) +
        dotCell(v.hasExample, false, false) +
        dotCell(v.hasCi, false, false) +
        dotCell(Boolean(v.iacKind), false, v.iacKind === "secret") +
        "</tr>"
      );
    }).join("");

    const driftInView = normalVars.filter((v) => v.isDrift).length;
    const headTitle = (q || facet) ? (sourceList.length + " matching variables") : (selKey || "Config");
    const headMeta = [normalVars.length + " vars", driftInView > 0 ? driftInView + " undeclared" : "", builtinVars.length > 0 ? builtinVars.length + " built-ins" : ""].filter(Boolean).join(" · ");
    const builtinBtn = builtinVars.length > 0
      ? '<button class="surf-tail-btn" data-surf-toggle-tail="1">' + (state.surfTailOpen ? "Hide " + builtinVars.length + " CI/runtime built-ins" : builtinVars.length + " CI/runtime built-ins ›") + "</button>"
      : "";
    const caveat = facet === "declared_only"
      ? '<div class="surf-caveat">Note: "no read found" is not proof a variable is unused — bundler prefixes like VITE_ or NEXT_PUBLIC_ may be read via import.meta.env.</div>'
      : "";

    return verdictHtml +
      '<div class="surf-split-api">' +
      '<div class="surf-tile-pane">' + serviceTilesHtml + "</div>" +
      '<div class="surf-detail">' +
      '<div class="surf-det-head"><span class="surf-det-title mono">' + esc(headTitle) + '</span><span class="muted mono">' + esc(headMeta) + "</span></div>" +
      caveat +
      '<div class="surf-det-list">' +
      (shownVars.length === 0
        ? '<div class="surf-empty">No variables match the current filter.</div>'
        : '<table class="surf-cfg-tbl"><thead><tr><th class="surf-cfg-name">Variable</th><th class="surf-cfg-c">Code</th><th class="surf-cfg-c">.env</th><th class="surf-cfg-c">CI</th><th class="surf-cfg-c">IaC</th></tr></thead><tbody>' + cfgRows + "</tbody></table>") +
      builtinBtn +
      "</div></div></div>";
  }
`;
}
