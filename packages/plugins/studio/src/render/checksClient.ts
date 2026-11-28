export function renderChecksCss(): string {
  return `
  .chk-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg-0); overflow: hidden; }
  .chk-topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: var(--h-bar); padding: 8px 22px; border-bottom: 1px solid var(--line-1); background: var(--bg-1); flex-shrink: 0; }
  .chk-kpis { display: flex; align-items: center; gap: 10px; padding: 12px 22px; border-bottom: 1px solid var(--line-1); background: var(--bg-0); flex-shrink: 0; flex-wrap: wrap; }
  .chk-kpi { background: var(--bg-1); border: 1px solid var(--line-1); border-radius: var(--r-3); padding: 10px 15px; display: inline-flex; align-items: center; gap: 12px; cursor: pointer; color: var(--text-2); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
  .chk-kpi:hover { background: var(--bg-2); border-color: var(--line-2); color: var(--text-1); }
  .chk-kpi.active { background: var(--bg-3); border-color: var(--accent-line); color: var(--text-1); }
  .chk-kpi-n { font-size: 23px; font-weight: 700; line-height: 1; color: var(--text-1); font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; }
  .chk-kpi.k-err .chk-kpi-n { color: var(--err); }
  .chk-kpi.k-warn .chk-kpi-n { color: var(--warn); }
  .chk-kpi.k-ok .chk-kpi-n { color: var(--ok); }
  .chk-kpi-lbl { display: flex; flex-direction: column; text-align: left; gap: 2px; }
  .chk-kpi-t { font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  .chk-kpi-s { font-size: var(--fs-11); color: var(--text-4); font-family: var(--font-mono, monospace); }
  .chk-split { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(480px, 560px) minmax(0, 1fr); }
  .chk-left { background: var(--bg-0); border-right: 1px solid var(--line-1); display: flex; flex-direction: column; min-height: 0; }
  .chk-grid-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
  .chk-tier { display: flex; align-items: center; gap: 8px; font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); margin-bottom: 8px; }
  .chk-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .chk-dot.d-err { background: var(--err); }
  .chk-dot.d-warn { background: var(--warn); }
  .chk-dot.d-hollow { border: 1.5px solid var(--text-4); background: transparent; }
  .chk-dot.d-ok { background: var(--ok); }
  .chk-tile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .chk-tile-grid.is-single { grid-template-columns: 1fr; }
  .chk-tile { background: var(--bg-1); border: 1px solid var(--line-1); border-radius: var(--r-3); padding: 13px 15px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 8px; color: var(--text-2); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); position: relative; }
  .chk-tile:hover { background: var(--bg-2); border-color: var(--line-2); }
  .chk-tile[aria-selected="true"] { background: var(--bg-3); border-color: var(--accent-line); box-shadow: inset 3px 0 0 var(--accent); }
  .chk-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .chk-ico { width: 32px; height: 32px; border-radius: var(--r-2); background: var(--bg-2); border: 1px solid var(--line-1); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-3); }
  .chk-ico.t-err { background: var(--err-soft); border-color: rgba(255,138,138,0.28); color: var(--err); }
  .chk-ico.t-warn { background: var(--warn-soft); border-color: rgba(245,194,107,0.26); color: var(--warn); }
  .chk-ico.t-info { background: var(--accent-soft); border-color: rgba(124,200,255,0.24); color: var(--accent); }
  .chk-tile-cnt { font-size: 20px; font-weight: 700; font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; color: var(--text-1); }
  .chk-tile-cnt.is-err { color: var(--err); }
  .chk-tile-title { font-size: var(--fs-13); font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chk-tile-sub { font-size: var(--fs-11); color: var(--text-3); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chk-tile-dots { display: flex; align-items: center; gap: 5px; }
  .chk-foot { border-top: 1px solid var(--line-1); padding: 10px 16px; background: var(--bg-1); display: flex; flex-direction: column; gap: 7px; flex-shrink: 0; }
  .chk-foot-det summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 7px; font-size: var(--fs-12); color: var(--text-2); user-select: none; }
  .chk-foot-det summary::-webkit-details-marker { display: none; }
  .chk-foot-det summary:hover { color: var(--text-1); }
  .chk-foot-det[open] summary .disc-chev { transform: rotate(90deg); }
  .chk-foot-body { margin-top: 7px; padding-left: 14px; display: flex; flex-direction: column; gap: 5px; font-size: var(--fs-12); color: var(--text-3); max-height: 170px; overflow-y: auto; }
  .chk-right { background: var(--bg-1); overflow-y: auto; padding: 24px 30px 32px; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
  .chk-det-head { display: flex; align-items: center; gap: 14px; }
  .chk-det-title { font-size: 21px; font-weight: 600; color: var(--text-1); line-height: 1.25; }
  .chk-det-sub { font-size: 14px; color: var(--text-3); margin-top: 3px; }
  .chk-det-prose { font-size: 15px; color: var(--text-2); line-height: 1.6; max-width: 72ch; }
  .chk-sec { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid #161e30; padding-top: 16px; }
  .chk-sec-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .chk-ev-row { display: flex; flex-direction: column; gap: 7px; padding: 10px 0; border-bottom: 1px solid rgba(22,30,48,0.65); }
  .chk-ev-row:last-child { border-bottom: 0; }
  .chk-ev-top { display: flex; flex-direction: column; gap: 4px; }
  .chk-ev-detail { font-size: 15px; color: var(--text-1); max-width: 72ch; line-height: 1.5; }
  .chk-ev-loc { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--text-3); flex-wrap: wrap; }
  .chk-loc-btn { background: transparent; border: 0; padding: 0; color: var(--accent); font-family: var(--font-mono, monospace); font-size: 14px; cursor: pointer; text-align: left; }
  .chk-loc-btn:hover { text-decoration: underline; }
  .chk-open-link { background: transparent; border: 0; padding: 0; color: var(--text-3); font-size: 13.5px; cursor: pointer; font-family: var(--font-mono, monospace); }
  .chk-open-link:hover { color: var(--text-1); }
  .chk-excerpt { background: #0a0f19; border: 1px solid #161e30; border-radius: 6px; overflow-x: auto; margin-top: 5px; padding: 8px 0; font-family: var(--font-mono, monospace); font-size: 13.5px; line-height: 1.55; }
  .chk-code-ln { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 0 14px 0 8px; white-space: pre; }
  .chk-code-ln.is-hit { background: rgba(124,200,255,0.12); box-shadow: inset 2px 0 0 var(--accent); }
  .chk-code-no { color: var(--text-4); text-align: right; user-select: none; }
  .chk-grp-block { border-bottom: 1px solid rgba(22,30,48,0.65); padding: 8px 0; }
  .chk-grp-block summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 0; font-size: 14.5px; color: var(--text-1); user-select: none; }
  .chk-grp-block summary::-webkit-details-marker { display: none; }
  .chk-grp-block[open] summary .disc-chev { transform: rotate(90deg); }
  .chk-grp-rows { padding: 6px 0 6px 16px; display: flex; flex-direction: column; gap: 7px; }
  .chk-grp-item { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 14.5px; color: var(--text-2); }
  .chk-acts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .chk-acts .tbtn { background: #151c2c; border-color: var(--rs-border-hi); color: var(--text-1); }
  .chk-acts .tbtn:hover { background: #1d263b; border-color: var(--accent); }
  .chk-meta-foot { font-size: 13px; color: var(--text-4); font-family: var(--font-mono, monospace); padding-top: 10px; border-top: 1px solid #161e30; }
  .chk-guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .chk-guide-card { background: var(--bg-0); border: 1px solid var(--line-1); border-radius: var(--r-3); padding: 14px 16px; display: flex; flex-direction: column; gap: 7px; } .chk-guide-k { font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); } .chk-guide-card.is-good { border-color: rgba(74, 222, 128, 0.24); background: rgba(74, 222, 128, 0.04); } .chk-guide-card.is-good .chk-guide-k { color: var(--ok); }
  .chk-sources { display: flex; flex-wrap: wrap; gap: 8px; } .chk-src-link { display: inline-flex; align-items: center; gap: 5px; font-size: 13.5px; color: var(--accent); background: var(--bg-0); border: 1px solid var(--line-1); border-radius: var(--r-2); padding: 6px 12px; text-decoration: none; } .chk-src-link:hover { border-color: var(--accent); background: var(--bg-2); }
  .chk-shell button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  @media (max-width: 1100px) { .chk-split { grid-template-columns: 1fr; } .chk-left { max-height: 46vh; border-right: 0; border-bottom: 1px solid #161e30; } .chk-guide-grid { grid-template-columns: 1fr; } }`;
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

  function checkIconSvg(kind) {
    const p = {
      layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
      plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>',
      bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>',
      cycle: '<path d="M21 12a9 9 0 0 0-15.5-6.3L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15.5 6.3L21 16"/><path d="M21 21v-5h-5"/>',
      db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
      key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l2 2"/><path d="M19 4l2 2"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
      state: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6"/>',
    };
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (p[kind] || p.shield) + "</svg>";
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
    if (!item) return '<div class="surf-empty">Select a visual tile on the left to inspect code and fix guidance.</div>';
    const inv = invById.get(item.id) || item;
    const rawEv = inv.evidence || [];
    const truncNote = item.violationCount > rawEv.length ? rawEv.length + " of " + item.violationCount + " loaded" : item.violationCount + " place" + (item.violationCount === 1 ? "" : "s");
    const whereMeta = [truncNote, item.unitSummary].filter(Boolean).join(" · ");
    const icoTone = item.tier === "broken" ? "t-err" : item.tier === "fix_next" ? "t-warn" : "";

    let evHtml = "";
    if (item.isEnvDrift) {
      evHtml =
        '<div class="chk-det-prose">Environment variables read in code without a declaration are mapped in Surfaces → Config with per-service provenance columns (Code, Example, CI, IaC).</div>' +
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
          const lbl = it.detail || it.subject;
          return (
            '<div class="chk-grp-item">' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(lbl) + '">' + esc(lbl) + "</span>" +
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

    const sourcesList = Array.isArray(item.sources) && item.sources.length > 0 ? item.sources : (Array.isArray(inv.sources) ? inv.sources : []);
    const sourcesHtml = sourcesList.length > 0
      ? '<div class="chk-sec"><div class="surf-sec-k">Research &amp; Sources</div><div class="chk-sources">' + sourcesList.map((s) => '<a class="chk-src-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + " ↗</a>").join("") + "</div></div>"
      : "";
    const benefitText = item.benefit || inv.benefit || "";
    const explainGridHtml = '<div class="chk-guide-grid"><div class="chk-guide-card"><div class="chk-guide-k">What is wrong</div><div class="chk-det-prose">' + esc(item.statement || item.name) + '</div></div><div class="chk-guide-card"><div class="chk-guide-k">Why it matters</div><div class="chk-det-prose">' + esc(item.why || item.statement) + "</div></div></div>";
    const fixGridHtml = item.fix || benefitText
      ? '<div class="chk-sec"><div class="chk-guide-grid">' + (item.fix ? '<div class="chk-guide-card"><div class="chk-guide-k">What change fixes it</div><div class="chk-det-prose">' + esc(item.fix) + "</div></div>" : "") + (benefitText ? '<div class="chk-guide-card is-good"><div class="chk-guide-k">Why this change is good</div><div class="chk-det-prose">' + esc(benefitText) + "</div></div>" : "") + "</div></div>"
      : "";

    return (
      '<div class="chk-det-head"><span class="chk-ico ' + icoTone + '">' + checkIconSvg(item.iconKind) + '</span><div><div class="chk-det-title">' + esc(item.shortTitle || item.name) + '</div><div class="chk-det-sub">' + esc(item.name) + "</div></div></div>" +
      explainGridHtml +
      fixGridHtml +
      '<div class="chk-sec"><div class="chk-sec-head"><span class="surf-sec-k">Where this happens</span><span class="mono muted" style="font-size:12px">' + esc(whereMeta) + "</span></div>" + evHtml + "</div>" +
      sourcesHtml +
      '<div class="chk-acts">' +
      '<button class="tbtn tbtn-accent" data-copy-inv="' + esc(item.id) + '" title="Copy plain-English brief, evidence, fix, and sources (c)">Copy brief</button>' +
      jumpBtn +
      "</div>" +
      '<div class="chk-meta-foot">' + esc(item.id + " · " + item.rung) + "</div>"
    );
  }

  function renderPlaceDetailPane(place) {
    if (!place) return '<div class="surf-empty">No files currently trip multiple checks in loaded evidence.</div>';
    const firstLine = place.findings[0]?.line || 1;
    return (
      '<div class="chk-det-head"><span class="chk-ico ' + (place.hasBroken ? "t-err" : "t-warn") + '">' + checkIconSvg("doc") + '</span><div><div class="chk-det-title mono">' + esc(place.baseName) + '</div><div class="chk-det-sub mono">' + esc(place.file) + "</div></div></div>" +
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
    const c = cm.counts;
    const view = state.checksView === "places" ? "places" : "rules";
    const activeItems = cm.items.filter((i) => i.tier !== "holding");
    const holdingItems = cm.items.filter((i) => i.tier === "holding");
    const passedItems = holdingItems.filter((i) => i.status === "pass");
    const naItems = holdingItems.filter((i) => i.status === "na");

    const selItem = cm.items.find((i) => i.id === state.checkId) || cm.items.find((i) => i.id === cm.defaultCheckId) || cm.items[0] || null;
    const selPlace = cm.places.find((p) => p.file === state.checkPlace) || cm.places[0] || null;

    const kpiStrip =
      '<div class="chk-kpis">' +
      '<button class="chk-kpi k-err" data-chk-tier-jump="broken"><span class="chk-kpi-n">' + c.broken + '</span><span class="chk-kpi-lbl"><span class="chk-kpi-t">Broken</span><span class="chk-kpi-s">' + c.brokenHits + " hits</span></span></button>" +
      '<button class="chk-kpi k-warn" data-chk-tier-jump="fix_next"><span class="chk-kpi-n">' + c.fixNext + '</span><span class="chk-kpi-lbl"><span class="chk-kpi-t">Fix Next</span><span class="chk-kpi-s">' + c.fixNextHits + " hits</span></span></button>" +
      '<button class="chk-kpi" data-chk-tier-jump="patterns"><span class="chk-kpi-n">' + c.patterns + '</span><span class="chk-kpi-lbl"><span class="chk-kpi-t">Patterns</span><span class="chk-kpi-s">' + c.patternHits + " hits</span></span></button>" +
      '<button class="chk-kpi" data-chk-tier-jump="housekeeping"><span class="chk-kpi-n">' + c.housekeeping + '</span><span class="chk-kpi-lbl"><span class="chk-kpi-t">Chores</span><span class="chk-kpi-s">' + c.housekeepingHits + " hits</span></span></button>" +
      '<div class="chk-kpi k-ok" style="cursor:default"><span class="chk-kpi-n">' + c.passed + '</span><span class="chk-kpi-lbl"><span class="chk-kpi-t">Holding</span><span class="chk-kpi-s">guardrails</span></span></div>' +
      "</div>";

    let leftGridHtml = "";
    if (view === "places") {
      leftGridHtml = cm.places.length === 0
        ? '<div class="surf-empty">No files trip two or more checks in loaded evidence.</div>'
        : '<div class="chk-tile-grid">' + cm.places.map((p) => {
            const isSel = selPlace && selPlace.file === p.file;
            const dots = Array.from({ length: Math.min(5, p.checkCount) }).map((_, di) =>
              '<span class="chk-dot ' + (p.hasBroken && di === 0 ? "d-err" : "d-warn") + '"></span>'
            ).join("");
            return (
              '<button class="chk-tile" data-chk-select-place="' + esc(p.file) + '" aria-selected="' + (isSel ? "true" : "false") + '">' +
              '<div class="chk-tile-top"><span class="chk-ico ' + (p.hasBroken ? "t-err" : "t-warn") + '">' + checkIconSvg("doc") + '</span><span class="chk-tile-cnt' + (p.hasBroken ? " is-err" : "") + '">' + p.checkCount + "</span></div>" +
              '<div class="chk-tile-title mono">' + esc(p.baseName) + "</div>" +
              '<div class="chk-tile-sub">' + esc(p.unit) + "</div>" +
              '<div class="chk-tile-dots">' + dots + '<span class="muted mono" style="font-size:11px;margin-left:4px">' + p.hitCount + " hits</span></div>" +
              "</button>"
            );
          }).join("") + "</div>";
    } else {
      const tiers = [
        { key: "broken", label: "Broken", dot: "d-err", icoTone: "t-err" },
        { key: "fix_next", label: "Fix Next", dot: "d-warn", icoTone: "t-warn" },
        { key: "patterns", label: "Patterns", dot: "d-hollow", icoTone: "" },
        { key: "housekeeping", label: "Housekeeping", dot: "d-hollow", icoTone: "" },
      ];
      leftGridHtml = tiers.map((t) => {
        const list = activeItems.filter((i) => i.tier === t.key);
        if (list.length === 0) return "";
        return (
          '<div><div class="chk-tier"><span class="chk-dot ' + t.dot + '"></span>' + esc(t.label) + '</div><div class="chk-tile-grid' + (list.length === 1 ? " is-single" : "") + '">' +
          list.map((it) => {
            const isSel = selItem && selItem.id === it.id;
            const sub = it.wherePreview || it.unitSummary || (it.violationCount + " hits");
            return (
              '<button class="chk-tile" data-chk-select="' + esc(it.id) + '" aria-selected="' + (isSel ? "true" : "false") + '" title="' + esc(it.name) + '">' +
              '<div class="chk-tile-top"><span class="chk-ico ' + t.icoTone + '">' + checkIconSvg(it.iconKind) + '</span><span class="chk-tile-cnt' + (t.key === "broken" ? " is-err" : "") + '">' + it.violationCount + "</span></div>" +
              '<div class="chk-tile-title">' + esc(it.shortTitle || it.name) + "</div>" +
              '<div class="chk-tile-sub">' + esc(sub) + "</div>" +
              "</button>"
            );
          }).join("") + "</div></div>"
        );
      }).join("");
      if (!leftGridHtml) leftGridHtml = '<div class="surf-empty">0 broken rules and 0 active warnings.</div>';
    }

    const scopeLabel = DATA.verification && DATA.verification.coverageSource !== "static_reachability_1hop"
      ? DATA.verification.coverageSource + " coverage"
      : "static 1-hop reach";
    const scopeNote = (DATA.verification && DATA.verification.scopeNotes && DATA.verification.scopeNotes[0]) ||
      "Static structural graph & local invariant analysis only. Behavioral semantics, runtime auth enforcement, and cross-repo wire contracts require runtime E2E/contract proofs.";
    const holdingHtml =
      '<details class="chk-foot-det"><summary><span class="disc-chev">▸</span><span class="chk-dot d-ok"></span>Holding ' + passedItems.length + (naItems.length > 0 ? " · " + naItems.length + " N/A" : "") + '</summary><div class="chk-foot-body">' +
      passedItems.map((p) => '<div>✓ ' + esc(p.shortTitle || p.name) + "</div>").join("") +
      naItems.map((n) => '<div>— ' + esc(n.shortTitle || n.name) + (n.applicabilityReason ? " (" + esc(n.applicabilityReason) + ")" : "") + "</div>").join("") +
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
      '<button class="seg-btn' + (view === "places" ? " active" : "") + '" data-chk-view="places">Hotspots (' + cm.places.length + ")</button>" +
      "</span>" +
      "</div>" +
      '<button class="info-btn' + (state.showGuide ? " active" : "") + '" data-toggle-guide="1" title="How to read Checks">?</button>' +
      "</div>" +
      renderInfoPopoverHtml() +
      kpiStrip +
      '<div class="chk-split">' +
      '<div class="chk-left"><div class="chk-grid-wrap">' + leftGridHtml + '</div><div class="chk-foot">' + holdingHtml + scopeHtml + "</div></div>" +
      '<div class="chk-right">' + (view === "places" ? renderPlaceDetailPane(selPlace) : renderCheckDetailPane(selItem)) + "</div>" +
      "</div></div>"
    );
  }

  function handleChecksClick(target) {
    const tierJump = target.closest("[data-chk-tier-jump]");
    if (tierJump) {
      const tk = tierJump.getAttribute("data-chk-tier-jump");
      state.checksView = "rules";
      const first = checksModelData().items.find((i) => i.tier === tk);
      if (first) state.checkId = first.id;
      state.checkExpEv = null;
      render();
      return true;
    }
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
      if (pl) copyTextToClipboard(buildPlaceBriefMarkdown(pl), copyPlace, "Copy brief");
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
    if (ev.key === "1") { ev.preventDefault(); state.checksView = "rules"; state.checkExpEv = null; render(); return true; }
    if (ev.key === "2") { ev.preventDefault(); state.checksView = "places"; state.checkExpEv = null; render(); return true; }
    if (ev.key === "c" && !ev.metaKey && !ev.ctrlKey) {
      const btn = document.querySelector(".chk-right [data-copy-inv], .chk-right [data-chk-copy-place]");
      if (btn instanceof HTMLElement) { ev.preventDefault(); btn.click(); return true; }
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "j" || ev.key === "k") {
      const tiles = Array.from(document.querySelectorAll(".chk-grid-wrap .chk-tile"));
      if (tiles.length === 0) return false;
      ev.preventDefault();
      const cur = tiles.findIndex((el) => el.getAttribute("aria-selected") === "true");
      const down = ev.key === "ArrowDown" || ev.key === "j";
      const next = down ? (cur < 0 ? 0 : Math.min(tiles.length - 1, cur + 1)) : (cur <= 0 ? 0 : cur - 1);
      const el = tiles[next];
      if (el instanceof HTMLElement) { el.click(); el.scrollIntoView({ block: "nearest" }); }
      return true;
    }
    return false;
  }
`;
}
