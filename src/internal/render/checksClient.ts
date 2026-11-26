export function renderChecksCss(): string {
  return `
  .chk-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #0b0f19; overflow: hidden; }
  .chk-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 22px; border-bottom: 1px solid #161e30; background: #0d121e; flex-shrink: 0; }
  .chk-verdict { font-size: 14px; font-weight: 500; color: var(--text-1); padding: 9px 22px; border-bottom: 1px solid #161e30; background: #0b0f19; flex-shrink: 0; }
  .chk-split { flex: 1; min-height: 0; display: grid; grid-template-columns: 390px minmax(0, 1fr); }
  .chk-left { background: #0d121e; border-right: 1px solid #161e30; display: flex; flex-direction: column; min-height: 0; }
  .chk-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .chk-tier { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); padding: 10px 8px 4px; }
  .chk-tier:first-child { padding-top: 2px; }
  .chk-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .chk-dot.d-err { background: var(--err); }
  .chk-dot.d-warn { background: var(--warn); }
  .chk-dot.d-hollow { border: 1.5px solid var(--text-4); background: transparent; }
  .chk-dot.d-ok { background: var(--ok); }
  .chk-row { background: transparent; border: 0; border-radius: 5px; width: 100%; padding: 5px 8px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; color: var(--text-2); transition: background 0.12s ease; }
  .chk-row.is-compact { padding: 4px 8px; min-height: 28px; justify-content: center; }
  .chk-row:hover { background: rgba(255,255,255,0.04); color: var(--text-1); }
  .chk-row[aria-selected="true"] { background: #151c2c; color: var(--text-1); box-shadow: inset 2px 0 0 var(--accent); }
  .chk-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .chk-row-name { font-size: 13px; font-weight: 500; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chk-row-cnt { font-size: 12px; color: var(--text-3); flex-shrink: 0; }
  .chk-row-cnt.is-err { color: var(--err); font-weight: 600; }
  .chk-row-where { font-size: 11.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chk-foot { border-top: 1px solid #161e30; padding: 8px 12px; background: #0b0f19; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .chk-foot-det summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); user-select: none; }
  .chk-foot-det summary::-webkit-details-marker { display: none; }
  .chk-foot-det summary:hover { color: var(--text-1); }
  .chk-foot-det[open] summary .disc-chev { transform: rotate(90deg); }
  .chk-foot-body { margin-top: 6px; padding-left: 13px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-3); max-height: 150px; overflow-y: auto; }
  .chk-right { background: #0d121e; overflow-y: auto; padding: 20px 26px 28px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .chk-det-title { font-size: 16px; font-weight: 600; color: var(--text-1); line-height: 1.3; max-width: 72ch; }
  .chk-det-prose { font-size: 13px; color: var(--text-2); line-height: 1.55; max-width: 72ch; }
  .chk-sec { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #161e30; padding-top: 14px; }
  .chk-sec-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .chk-ev-row { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid rgba(22,30,48,0.65); }
  .chk-ev-row:last-child { border-bottom: 0; }
  .chk-ev-top { display: flex; flex-direction: column; gap: 3px; }
  .chk-ev-detail { font-size: 13px; color: var(--text-1); max-width: 72ch; line-height: 1.45; }
  .chk-ev-loc { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-3); flex-wrap: wrap; }
  .chk-loc-btn { background: transparent; border: 0; padding: 0; color: var(--accent); font-family: var(--font-mono, monospace); font-size: 12px; cursor: pointer; text-align: left; }
  .chk-loc-btn:hover { text-decoration: underline; }
  .chk-open-link { background: transparent; border: 0; padding: 0; color: var(--text-3); font-size: 11.5px; cursor: pointer; font-family: var(--font-mono, monospace); }
  .chk-open-link:hover { color: var(--text-1); }
  .chk-excerpt { background: #0a0f19; border: 1px solid #161e30; border-radius: 6px; overflow-x: auto; margin-top: 4px; padding: 6px 0; font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.5; }
  .chk-code-ln { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; padding: 0 12px 0 6px; white-space: pre; }
  .chk-code-ln.is-hit { background: rgba(124,200,255,0.12); box-shadow: inset 2px 0 0 var(--accent); }
  .chk-code-no { color: var(--text-4); text-align: right; user-select: none; }
  .chk-grp-block { border-bottom: 1px solid rgba(22,30,48,0.65); padding: 6px 0; }
  .chk-grp-block summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 4px 0; font-size: 12.5px; color: var(--text-1); user-select: none; }
  .chk-grp-block summary::-webkit-details-marker { display: none; }
  .chk-grp-block[open] summary .disc-chev { transform: rotate(90deg); }
  .chk-grp-rows { padding: 4px 0 4px 14px; display: flex; flex-direction: column; gap: 5px; }
  .chk-grp-item { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12.5px; color: var(--text-2); }
  .chk-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chk-acts .tbtn { background: #151c2c; border-color: var(--rs-border-hi); color: var(--text-1); }
  .chk-acts .tbtn:hover { background: #1d263b; border-color: var(--accent); }
  .chk-meta-foot { font-size: 11.5px; color: var(--text-4); font-family: var(--font-mono, monospace); padding-top: 8px; border-top: 1px solid #161e30; }
  .chk-shell button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  @media (max-width: 1080px) { .chk-split { grid-template-columns: 1fr; } .chk-left { max-height: 44vh; border-right: 0; border-bottom: 1px solid #161e30; } }`;
}

