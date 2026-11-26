export function renderSurfacesApiClientScript(): string {
  return `
  function buildApiPrefixGroups(endpoints) {
    const raw = new Map();
    for (const ep of endpoints) {
      const k = ep.prefix || "(root)";
      const cur = raw.get(k) || { key: k, label: k, items: [], unknownCount: 0, publicCount: 0, subMap: new Map() };
      cur.items.push(ep);
      if (ep.guardClass === "unknown") cur.unknownCount += 1;
      else if (ep.guardClass === "public") cur.publicCount += 1;
      if (k !== "(root)" && ep.subPrefix) {
        const sk = k + "/" + ep.subPrefix;
        const sub = cur.subMap.get(sk) || { key: sk, label: ep.subPrefix, items: [], unknownCount: 0, publicCount: 0 };
        sub.items.push(ep);
        if (ep.guardClass === "unknown") sub.unknownCount += 1;
        else if (ep.guardClass === "public") sub.publicCount += 1;
        cur.subMap.set(sk, sub);
      }
      raw.set(k, cur);
    }
    const sorted = Array.from(raw.values()).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
    const major = [];
    const smallItems = [];
    let smallPrefixCount = 0;
    let smallUnknown = 0;
    let smallPublic = 0;
    for (const g of sorted) {
      if (g.key !== "(root)" && g.items.length < 3 && sorted.length > 6) {
        smallPrefixCount += 1;
        smallItems.push(...g.items);
        smallUnknown += g.unknownCount;
        smallPublic += g.publicCount;
      } else {
        const subAll = Array.from(g.subMap.values()).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
        const subMajor = [];
        const subTail = [];
        let subTailCount = 0;
        let subTailUnk = 0;
        let subTailPub = 0;
        for (const s of subAll) {
          if (subAll.length > 10 && s.items.length < 4) {
            subTailCount += 1;
            subTail.push(...s.items);
            subTailUnk += s.unknownCount;
            subTailPub += s.publicCount;
          } else {
            subMajor.push(s);
          }
        }
        if (subTail.length > 0) {
          subMajor.push({
            key: g.key + "/__small__",
            label: subTailCount + " small",
            items: subTail,
            unknownCount: subTailUnk,
            publicCount: subTailPub,
            isSmall: true,
          });
        }
        major.push({ ...g, children: g.items.length >= 20 ? subMajor : [] });
      }
    }
    if (smallItems.length > 0) {
      major.push({
        key: "__small__",
        label: smallPrefixCount + " small prefixes",
        items: smallItems,
        unknownCount: smallUnknown,
        publicCount: smallPublic,
        children: [],
        isSmall: true,
      });
    }
    return major;
  }

  function renderApiRowHtml(ep, prefixToDim, dominantGuard, expandedId) {
    const isExp = expandedId === ep.id;
    const mCls = ep.method === "DELETE" ? "m-del" : ep.isWrite ? "m-write" : "m-read";
    let pathHtml = esc(ep.path);
    if (prefixToDim && ep.path.startsWith(prefixToDim) && ep.path.length > prefixToDim.length) {
      pathHtml = '<span class="surf-path-dim">' + esc(prefixToDim) + "</span>" + esc(ep.path.slice(prefixToDim.length));
    }
    let guardHtml = "";
    if (ep.guardClass === "unknown") {
      guardHtml = '<span class="surf-warn-txt" title="Static analysis saw no route-level guard; may sit behind app.use middleware">no guard seen</span>';
    } else if (ep.guardClass === "public") {
      guardHtml = '<span class="surf-pub-pill">public</span>';
    } else if (ep.guardName && ep.guardName !== dominantGuard) {
      guardHtml = '<span class="surf-guard-txt mono">' + esc(ep.guardName) + "</span>";
    }
    const locText = ep.hasSource ? (ep.file.split("/").pop() + ":" + ep.line) : "";
    const detailHtml = isExp
      ? '<div class="surf-row-exp">' +
        '<div class="surf-exp-meta">' +
        '<span><span class="muted">service</span> <span class="mono">' + esc(shortPkg(ep.unit)) + "</span></span>" +
        '<span><span class="muted">source</span> <span class="mono">' + esc(ep.file + (ep.line > 1 ? ":" + ep.line : "")) + "</span></span>" +
        (ep.guardClass === "guarded" ? '<span><span class="muted">guard</span> <span class="mono">' + esc(ep.guardExpr || ep.guardName) + "</span></span>" : "") +
        "</div>" +
        '<div class="surf-exp-acts">' +
        (ep.hasSource ? '<button class="tbtn" data-open-file="' + esc(ep.file) + '" data-open-file-line="' + ep.line + '">Open code →</button>' : "") +
        (ep.hasSource ? '<button class="tbtn" data-open-e2e="' + esc(ep.file + "::-1") + '">Trace E2E →</button>' : "") +
        "</div></div>"
      : "";
    return (
      '<div class="surf-det-wrap' + (isExp ? " is-open" : "") + '">' +
      '<button class="surf-det-row" data-surf-select-row="' + esc(ep.id) + '" data-surf-row-toggle="1" aria-selected="' + (isExp ? "true" : "false") + '">' +
      '<span class="surf-meth mono ' + mCls + '">' + esc(ep.method) + "</span>" +
      '<span class="surf-path mono">' + pathHtml + "</span>" +
      '<span class="surf-guard-col">' + guardHtml + "</span>" +
      '<span class="surf-loc-col mono">' + esc(locText) + "</span>" +
      "</button>" +
      detailHtml +
      "</div>"
    );
  }

  function renderSurfacesApi(sm) {
    const allEps = sm.endpoints;
    const t = sm.totals;
    const q = (state.dataFilter || "").trim().toLowerCase();
    const facet = state.surfFacet || "";
    const matchesFacet = (ep) => {
      if (facet === "no_guard") return ep.guardClass === "unknown";
      if (facet === "public") return ep.guardClass === "public";
      if (facet === "writes") return ep.isWrite;
      if (facet === "has_handler") return ep.hasSource;
      if (facet === "contract_only") return !ep.hasSource;
      return true;
    };
    const matchesQ = (ep) => !q || ep.path.toLowerCase().includes(q) || ep.method.toLowerCase().includes(q) || ep.guardName.toLowerCase().includes(q) || shortPkg(ep.unit).toLowerCase().includes(q);
    const filtered = allEps.filter((ep) => matchesFacet(ep) && matchesQ(ep));

    const groups = buildApiPrefixGroups(allEps);
    const maxCount = groups.reduce((m, g) => Math.max(m, g.items.length), 1);

    const flatLookup = new Map();
    for (const g of groups) {
      flatLookup.set(g.key, g);
      for (const c of g.children || []) flatLookup.set(c.key, c);
    }

    let selKey = state.surfGroup && flatLookup.has(state.surfGroup) ? state.surfGroup : null;
    if (!selKey) {
      const worst = [...groups].sort((a, b) => b.unknownCount - a.unknownCount || b.items.length - a.items.length)[0];
      selKey = worst ? worst.key : null;
    }

    const verdicts = [
      { id: "no_guard", label: "no guard seen", count: t.noGuardEndpoints, warn: true },
      { id: "public", label: "public", count: t.publicEndpoints, warn: false },
      { id: "writes", label: "writes", count: t.writeEndpoints, warn: false },
      { id: "has_handler", label: "has handler", count: t.sourceEndpoints, warn: false },
    ].filter((v) => v.count > 0);
    const verdictHtml = '<div class="surf-verdict-bar">' + verdicts.map((v) =>
      '<button class="surf-facet' + (v.warn ? " is-warn" : "") + (facet === v.id ? " active" : "") + '" data-surf-facet-toggle="' + v.id + '">' +
      esc(v.label) + ' <span class="mono">' + v.count + "</span></button>"
    ).join("") + "</div>";

    const selParent = selKey && selKey.includes("/") ? selKey.split("/")[0] : selKey;
    const ledgerHtml = groups.map((g) => {
      const gMatched = g.items.filter((ep) => matchesFacet(ep) && matchesQ(ep));
      const dimmed = (q || facet) && gMatched.length === 0;
      const isSel = selKey === g.key;
      const showKids = (g.children || []).length > 0 && (selParent === g.key);
      const kidsHtml = showKids
        ? '<div class="surf-led-kids">' + g.children.map((c) => {
            const cMatched = c.items.filter((ep) => matchesFacet(ep) && matchesQ(ep));
            const cDim = (q || facet) && cMatched.length === 0;
            const cSel = selKey === c.key;
            return (
              '<button class="surf-led-row is-child' + (cDim ? " is-dim" : "") + '" data-surf-select-group="' + esc(c.key) + '" aria-selected="' + (cSel ? "true" : "false") + '">' +
              '<span class="surf-led-lbl mono">' + esc(c.label) + "</span>" +
              renderSurfBar(c.items.length, c.unknownCount, maxCount, c.publicCount) +
              '<span class="surf-led-num mono">' + ((q || facet) ? cMatched.length : c.items.length) + "</span>" +
              "</button>"
            );
          }).join("") + "</div>"
        : "";
      return (
        '<button class="surf-led-row' + (dimmed ? " is-dim" : "") + '" data-surf-select-group="' + esc(g.key) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
        '<span class="surf-led-lbl mono">' + esc(g.label) + "</span>" +
        renderSurfBar(g.items.length, g.unknownCount, maxCount, g.publicCount) +
        '<span class="surf-led-num mono">' + ((q || facet) ? gMatched.length : g.items.length) + "</span>" +
        "</button>" +
        kidsHtml
      );
    }).join("");

    let detailHead = "";
    let detailRowsHtml = "";
    if (q || facet) {
      const byPrefix = new Map();
      for (const ep of filtered) {
        const k = ep.prefix || "(root)";
        const arr = byPrefix.get(k) || [];
        arr.push(ep);
        byPrefix.set(k, arr);
      }
      detailHead = '<div class="surf-det-head"><span class="surf-det-title">' + filtered.length + " matching routes</span>" +
        (facet ? '<span class="muted mono">' + esc(facet.replace("_", " ")) + "</span>" : "") + "</div>";
      detailRowsHtml = filtered.length === 0
        ? '<div class="surf-empty">No routes match the current filter.</div>'
        : Array.from(byPrefix.entries()).map(([pref, list]) => {
            const sortedList = [...list].sort((a, b) => (a.guardClass === "unknown" ? 0 : 1) - (b.guardClass === "unknown" ? 0 : 1) || a.path.localeCompare(b.path));
            const pDim = pref !== "(root)" ? "/" + pref : "";
            return '<div class="surf-sticky-sub mono">' + esc(pref) + " · " + list.length + "</div>" +
              sortedList.slice(0, 120).map((ep) => renderApiRowHtml(ep, pDim, "", state.surfRow)).join("");
          }).join("");
    } else {
      const grp = selKey ? flatLookup.get(selKey) : null;
      const items = grp ? [...grp.items] : [];
      items.sort((a, b) => {
        const ra = a.guardClass === "unknown" ? 0 : a.guardClass === "public" ? 1 : 2;
        const rb = b.guardClass === "unknown" ? 0 : b.guardClass === "public" ? 1 : 2;
        return ra - rb || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
      });
      const guardFreq = new Map();
      for (const ep of items) {
        if (ep.guardClass === "guarded" && ep.guardName) guardFreq.set(ep.guardName, (guardFreq.get(ep.guardName) || 0) + 1);
      }
      let dominantGuard = "";
      let dominantCount = 0;
      for (const [gn, cnt] of guardFreq.entries()) {
        if (cnt > dominantCount) { dominantGuard = gn; dominantCount = cnt; }
      }
      if (dominantCount < items.length * 0.6) dominantGuard = "";
      const unkCnt = items.filter((e) => e.guardClass === "unknown").length;
      const pubCnt = items.filter((e) => e.guardClass === "public").length;
      const prefixDim = selKey && !selKey.includes("__small__") && selKey !== "(root)" ? "/" + selKey : "";
      const metaBits = [
        items.length + " routes",
        unkCnt > 0 ? unkCnt + " no guard seen" : "",
        pubCnt > 0 ? pubCnt + " public" : "",
        dominantGuard ? "default guard: " + dominantGuard : "",
      ].filter(Boolean).join(" · ");
      detailHead = '<div class="surf-det-head"><span class="surf-det-title mono">' + esc(grp ? (selKey && selKey.includes("/") && !selKey.includes("__small__") ? "/" + selKey : grp.label) : "Routes") + '</span><span class="muted mono">' + esc(metaBits) + "</span></div>";
      detailRowsHtml = items.length === 0
        ? '<div class="surf-empty">Select a prefix on the left to inspect its routes.</div>'
        : items.map((ep) => renderApiRowHtml(ep, prefixDim, dominantGuard, state.surfRow)).join("");
    }

    return verdictHtml +
      '<div class="surf-split-api">' +
      '<div class="surf-ledger">' + ledgerHtml + "</div>" +
      '<div class="surf-detail">' + detailHead + '<div class="surf-det-list">' + detailRowsHtml + "</div></div>" +
      "</div>";
  }
`;
}
