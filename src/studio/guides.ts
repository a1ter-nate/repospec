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
    if (state.tab === "flows") {
      const sub = state.flowsSubtab || "workflows";
      if (sub === "hubs") {
        return {
          title: "Data Hubs — Who Owns & Mutates Each Field?",
          what: "Flips the codebase inside-out around one database entity (like Device or Company). Each row shows: Who writes the field (left) → The stored field (middle) → Who reads or derives from it (right).",
          principles: "Single Source of Truth: a field is safest when one owner mutates it. When multiple unrelated files write the same field (amber 'multi-writer risk'), they can overwrite each other or drift out of sync when one path forgets a side-effect. Dashed 'read-time derived' boxes show the cleanest alternative: computing the value on read instead of storing a copy that goes stale.",
          how: [
            "Blue row = single clear writer (easy to reason about and safely refactor).",
            "Amber row = multi-writer risk (2+ files independently mutate this field — check for split-brain bugs or race conditions).",
            "Dashed row = read-time derived (computed on read from source data instead of persisted).",
            "Click any row to open every writer & reader file on the right with exact line numbers and source code.",
          ],
          why: "Most subtle production bugs aren't inside one function — they happen when three different endpoints silently mutate the same database field under different assumptions.",
        };
      }
      if (sub === "machines") {
        return {
          title: "Statecharts — Valid Lifecycles & Transition Guards",
          what: "Maps the declared states of an entity (left-to-right from START) along with the exact rules (guards) required to move between them.",
          principles: "Explicit State Machines prevent impossible states (like shipping a device that never passed QC). Guards make business invariants visible instead of hiding them inside scattered if-statements.",
          how: [
            "Green card = starting state. Solid blue/amber arrows = forward progression; amber pills above arrows show required guard fields.",
            "Dashed arcs = rollback or retry paths. The crimson bottom bus ('any active state → terminal') summarizes universal exit states without spaghetti lines.",
            "Click any state box to inspect all incoming/outgoing transitions, guard conditions, callers, and source code.",
          ],
          why: "Lets you verify in seconds which transitions are legal, which ones are guarded, and which states are terminal.",
        };
      }
      if (sub === "async") {
        return {
          title: "Cross-Boundary Async Handoffs",
          what: "Stitches together producers and consumers separated by queues, Pub/Sub topics, webhooks, database triggers, or cron schedules — links that static import graphs cannot see.",
          principles: "Loose coupling via messaging hides control flow. Knowing the delivery guarantee (at-least-once vs. best-effort) tells you whether consumers must be idempotent or if events can be silently dropped.",
          how: [
            "Each row connects Producer (left) → Transport & Delivery Semantics (center) → Consumer (right).",
            "Click any row to jump straight to the producer and consumer source code in the right drawer.",
          ],
          why: "Prevents 'where does this event actually get handled?' blind spots across services and background workers.",
        };
      }
      return {
        title: "Work Flows — Swimlane Waterfalls",
        what: "Traces what happens step-by-step inside one entrypoint (HTTP route, job, or handler) across Client, Handler, Datastore, Cache, and External/Async lanes.",
        principles: "Latency & Consistency (DDIA): every serial await left of the green HTTP 200 wall makes the caller wait. Sending notifications or clearing caches BEFORE the database commits creates a red RACE WINDOW where readers see stale data or get notified of a failed write.",
        how: [
          "Toggle Current ⇄ What-If (Optimized) to see how parallelizing independent awaits and moving non-critical side effects past the response wall shrinks latency and closes race windows.",
          "Click any step bar to see what triggers this flow, resolved callee modules, DDIA hazards, and syntax-highlighted code.",
          "Use Hazards only to focus directly on flows with race windows, write-on-poll, or serial await bottlenecks.",
        ],
        why: "Shows runtime behavior and hidden latency/consistency traps at a glance without reading hundreds of lines of async code.",
      };
    }
    if (state.tab === "data") {
      return {
        title: "Surfaces — Grouped by Domain & Service",
        what: "Every external contract grouped cleanly instead of one giant table: HTTP Endpoints by API domain, Entities by owning domain, Env & Secrets by service, and Foreign Keys by parent table.",
        principles: "Boundary Contracts: most security issues, breaking client changes, and misconfigurations live right at the edges where code meets HTTP, databases, or environment secrets.",
        how: [
          "Click any domain or service header to expand its rows; amber left borders call out public/unannotated routes, ownership issues, or secrets.",
          "Typing in the filter box automatically expands matching groups so you can pinpoint a route, collection, or secret in one second.",
          "Click Data Hub ↗ on any entity to inspect who writes and reads its fields, or Trace E2E → on an endpoint.",
        ],
        why: "Gives you a calm architectural index of hundreds of routes, collections, and secrets without drowning in raw rows.",
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
        title: "Inferred Module Topology (L0–L4 DAG)",
        what: "Shows every top-level module in this unit ordered by inferred import-graph tiers from entry points (L0 left) down to foundations (right). These are inferred topological tiers, distinct from enforced Clean Architecture layer policies.",
        how: [
          "Hover any card to light up its direct outgoing (blue) and incoming (green) wires. Double-click any folder with › to drill inside.",
          "Red borders indicate modules caught in a circular dependency tangle — switch to Matrix (DSM) to see the exact loop.",
        ],
        why: "Lets any engineer understand how execution flows through a service without reading hundreds of files.",
      };
    }
    if (state.tab === "map" && state.mapMode === "delivery") {
      return {
        title: "Delivery — CI Workflows, Builds & Infrastructure",
        what: "Maps how code ships: GitHub Actions / CI workflows, container image builds, and Terraform / IaC resources linked to the services they deploy.",
        principles: "Deployment Topology: knowing which pipeline builds which service and which cloud resources it touches prevents surprise production blast radius.",
        how: [
          "Click any workflow, build, or IaC card to inspect its file and linked services.",
          "Switch back to Runtime, Packages, or Domains anytime in the top-left Map bar.",
        ],
        why: "Connects source code directly to the pipelines and cloud infrastructure running it.",
      };
    }
    return {
      title: "System Runtime Map",
      what: "Bird's-eye map of every app, service, library, database, and external API in this repository, flowing left-to-right from Clients to State.",
      principles: "Structure at a Glance: start wide at services and boundaries, then double-click to zoom progressively into Modules → Folders → Symbol Callstack & Code.",
      how: [
        "Hover any card to trace incoming (green) and outgoing (blue) connections. Double-click cards with › to drill inside.",
        "Click any service or folder to see its connections plus a collapsed 'Flows From This Location' launcher.",
      ],
      why: "Gives engineers and stakeholders one shared, live picture of how the entire system fits together.",
    };
  }

  function renderInfoPopoverHtml() {
    if (!state.showGuide) return "";
    const g = currentGuideContent();
    return (
      '<div class="info-popover" id="info-popover">' +
      '<div class="info-pop-head"><div><div class="info-pop-kicker">How to read this screen</div><div>' + esc(g.title) + '</div></div><button class="tbtn" data-toggle-guide="1" title="Close guide">✕</button></div>' +
      "<div><strong>What it shows:</strong> " + esc(g.what) + "</div>" +
      (g.principles ? '<div class="why-note"><strong>Principle &amp; what can go wrong:</strong> ' + esc(g.principles) + "</div>" : "") +
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
    const hasLocal = typeof ddIdxByPath !== "undefined" && ddIdxByPath.has(file);
    const fileHtml = hasLocal
      ? '<span class="row-link mono" data-open-file="' + esc(file) + '"' + (line ? ' data-open-file-line="' + line + '"' : "") + ' title="Open file code & symbol callstack">' + label + "</span>"
      : '<span class="mono muted">' + label + "</span>";
    if (gh) {
      return '<span class="links-row">' + fileHtml + '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">GitHub ↗</a></span>';
    }
    return fileHtml;
  }

  function renderInlineSourceDisclosure(filePath, focusLine, opts) {
    if (!filePath || typeof ddIdxByPath === "undefined" || !ddIdxByPath.has(filePath)) return "";
    const idx = ddIdxByPath.get(filePath);
    const f = DD_FILES[idx];
    if (!f) return "";
    ensureFileSourcesLoaded();
    const base = filePath.split("/").pop() || filePath;
    const ln = Number(focusLine) || 1;
    const isOpen = opts && typeof opts.open === "boolean" ? opts.open : true;
    return (
      '<div class="sec">' +
      renderDisclosure({
        title: "Source Code · " + base,
        meta: filePath,
        badge: f.l + "L",
        badgeClass: "b-info",
        tone: "info",
        open: isOpen,
        bodyHtml: renderCodeBlockHtml(idx, f.p, 1, f.l, ln, true, false),
      }) +
      "</div>"
    );
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