export function renderChecksClientScript(): string {
  return `
  function checksModelData() {
    return DATA.checksModel || {
      verdict: "",
      counts: { broken: 0, brokenHits: 0, fixNext: 0, fixNextHits: 0, patterns: 0, patternHits: 0, housekeeping: 0, housekeepingHits: 0, passed: 0, na: 0 },
      items: [],
      places: [],
      defaultCheckId: null,
    };
  }

  function renderCheckExcerpt(filePath, focusLine) {
    if (!filePath || !ddIdxByPath.has(filePath)) return "";
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return "";
    if (!FILE_SOURCES) {
      ensureFileSourcesLoaded();
      return '<div class="chk-excerpt"><div class="muted" style="padding:4px 12px">Loading excerpt...</div></div>';
    }
    const raw = FILE_SOURCES[idx];
    if (typeof raw !== "string") return "";
    const lines = raw.split("\\n");
    const ln = Math.max(1, Math.min(lines.length, Number(focusLine) || 1));
    const start = Math.max(1, ln - 3);
    const end = Math.min(lines.length, ln + 3);
    const lang = langChipForPath(filePath).toLowerCase();
    const rows = [];
    for (let i = start; i <= end; i += 1) {
      const codeHtml = typeof highlightCodeLine === "function" ? highlightCodeLine(lines[i - 1] || "", lang) : esc(lines[i - 1] || "");
      rows.push('<div class="chk-code-ln' + (i === ln ? " is-hit" : "") + '"><span class="chk-code-no">' + i + "</span><span>" + codeHtml + "</span></div>");
    }
    return '<div class="chk-excerpt">' + rows.join("") + "</div>";
  }

  function buildPlaceBriefMarkdown(place) {
    const lines = [
      "### " + place.file + " (" + place.checkCount + " checks · " + place.hitCount + " findings)",
      "- **Unit:** " + place.unit,
      "- **Findings in line order:**",
    ];
    for (const f of place.findings) {
      lines.push("  - L" + (f.line || 1) + " [" + f.checkName + "] " + f.detail);
    }
    return lines.join("\\n");
  }

  function renderCheckEvidenceRow(ev, rowKey, defaultOpen, showSubject) {
    const hasSrc = Boolean(ev.file && ddIdxByPath.has(ev.file));
    const isExp = state.checkExpEv === rowKey || (state.checkExpEv === null && defaultOpen && hasSrc);
    const gh = githubUrl(ev.file, ev.line);
    const label = (ev.file || ".") + (ev.line ? ":" + ev.line : "");
    const locBtn = hasSrc
      ? '<button class="chk-loc-btn" data-chk-toggle-ev="' + esc(rowKey) + '" title="Toggle inline code excerpt">' + esc(label) + "</button>"
      : '<span class="mono muted">' + esc(label) + "</span>";
    const openBtn = hasSrc
      ? '<button class="chk-open-link" data-chk-open-file="' + esc(ev.file) + '" data-chk-open-line="' + (ev.line || 1) + '">Open file</button>'
      : "";
    const ghBtn = gh ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener" title="Open on GitHub">↗</a>' : "";
    const text = showSubject && ev.subject ? ev.subject : (ev.detail || ev.subject || "");
    return (
      '<div class="chk-ev-row">' +
      '<div class="chk-ev-top"><div class="chk-ev-detail">' + esc(text) + '</div><div class="chk-ev-loc">' + locBtn + openBtn + ghBtn + "</div></div>" +
      (isExp ? renderCheckExcerpt(ev.file, ev.line) : "") +
      "</div>"
    );
  }

  function renderCheckDetailPane(item) {
    if (!item) return '<div class="surf-empty">Select a check on the left to inspect evidence and fix guidance.</div>';
    const inv = invById.get(item.id) || item;
    const rawEv = inv.evidence || [];
    const truncNote = item.violationCount > rawEv.length ? rawEv.length + " of " + item.violationCount + " loaded" : item.violationCount + " place" + (item.violationCount === 1 ? "" : "s");
    const whereMeta = [truncNote, item.unitSummary].filter(Boolean).join(" · ");

    let evHtml = "";
    if (item.isEnvDrift) {
      evHtml =
        '<div class="chk-det-prose">Environment variables read in code without a matching declaration are tracked in Surfaces → Config with exact per-service drift columns (Code, Example, CI, IaC).</div>' +
        '<div class="chk-acts"><button class="tbtn tbtn-accent" data-chk-jump="surfaces_config">Open Config Drift →</button></div>';
    } else if (item.violationCount <= 6) {
      evHtml = rawEv.map((ev, idx) => renderCheckEvidenceRow(ev, item.id + "::" + idx, idx === 0, false)).join("");
    } else if (item.violationCount <= 12) {
      evHtml = item.unitGroups.map((ug) =>
        '<details class="chk-grp-block" open><summary><span><span class="disc-chev">▸</span> <span class="mono">' + esc(ug.unit) + '</span></span><span class="mono muted">' + ug.count + '</span></summary><div class="chk-grp-rows">' +
        ug.files.flatMap((fg) => fg.items.map((it, ii) => renderCheckEvidenceRow({ file: fg.file, line: it.line, subject: it.subject, detail: it.detail }, item.id + "::" + fg.file + "::" + ii, false, false))).join("") +
        "</div></details>"
      ).join("");
    } else {
      evHtml = item.fileGroups.map((fg, fi) =>
        '<details class="chk-grp-block"' + (fi < 5 ? " open" : "") + '><summary><span><span class="disc-chev">▸</span> <span class="mono">' + esc(fg.file) + '</span></span><span class="mono muted">' + fg.count + '</span></summary><div class="chk-grp-rows">' +
        fg.items.slice(0, 10).map((it, ii) => {
          const rk = item.id + "::fg::" + fi + "::" + ii;
          const isExp = state.checkExpEv === rk;
          const hasSrc = ddIdxByPath.has(fg.file);
          const lbl = it.subject || it.detail;
          return (
            '<div class="chk-grp-item">' +
            '<span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(lbl) + "</span>" +
            (hasSrc ? '<button class="chk-loc-btn" data-chk-toggle-ev="' + esc(rk) + '">:' + (it.line || 1) + "</button>" : '<span class="mono muted">:' + (it.line || 1) + "</span>") +
            "</div>" +
            (isExp ? renderCheckExcerpt(fg.file, it.line) : "")
          );
        }).join("") +
        "</div></details>"
      ).join("");
    }

    let jumpBtn = "";
    const jt = item.jumpTarget;
    if (jt) {
      if (jt.kind === "map") jumpBtn = '<button class="tbtn" data-show-inv="' + esc(item.id) + '">Show on map</button>';
      else if (jt.kind === "flows") jumpBtn = '<button class="tbtn" data-chk-jump="flows" data-chk-flow="' + esc(jt.flowId || "") + '">Open in Flows</button>';
      else if (jt.kind === "surfaces_config") jumpBtn = '<button class="tbtn" data-chk-jump="surfaces_config">Open in Config</button>';
      else if (jt.kind === "surfaces_data") jumpBtn = '<button class="tbtn" data-chk-jump="surfaces_data">Open in Data</button>';
      else if (jt.kind === "matrix") jumpBtn = '<button class="tbtn" data-chk-jump="matrix">Open matrix</button>';
    }

    return (
      '<div class="chk-det-title">' + esc(item.name) + "</div>" +
      '<div class="chk-det-prose">' + esc(item.why || item.statement) + "</div>" +
      '<div class="chk-sec"><div class="chk-sec-head"><span class="surf-sec-k">Where</span><span class="mono muted" style="font-size:12px">' + esc(whereMeta) + "</span></div>" + evHtml + "</div>" +
      (item.fix ? '<div class="chk-sec"><div class="surf-sec-k">Fix</div><div class="chk-det-prose">' + esc(item.fix) + "</div></div>" : "") +
      '<div class="chk-acts">' +
      '<button class="tbtn tbtn-accent" data-copy-inv="' + esc(item.id) + '" title="Copy rule, grouped evidence, and fix instructions (c)">Copy brief</button>' +
      jumpBtn +
      "</div>" +
      '<div class="chk-meta-foot">' + esc(item.id + " · " + item.rung) + "</div>"
    );
  }

  function renderPlaceDetailPane(place) {
    if (!place) return '<div class="surf-empty">No files currently trip multiple checks in loaded evidence.</div>';
    const firstLine = place.findings[0]?.line || 1;
    return (
      '<div class="chk-det-title mono">' + esc(place.file) + "</div>" +
      '<div class="chk-det-prose">' + place.checkCount + " distinct checks (" + place.hitCount + " findings from loaded evidence) in " + esc(place.unit) + ".</div>" +
      '<div class="chk-sec"><div class="surf-sec-k">Findings in line order</div>' +
      place.findings.map((f, idx) => renderCheckEvidenceRow({ file: place.file, line: f.line, subject: f.subject, detail: "[" + f.checkName + "] " + f.detail }, "place::" + place.file + "::" + idx, idx === 0, false)).join("") +
      "</div>" +
      '<div class="chk-acts">' +
      '<button class="tbtn tbtn-accent" data-chk-copy-place="' + esc(place.file) + '">Copy brief</button>' +
      (place.hasSource ? '<button class="tbtn" data-chk-open-file="' + esc(place.file) + '" data-chk-open-line="' + firstLine + '">Open file →</button>' : "") +
      "</div>"
    );
  }

  function renderChecksTab() {
    const cm = checksModelData();
    const view = state.checksView === "places" ? "places" : "rules";
    const activeItems = cm.items.filter((i) => i.tier !== "holding");
    const holdingItems = cm.items.filter((i) => i.tier === "holding");
    const passedItems = holdingItems.filter((i) => i.status === "pass");
    const naItems = holdingItems.filter((i) => i.status === "na");

    const selItem = cm.items.find((i) => i.id === state.checkId) || cm.items.find((i) => i.id === cm.defaultCheckId) || cm.items[0] || null;
    const selPlace = cm.places.find((p) => p.file === state.checkPlace) || cm.places[0] || null;

    let leftListHtml = "";
    if (view === "places") {
      leftListHtml = cm.places.length === 0
        ? '<div class="surf-empty">No files trip two or more checks in loaded evidence.</div>'
        : cm.places.map((p) => {
            const isSel = selPlace && selPlace.file === p.file;
            return (
              '<button class="chk-row" data-chk-select-place="' + esc(p.file) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
              '<div class="chk-row-top"><span class="chk-row-name mono">' + esc(p.baseName) + '</span><span class="chk-row-cnt mono' + (p.hasBroken ? " is-err" : "") + '">' + p.checkCount + " checks</span></div>" +
              '<div class="chk-row-where mono">' + esc(p.unit + " · " + p.hitCount + " hits") + "</div>" +
              "</button>"
            );
          }).join("");
    } else {
      const tiers = [
        { key: "broken", label: "Broken", dot: "d-err", compact: false },
        { key: "fix_next", label: "Fix next", dot: "d-warn", compact: false },
        { key: "patterns", label: "Patterns", dot: "d-hollow", compact: true },
        { key: "housekeeping", label: "Housekeeping", dot: "d-hollow", compact: true },
      ];
      leftListHtml = tiers.map((t) => {
        const list = activeItems.filter((i) => i.tier === t.key);
        if (list.length === 0) return "";
        return (
          '<div class="chk-tier"><span class="chk-dot ' + t.dot + '"></span>' + esc(t.label) + "</div>" +
          list.map((it) => {
            const isSel = selItem && selItem.id === it.id;
            return (
              '<button class="chk-row' + (t.compact ? " is-compact" : "") + '" data-chk-select="' + esc(it.id) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
              '<div class="chk-row-top"><span class="chk-row-name">' + esc(it.name) + '</span><span class="chk-row-cnt mono' + (t.key === "broken" ? " is-err" : "") + '">' + it.violationCount + "</span></div>" +
              (!t.compact && it.wherePreview ? '<div class="chk-row-where mono">' + esc(it.wherePreview) + "</div>" : "") +
              "</button>"
            );
          }).join("")
        );
      }).join("");
      if (!leftListHtml) {
        leftListHtml = '<div class="surf-empty">0 broken rules and 0 active warnings.</div>';
      }
    }

    const scopeLabel = DATA.verification && DATA.verification.coverageSource !== "static_reachability_1hop"
      ? DATA.verification.coverageSource + " coverage"
      : "static 1-hop reach";
    const scopeNote = (DATA.verification && DATA.verification.scopeNotes && DATA.verification.scopeNotes[0]) ||
      "Static structural graph & local invariant analysis only. Behavioral semantics, runtime auth enforcement, and cross-repo wire contracts require runtime E2E/contract proofs.";

    const holdingHtml =
      '<details class="chk-foot-det"><summary><span class="disc-chev">▸</span><span class="chk-dot d-ok"></span>Holding ' + passedItems.length + (naItems.length > 0 ? " · " + naItems.length + " not applicable" : "") + '</summary><div class="chk-foot-body">' +
      passedItems.map((p) => '<div>✓ ' + esc(p.name) + "</div>").join("") +
      naItems.map((n) => '<div>— ' + esc(n.name) + (n.applicabilityReason ? " (" + esc(n.applicabilityReason) + ")" : "") + "</div>").join("") +
      "</div></details>";
    const scopeHtml =
      '<details class="chk-foot-det"><summary><span class="disc-chev">▸</span>Verification Scope · <span class="mono">' + esc(scopeLabel) + '</span></summary><div class="chk-foot-body">' + esc(scopeNote) + "</div></details>";

    return (
      '<div class="chk-shell">' +
      '<div class="chk-topbar">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="surf-det-title">Checks</span>' +
      '<span class="seg-group">' +
      '<button class="seg-btn' + (view === "rules" ? " active" : "") + '" data-chk-view="rules">Rules (' + activeItems.length + ")</button>" +
      '<button class="seg-btn' + (view === "places" ? " active" : "") + '" data-chk-view="places">Places (' + cm.places.length + ")</button>" +
      "</span>" +
      "</div>" +
      '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read Checks">?</button>' +
      "</div>" +
      renderInfoPopoverHtml() +
      '<div class="chk-verdict">' + esc(cm.verdict) + "</div>" +
      '<div class="chk-split">' +
      '<div class="chk-left"><div class="chk-list">' + leftListHtml + '</div><div class="chk-foot">' + holdingHtml + scopeHtml + "</div></div>" +
      '<div class="chk-right">' + (view === "places" ? renderPlaceDetailPane(selPlace) : renderCheckDetailPane(selItem)) + "</div>" +
      "</div></div>"
    );
  }

  function handleChecksClick(target) {
    const viewBtn = target.closest("[data-chk-view]");
    if (viewBtn) {
      state.checksView = viewBtn.getAttribute("data-chk-view") || "rules";
      state.checkExpEv = null;
      render();
      return true;
    }
    const selBtn = target.closest("[data-chk-select]");
    if (selBtn) {
      state.checkId = selBtn.getAttribute("data-chk-select");
      state.checkExpEv = null;
      render();
      return true;
    }
    const selPlaceBtn = target.closest("[data-chk-select-place]");
    if (selPlaceBtn) {
      state.checkPlace = selPlaceBtn.getAttribute("data-chk-select-place");
      state.checkExpEv = null;
      render();
      return true;
    }
    const evToggle = target.closest("[data-chk-toggle-ev]");
    if (evToggle) {
      const k = evToggle.getAttribute("data-chk-toggle-ev");
      state.checkExpEv = state.checkExpEv === k ? "" : k;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const openFileBtn = target.closest("[data-chk-open-file]");
    if (openFileBtn) {
      const fp = openFileBtn.getAttribute("data-chk-open-file") || "";
      const fl = Number(openFileBtn.getAttribute("data-chk-open-line")) || 1;
      state.returnToChecks = state.checkId || true;
      openFileCodeView(fp, fl, -1);
      return true;
    }
    const returnChk = target.closest("[data-return-to-checks]");
    if (returnChk) {
      state.tab = "checks";
      state.activeFileGraph = null;
      if (typeof state.returnToChecks === "string") state.checkId = state.returnToChecks;
      state.returnToChecks = null;
      render();
      return true;
    }
    const copyPlace = target.closest("[data-chk-copy-place]");
    if (copyPlace) {
      const fp = copyPlace.getAttribute("data-chk-copy-place");
      const pl = checksModelData().places.find((p) => p.file === fp);
      if (pl && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(buildPlaceBriefMarkdown(pl)).catch(() => {});
      }
      copyPlace.textContent = "Copied ✓";
      setTimeout(() => { copyPlace.textContent = "Copy brief"; }, 1400);
      return true;
    }
    const jumpBtn = target.closest("[data-chk-jump]");
    if (jumpBtn) {
      const kind = jumpBtn.getAttribute("data-chk-jump");
      if (kind === "surfaces_config") {
        state.tab = "data";
        state.dataSubtab = "env";
        state.surfFacet = "drift";
        state.surfGroup = null;
        render();
        return true;
      }
      if (kind === "surfaces_data") {
        state.tab = "data";
        state.dataSubtab = "entities";
        state.surfFacet = "no_contract";
        render();
        return true;
      }
      if (kind === "flows") {
        const fid = jumpBtn.getAttribute("data-chk-flow");
        state.tab = "flows";
        state.flowsSubtab = "workflows";
        if (fid) state.activeFlowId = fid;
        else state.flowHazardsOnly = true;
        ensureFileSourcesLoaded();
        render();
        return true;
      }
      if (kind === "matrix") {
        state.tab = "map";
        state.viewMode = "matrix";
        state.dsmViolOnly = true;
        render();
        return true;
      }
    }
    const jumpChkId = target.closest("[data-jump-check-id]");
    if (jumpChkId) {
      state.tab = "checks";
      state.checksView = "rules";
      state.checkId = jumpChkId.getAttribute("data-jump-check-id");
      state.checkExpEv = null;
      render();
      return true;
    }
    return false;
  }

  function handleChecksKeydown(ev) {
    if (state.tab !== "checks") return false;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return false;
    if (ev.key === "1") {
      ev.preventDefault();
      state.checksView = "rules";
      state.checkExpEv = null;
      render();
      return true;
    }
    if (ev.key === "2") {
      ev.preventDefault();
      state.checksView = "places";
      state.checkExpEv = null;
      render();
      return true;
    }
    if (ev.key === "c" && !ev.metaKey && !ev.ctrlKey) {
      const btn = document.querySelector(".chk-right [data-copy-inv], .chk-right [data-chk-copy-place]");
      if (btn instanceof HTMLElement) {
        ev.preventDefault();
        btn.click();
        return true;
      }
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "j" || ev.key === "k") {
      const rows = Array.from(document.querySelectorAll(".chk-list .chk-row"));
      if (rows.length === 0) return false;
      ev.preventDefault();
      const cur = rows.findIndex((el) => el.getAttribute("aria-selected") === "true");
      const down = ev.key === "ArrowDown" || ev.key === "j";
      const next = down ? (cur < 0 ? 0 : Math.min(rows.length - 1, cur + 1)) : (cur <= 0 ? 0 : cur - 1);
      const targetEl = rows[next];
      if (targetEl instanceof HTMLElement) {
        targetEl.click();
        targetEl.scrollIntoView({ block: "nearest" });
      }
      return true;
    }
    return false;
  }
`;
}
