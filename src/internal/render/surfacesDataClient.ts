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
      '<div class="surf-ledger">' +
      groups.map((g) =>
        '<button class="surf-led-row" data-surf-select-group="' + esc(g.key) + '" aria-selected="' + (selKey === g.key ? "true" : "false") + '">' +
        '<span class="surf-led-lbl mono">' + esc(g.label) + "</span>" +
        renderSurfBar(g.items.length, g.cascadeCount, maxC, 0) +
        '<span class="surf-led-num mono">' + g.items.length + "</span>" +
        "</button>"
      ).join("") +
      "</div>" +
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

  function renderSurfacesData(sm) {
    const t = sm.totals;
    const mode = sm.foreignKeys.length > 0 && state.surfDataMode === "relations" ? "relations" : "footprint";
    const modeToggle = sm.foreignKeys.length > 0
      ? '<span class="seg-group" style="margin-right:8px">' +
        '<button class="seg-btn' + (mode === "footprint" ? " active" : "") + '" data-surf-datamode-set="footprint">Footprint</button>' +
        '<button class="seg-btn' + (mode === "relations" ? " active" : "") + '" data-surf-datamode-set="relations">Relations (' + sm.foreignKeys.length + ")</button>" +
        "</span>"
      : "";
    if (mode === "relations") {
      const verdictRel = '<div class="surf-verdict-bar">' + modeToggle +
        (t.cascadeFks > 0 ? '<span class="surf-facet is-warn">' + t.cascadeFks + " cascading deletes</span>" : '<span class="muted mono">' + t.foreignKeys + " foreign keys</span>") +
        "</div>";
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
      { id: "cross_domain", label: "cross-domain", count: t.crossDomainEntities, warn: false },
      { id: "no_contract", label: "no contract", count: t.noContractEntities, warn: true },
      { id: "no_domain", label: "no domain", count: t.noDomainEntities, warn: false },
      { id: "undeclared", label: "undeclared", count: t.undeclaredEntities, warn: false },
    ].filter((v) => v.count > 0);
    const verdictHtml = '<div class="surf-verdict-bar">' + modeToggle + verdicts.map((v) =>
      '<button class="surf-facet' + (v.warn ? " is-warn" : "") + (facet === v.id ? " active" : "") + '" data-surf-facet-toggle="' + v.id + '">' +
      esc(v.label) + ' <span class="mono">' + v.count + "</span></button>"
    ).join("") + "</div>";

    const domHeadCells = domains.map((d) =>
      '<th class="surf-mx-col" title="' + esc(d) + '">' + esc(shortDomainCol(d)) + "</th>"
    ).join("");
    const matrixRows = visibleRows.map((e) => {
      const domSet = new Set(e.domains);
      const isSel = selEntity && selEntity.id === e.id;
      const barPct = e.totalRefs > 0 ? Math.max(2, Math.min(100, (e.totalRefs / maxRefs) * 100)) : 0;
      const cells = domains.map((d) => {
        if (!domSet.has(d)) return '<td class="surf-mx-cell"><span class="surf-dot-off"></span></td>';
        const dotCls = e.noContract ? "surf-dot-warn" : "surf-dot-on";
        return '<td class="surf-mx-cell" title="' + esc(e.entity + " in " + d) + '"><span class="' + dotCls + '"></span></td>';
      }).join("");
      return (
        '<tr class="surf-mx-row' + (isSel ? " is-sel" : "") + '" data-surf-select-row="' + esc(e.id) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
        '<td class="surf-mx-name mono">' + esc(e.entity) + "</td>" +
        '<td class="surf-mx-ref"><span class="surf-bar-track sm"><span class="' + (e.noContract ? "surf-bar-warn" : "surf-bar-base") + '" style="width:' + barPct.toFixed(1) + '%"></span></span><span class="surf-mx-n mono">' + e.totalRefs + "</span></td>" +
        cells +
        "</tr>"
      );
    }).join("");
    const tailToggle = tail.length > 0
      ? '<button class="surf-tail-btn" data-surf-toggle-tail="1">' +
        (state.surfTailOpen ? "Hide " + tail.length + " small collections" : tail.length + " small collections (3 refs or fewer, one domain or none) ›") +
        "</button>"
      : "";

    let detailHtml = '<div class="surf-empty">Select a collection to inspect domains, files, and field writers.</div>';
    if (selEntity) {
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
      detailHtml =
        '<div class="surf-det-head"><span class="surf-det-title mono">' + esc(selEntity.entity) + '</span><span class="muted mono">' + esc(statusBits) + "</span></div>" +
        '<div class="surf-det-pad">' + domChips + hubSec + fileSec + invSec + "</div>";
    }

    return verdictHtml +
      '<div class="surf-split-data">' +
      '<div class="surf-matrix-pane">' +
      (visibleRows.length === 0
        ? '<div class="surf-empty">No collections match the current filter.</div>'
        : '<table class="surf-mx-tbl"><thead><tr><th class="surf-mx-name">Collection</th><th class="surf-mx-ref">Refs</th>' + domHeadCells + "</tr></thead><tbody>" + matrixRows + "</tbody></table>") +
      tailToggle +
      "</div>" +
      '<div class="surf-detail">' + detailHtml + "</div>" +
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
      { id: "secrets_drift", label: "secrets read, declared nowhere", count: t.secretsDrift, warn: true },
      { id: "drift", label: "read, not declared", count: t.driftVars, warn: true },
      { id: "secrets", label: "secrets", count: t.secrets, warn: false },
      { id: "declared_only", label: "declared, no read found", count: t.declaredOnlyVars, warn: false },
    ].filter((v) => v.count > 0);
    const verdictHtml = '<div class="surf-verdict-bar">' + verdicts.map((v) =>
      '<button class="surf-facet' + (v.warn ? " is-warn" : "") + (facet === v.id ? " active" : "") + '" data-surf-facet-toggle="' + v.id + '">' +
      esc(v.label) + ' <span class="mono">' + v.count + "</span></button>"
    ).join("") + "</div>";

    const ledgerHtml = groups.map((g) => {
      const gMatched = g.items.filter(matches);
      const dimmed = (q || facet) && gMatched.length === 0;
      return (
        '<button class="surf-led-row' + (dimmed ? " is-dim" : "") + '" data-surf-select-group="' + esc(g.key) + '" aria-selected="' + (selKey === g.key ? "true" : "false") + '">' +
        '<span class="surf-led-lbl mono">' + esc(g.label) + "</span>" +
        renderSurfBar(g.items.length, g.driftCount, maxCount, 0) +
        '<span class="surf-led-num mono">' + ((q || facet) ? gMatched.length : g.items.length) + "</span>" +
        "</button>"
      );
    }).join("");

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
        '<td class="surf-cfg-name mono">' + esc(v.name) + (v.isDrift ? ' <span class="surf-warn-txt">undeclared</span>' : "") + "</td>" +
        dotCell(v.hasCode, v.isDrift, false) +
        dotCell(v.hasExample, false, false) +
        dotCell(v.hasCi, false, false) +
        dotCell(Boolean(v.iacKind), false, v.iacKind === "secret") +
        "</tr>"
      );
    }).join("");

    const driftInView = normalVars.filter((v) => v.isDrift).length;
    const headTitle = (q || facet) ? (sourceList.length + " matching variables") : (selKey || "Config");
    const headMeta = [
      normalVars.length + " vars",
      driftInView > 0 ? driftInView + " read, not declared" : "",
      builtinVars.length > 0 ? builtinVars.length + " runner built-ins" : "",
    ].filter(Boolean).join(" · ");
    const builtinBtn = builtinVars.length > 0
      ? '<button class="surf-tail-btn" data-surf-toggle-tail="1">' +
        (state.surfTailOpen ? "Hide " + builtinVars.length + " CI/runtime built-ins" : builtinVars.length + " CI/runtime built-ins (excluded from drift) ›") +
        "</button>"
      : "";
    const caveat = facet === "declared_only"
      ? '<div class="surf-caveat">Note: "no read found" is not proof a variable is unused — bundler prefixes like VITE_ or NEXT_PUBLIC_ may be read via import.meta.env.</div>'
      : "";

    return verdictHtml +
      '<div class="surf-split-api">' +
      '<div class="surf-ledger">' + ledgerHtml + "</div>" +
      '<div class="surf-detail">' +
      '<div class="surf-det-head"><span class="surf-det-title mono">' + esc(headTitle) + '</span><span class="muted mono">' + esc(headMeta) + "</span></div>" +
      caveat +
      '<div class="surf-det-list">' +
      (shownVars.length === 0
        ? '<div class="surf-empty">No variables match the current filter.</div>'
        : '<table class="surf-cfg-tbl"><thead><tr><th class="surf-cfg-name">Variable</th><th class="surf-cfg-c">Code</th><th class="surf-cfg-c">Example</th><th class="surf-cfg-c">CI</th><th class="surf-cfg-c">IaC</th></tr></thead><tbody>' + cfgRows + "</tbody></table>") +
      builtinBtn +
      "</div></div></div>";
  }
`;
}
