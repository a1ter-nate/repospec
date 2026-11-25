export function renderGuidesClientScript(): string {
  return `
  function currentGuideContent() {
    if (state.tab === "diff") {
      if (state.diffMode === "split") {
        return {
          title: "Before → After Split View",
          what: "Compares the system architecture before this change (left) against the new state after this change (right).",
          how: [
            "Green cards/wires are newly introduced; amber cards were modified; red dashed cards were removed.",
            "Switch to Overlay Diff to inspect everything in a single zoomable map, or Files to inspect per-file blast radius.",
          ],
          why: "Helps reviewers spot unintended new dependencies, layer crossings, or external services before merging.",
        };
      }
      return {
        title: "Commit Architecture Diff",
        what: "Overlays every structural change introduced by this commit or PR onto one live system map.",
        how: [
          "Green (+) = newly added module or wire; Amber (~) = modified code; Red dashed (−) = removed from old state.",
          "Unchanged modules stay dimmed so your eyes lock immediately onto the change and its blast radius.",
          "Check the right drawer first for New Issues Introduced vs Issues Resolved.",
        ],
        why: "Line-by-line code diffs hide architecture drift. This view proves in seconds whether a PR makes the system cleaner or introduces new coupling.",
      };
    }
    if (state.tab === "data") {
      return {
        title: "Data, APIs & Runtime Surfaces",
        what: "Inventories every database entity/collection, HTTP endpoint, and environment variable extracted statically from code and schemas.",
        how: [
          "Use Issues only to jump straight to entities violating ownership rules or endpoints missing auth guards.",
          "Click any tab (Entities, HTTP Endpoints, Env & Secrets) and filter by keyword.",
        ],
        why: "Surfaces are where security bugs, data leaks, and breaking API changes happen.",
      };
    }
    if (state.tab === "checks") {
      return {
        title: "Architectural Checks & Invariants",
        what: "Automated structural rules evaluated over the whole codebase — sorted strictly with Failures (Blockers) first, then Warnings.",
        how: [
          "Red FAIL = broken boundary or rule violation to fix now; Amber WARN = tech debt or coupling hotspot to watch.",
          "Click Highlight on map to jump straight to the offending wire, or Copy Fix Brief to hand an engineer or agent the exact file:line context.",
        ],
        why: "Catches architectural rot (circular dependencies, layer bypasses, untested hubs) before they turn into outages.",
      };
    }
    if (state.viewMode === "matrix") {
      return {
        title: "Design Structure Matrix (DSM)",
        what: "Every row imports the column where a number appears — showing exact dependency volume with zero tangled crossing lines.",
        how: [
          "Blue cells = clean top-down imports; Red cells = rule violation or circular dependency loop.",
          "Turn on Violations only to shrink a large grid down to just the broken couplings. Click any cell for exact file:line evidence.",
        ],
        why: "When a graph has dozens of arrows, a matrix reveals circular tangles immediately and shows the smallest import to cut.",
      };
    }
    if (state.activeFileGraph) {
      return {
        title: "File Symbol Callstack & Code",
        what: "Shows every public (exported) symbol on the left, how it calls down into private/internal helper functions in the middle, and external/imported calls on the right.",
        how: [
          "Hover any symbol card to trace its full downward callstack (blue) and upward callers (green).",
          "Click any symbol name or call arrow (:line) to inspect the actual source code highlighted to that exact line.",
        ],
        why: "Lets you trace exactly how a public API entrypoint executes inside a file before reading or editing code.",
      };
    }
    if (state.activeFolder) {
      return {
        title: "Folder Context Map",
        what: "Zooms inside one folder: who calls it (left), every file & subfolder inside it (center), and every dependency or external API it uses (right).",
        how: [
          "Click any file card to inspect its exported functions, env vars, and exact callers/imports.",
          "Double-click any amber folder card (marked with ›) to drill deeper. Red cards/wires show active rule violations inside this folder.",
        ],
        why: "Answers 'what does this folder actually do, who depends on it, and what breaks if I edit it?' in seconds.",
      };
    }
    if (state.activeLayerDiagId) {
      const ld = diagById.get(state.activeLayerDiagId);
      if (ld && ld.category === "layers") {
        return {
          title: "Clean Architecture Layers",
          what: "Groups folders by architectural role from Entry/Routes (left) through Controllers and Services to Persistence & External APIs (right).",
          how: [
            "Healthy code flows strictly left-to-right. Any RED backward arrow is a Layer Inversion violation.",
            "Click a red arrow or badge to see the exact file:line, or double-click any folder to inspect its files.",
          ],
          why: "Keeping layer direction strict prevents database details or UI code from leaking across boundaries.",
        };
      }
      return {
        title: "Unit Module Topology (DAG)",
        what: "Shows every top-level module in this service ordered from entry points (L0 left) down to shared foundations (right).",
        how: [
          "Hover any card to light up its direct outgoing (blue) and incoming (green) wires. Double-click any folder with › to drill inside.",
          "Red borders indicate modules caught in a circular dependency tangle — switch to Matrix (DSM) to see the exact loop.",
        ],
        why: "Lets any engineer understand how execution flows through a service without reading hundreds of files.",
      };
    }
    return {
      title: "System Runtime Map",
      what: "Bird's-eye map of every app, service, library, database, and external API in this repository, flowing left-to-right from Clients to State.",
      how: [
        "Hover any card to trace its incoming (green) and outgoing (blue) connections. Cards with a stacked edge & › can be double-clicked to drill inside.",
        "Red/amber top stripes and corner badges mark units with active architectural findings — click ● fail/warn in the top bar to triage them.",
      ],
      why: "Gives both technical and non-technical stakeholders one shared, live picture of how the entire system fits together.",
    };
  }

  function renderInfoPopoverHtml() {
    if (!state.showGuide) return "";
    const g = currentGuideContent();
    return (
      '<div class="info-popover" id="info-popover">' +
      '<div class="info-pop-head"><div><div class="info-pop-kicker">How to read this screen</div><div>' + esc(g.title) + '</div></div><button class="tbtn" data-toggle-guide="1" title="Close guide">✕</button></div>' +
      "<div><strong>What it shows:</strong> " + esc(g.what) + "</div>" +
      '<ul class="info-pop-list">' + g.how.map((h) => "<li>" + esc(h) + "</li>").join("") + "</ul>" +
      '<div class="fix-note"><strong>Why it matters:</strong> ' + esc(g.why) + "</div>" +
      "</div>"
    );
  }

  function renderLegend(diag) {
    const items = [];
    const detailCount = diag.edges.filter((e) => e.tier === "detail" && !e.violation).length;
    if (state.viewMode === "matrix" && supportsMatrix(diag)) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#38bdf8"></span>Row imports Column (intensity = weight)</span>');
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#ef4444"></span>Rule violation / cycle</span>');
      return '<div class="legend">' + items.join("") + "</div>";
    }
    if (diag.category === "filegraph") {
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#34d399"></span>Public surface</span>');
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#fbbf24"></span>Private helper</span>');
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#38bdf8"></span>Calls down</span>');
      return '<div class="legend">' + items.join("") + "</div>";
    }
    if (diag.edges.some((e) => e.confidence === "observed")) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#64748b"></span>Spine</span>');
    }
    if (diag.edges.some((e) => e.confidence === "inferred")) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="border-top:2px dashed #64748b;height:0"></span>Inferred</span>');
    }
    if (diag.edges.some((e) => e.violation)) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#ef4444"></span>Violation</span>');
    }
    items.push('<span class="leg-item"><span class="leg-swatch" style="background:#38bdf8"></span>Out</span>');
    items.push('<span class="leg-item"><span class="leg-swatch" style="background:#34d399"></span>In</span>');
    if (detailCount > 0 && !state.showAllEdges) {
      items.push('<span class="leg-item">+' + detailCount + " on hover</span>");
    }
    if (diag.foldedCount && diag.foldedCount > 0) {
      items.push('<span class="leg-item">+' + diag.foldedCount + " folded</span>");
    }
    return '<div class="legend">' + items.join("") + "</div>";
  }

  function buildArchitectureStory() {
    const mods = DATA.modules || [];
    if (mods.length === 0) return "";
    const curDiag = activeDiagram();
    const scopedMods = curDiag && curDiag.ownerId
      ? mods.filter((m) => m.unitId === curDiag.ownerId)
      : mods;
    const list = scopedMods.length >= 2 ? scopedMods : mods;
    const entries = list.filter((m) => m.role === "entry" || (m.level === 0 && m.fanOut > 0)).slice(0, 3);
    const cores = list.filter((m) => m.role === "orchestrator" || m.role === "core" || m.role === "adapter").slice(0, 4);
    const foundations = list.filter((m) => m.role === "foundation" || (m.fanOut === 0 && m.fanIn > 0)).slice(0, 3);
    const tangles = new Set(list.map((m) => m.tangleId).filter(Boolean));
    const ioMods = list.filter((m) => m.capabilities.some((c) => c !== "PURE"));
    const pureMods = list.filter((m) => m.capabilities.length === 1 && m.capabilities[0] === "PURE");

    const s1 = entries.length > 0
      ? "Execution enters through <strong>" + entries.map((m) => esc(m.name)).join(", ") + "</strong>" +
        (cores.length > 0 ? ", flows through <strong>" + cores.map((m) => esc(m.name)).join(", ") + "</strong>" : "") +
        (foundations.length > 0 ? ", down to foundational <strong>" + foundations.map((m) => esc(m.name)).join(", ") + "</strong>." : ".")
      : "Organized into <strong>" + list.length + "</strong> modules across " + (new Set(list.map((m) => m.unitSlug)).size) + " unit(s).";
    const s2 = tangles.size > 0
      ? ' <span class="status-fail">' + tangles.size + " cyclic tangle" + (tangles.size === 1 ? "" : "s") + " detected.</span>"
      : ' <span class="status-pass">Clean acyclic module DAG (0 cycles).</span>';
    const s3 = " " + ioMods.length + " IO-boundary module" + (ioMods.length === 1 ? "" : "s") + " · " + pureMods.length + " pure logic module" + (pureMods.length === 1 ? "" : "s") + ".";
    return '<div class="story-box">' + s1 + s2 + s3 + "</div>";
  }

  function capBadgeClass(cap) {
    if (cap === "DB") return "b-purple";
    if (cap === "HTTP") return "b-cyan";
    if (cap === "FS") return "b-warn";
    if (cap === "PROC") return "b-fail";
    if (cap === "ENV") return "b-info";
    return "b-pass";
  }

  function buildFixBriefMarkdown(inv) {
    const lines = [
      "### " + inv.name + " (" + inv.id + " · " + inv.status.toUpperCase() + ")",
      "- **Rule:** " + inv.statement,
    ];
    if (inv.why) lines.push("- **Why it matters:** " + inv.why);
    if (inv.fix) lines.push("- **Fix:** " + inv.fix);
    lines.push("- **Evidence (" + inv.violationCount + "):**");
    for (const ev of (inv.evidence || []).slice(0, 8)) {
      lines.push("  - " + ev.file + (ev.line ? ":" + ev.line : "") + " — " + ev.detail);
    }
    return lines.join("\\n");
  }

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
    return '<span class="mono muted">' + label + "</span>";
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
`;
}
