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
`;
}
