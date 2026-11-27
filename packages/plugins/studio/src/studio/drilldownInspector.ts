export function renderDrilldownInspectorScript(): string {
  return `
  function renderFileInspector(filePath) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return renderBriefingDrawer();
    const f = DD_FILES[idx];
    ensureFileSourcesLoaded();
    const inLinks = ddInByIdx.get(idx) || [];
    const outLinks = ddOutByIdx.get(idx) || [];
    const fileEndpoints = DATA.surfaces.endpoints.filter((ep) => ep.file === f.p);
    const fileFindings = DATA.invariants.filter((inv) => (inv.status === "fail" || inv.status === "warn") && inv.evidence.some((ev) => ev.file === f.p));

    const capsList = f.c.filter((c) => c !== "PURE");
    const subMeta = f.u + " · " + f.l + "L · " + f.e + " exp" + (capsList.length > 0 ? " · " + capsList.join(", ") : "");
    const symsHtml = f.s.length > 0
      ? '<div class="sec">' + renderDisclosure({
          title: "Exported API",
          badge: f.s.length,
          badgeClass: "b-na",
          open: false,
          bodyHtml: f.s.map((sym) => {
            const gh = githubUrl(f.p, sym[2]);
            const loc = gh ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">:' + sym[2] + " ↗</a>" : '<span class="mono muted">:' + sym[2] + "</span>";
            return '<div class="api-row"><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sym[0]) + '</span><span style="display:flex;gap:5px;align-items:center;flex-shrink:0"><span class="badge b-na">' + esc(sym[1]) + "</span>" + loc + "</span></div>";
          }).join(""),
        }) + "</div>"
      : "";

    const surfaceRows = [];
    if (f.x.length > 0) {
      surfaceRows.push('<div class="row"><span class="muted">External APIs</span><span class="mono">' + esc(f.x.join(", ")) + "</span></div>");
    }
    if (f.t.length > 0) {
      surfaceRows.push('<div class="row"><span class="muted">Datastore</span><span class="mono">' + esc(f.t.join(", ")) + "</span></div>");
    }
    if (f.v.length > 0) {
      surfaceRows.push('<div class="row"><span class="muted">Env Vars</span><span class="mono">' + esc(f.v.join(", ")) + "</span></div>");
    }
    if (fileEndpoints.length > 0) {
      surfaceRows.push('<div class="row"><span class="muted">HTTP Routes</span><span class="mono">' + esc(fileEndpoints.slice(0, 6).map((ep) => ep.method + " " + ep.path).join(", ")) + "</span></div>");
    }
    const surfacesSec = surfaceRows.length > 0
      ? '<div class="sec"><div class="sec-title">Runtime Surfaces</div>' + surfaceRows.join("") + "</div>"
      : "";

    const shortRel = (fileObj) => {
      const inner = ddInnerPath(fileObj);
      return fileObj.u === f.u ? inner : fileObj.u + "/" + inner;
    };
    const callersSec = inLinks.length > 0
      ? '<div class="sec">' + renderDisclosure({
          title: "Imported By (←)",
          badge: inLinks.length,
          badgeClass: "b-pass",
          open: inLinks.length <= 4,
          bodyHtml: inLinks.slice(0, 20).map((inc) => {
            const cf = DD_FILES[inc.from];
            return '<div class="row"><span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(cf.p) + '" data-open-file="' + esc(cf.p) + '">← ' + esc(shortRel(cf)) + '</span><span class="mono muted" style="flex-shrink:0">:' + inc.line + "</span></div>";
          }).join("") + (inLinks.length > 20 ? '<div class="muted">+' + (inLinks.length - 20) + " more</div>" : ""),
        }) + "</div>"
      : "";

    const importsSec = outLinks.length > 0
      ? '<div class="sec">' + renderDisclosure({
          title: "Imports (→)",
          badge: outLinks.length,
          badgeClass: "b-info",
          open: outLinks.length <= 4,
          bodyHtml: outLinks.slice(0, 20).map((out) => {
            const tf = DD_FILES[out.to];
            return '<div class="row"><span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(tf.p) + '" data-open-file="' + esc(tf.p) + '">→ ' + esc(shortRel(tf)) + '</span><span class="mono muted" style="flex-shrink:0">:' + out.line + "</span></div>";
          }).join("") + (outLinks.length > 20 ? '<div class="muted">+' + (outLinks.length - 20) + " more</div>" : ""),
        }) + "</div>"
      : "";

    const findingsSec = fileFindings.length > 0
      ? '<div class="sec"><div class="sec-title">Active Findings (' + fileFindings.length + ")</div>" +
        fileFindings.map((inv) => renderFindingDisclosure(inv, { open: inv.status === "fail", filterEv: (ev) => ev.file === f.p })).join("") +
        "</div>"
      : "";

    const allSyms = f.m || [];
    const pubSyms = allSyms.map((s, si) => ({ s, si })).filter((x) => x.s[1] === "pub");
    const privSyms = allSyms.map((s, si) => ({ s, si })).filter((x) => x.s[1] === "priv");
    const surfacePreviewSec = allSyms.length > 0
      ? '<div class="sec"><div class="sec-title"><span>Public (' + pubSyms.length + ") & Private (" + privSyms.length + ') Surface</span><span class="muted">click for callstack + code</span></div>' +
        (pubSyms.length > 0 ? '<div class="pill-row">' + pubSyms.slice(0, 12).map((x) => '<button class="tray-chip" style="border:1px solid rgba(16,185,129,0.35);color:#6ee7b7" data-open-file-graph="' + esc(f.p) + '" data-jump-sym="' + idx + ":" + x.si + ":" + x.s[3] + '">' + esc(formatSymDisplayName(x.s)) + "</button>").join("") + "</div>" : "") +
        (privSyms.length > 0 ? '<div class="pill-row" style="margin-top:4px">' + privSyms.slice(0, 12).map((x) => '<button class="tray-chip" style="border:1px solid rgba(245,158,11,0.3);color:#fcd34d" data-open-file-graph="' + esc(f.p) + '" data-jump-sym="' + idx + ":" + x.si + ":" + x.s[3] + '">' + esc(formatSymDisplayName(x.s)) + "</button>").join("") + "</div>" : "") +
        "</div>"
      : "";

    const ghFile = githubUrl(f.p, 1);
    const fileMore =
      '<details class="more-wrap"><summary class="action-btn sec-btn" title="More actions">•••</summary><div class="more-menu">' +
      '<button class="tbtn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + "</button>" +
      '<button class="tbtn" data-toggle-blast="' + esc("file:" + f.p) + '">' + (state.blastSeedId === "file:" + f.p ? "Exit Blast Radius" : "Blast Radius") + "</button>" +
      '<button class="tbtn" data-open-e2e="' + esc(f.p + "::-1") + '">Trace E2E</button>' +
      '<button class="tbtn" data-copy-ctx="file" data-copy-ctx-id="' + esc(f.p) + '">Copy Agent Context</button>' +
      (ghFile ? '<a class="tbtn" href="' + esc(ghFile) + '" target="_blank" rel="noopener">Open in GitHub ↗</a>' : "") +
      '<button class="tbtn" data-clear-sel="1">Back to Overview</button>' +
      "</div></details>";

    const linkCount = inLinks.length + outLinks.length + fileFindings.length;
    const fileSub = state.drawerSubtab === "links" && linkCount > 0 ? "links" : "code";
    const fileTabBar = linkCount > 0 || f.s.length > 0 || surfaceRows.length > 0
      ? '<div class="drawer-tabs">' +
        '<button class="drawer-tab' + (fileSub === "code" ? " active" : "") + '" data-drawer-sub="code">Code</button>' +
        '<button class="drawer-tab' + (fileSub === "links" ? " active" : "") + '" data-drawer-sub="links">Links' + (linkCount > 0 ? " (" + linkCount + ")" : "") + "</button>" +
        "</div>"
      : "";
    const fileBody = fileSub === "links"
      ? (findingsSec + callersSec + importsSec + surfacePreviewSec + symsHtml + surfacesSec + (typeof renderFileFlowFootnote === "function" ? renderFileFlowFootnote(f.p) : ""))
      : renderCodeBlockHtml(idx, f.p, 1, f.l, 1, true, false);

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(f.p.split("/").pop()) + '</div><div class="drawer-sub">' + esc(subMeta) + "</div></div></div>" +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
      '<button class="action-btn" data-open-file-graph="' + esc(f.p) + '">Callstack (' + allSyms.length + ") →</button>" +
      fileMore + "</div>" +
      (typeof renderFileFlowLaunchPills === "function" ? renderFileFlowLaunchPills(f.p) : "") +
      fileTabBar +
      fileBody
    );
  }

  function renderFolderNodeInspector(nodeId, diag) {
    if (nodeId.startsWith("file:")) {
      return renderFileInspector(nodeId.slice(5));
    }
    const diagNode = diag?.nodes.find((n) => n.id === nodeId);
    if (nodeId.startsWith("folder:")) {
      const rest = nodeId.slice(7);
      const colon = rest.indexOf(":");
      const uSlug = rest.slice(0, colon);
      const fPath = rest.slice(colon + 1);
      const ch = diagNode?.childMeta;
      const cnt = ch ? ch.fileIdxs.length : unitHasFolderFiles(uSlug, fPath);
      const folderFiles = ch ? ch.fileIdxs.map((idx) => DD_FILES[idx]?.p).filter(Boolean) : [];
      const fileRows = (ch ? ch.fileIdxs.slice(0, 24) : []).map((idx) => {
        const f = DD_FILES[idx];
        return '<div class="row"><span class="row-link mono" data-open-file="' + esc(f.p) + '">' + esc(f.p.split("/").pop()) + '</span><span class="mono muted">' + f.l + "L · " + f.e + " exp</span></div>";
      }).join("");
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(fPath + "/") + '</div><div class="drawer-sub">' + esc(uSlug + " · " + cnt + " files") + "</div></div></div>" +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="action-btn" data-open-folder="' + esc(uSlug + "::" + fPath) + '">Drill into ' + esc(fPath.split("/").pop()) + "/ (" + cnt + ' files) →</button><button class="action-btn sec-btn" data-clear-sel="1">Back</button></div>' +
        '<div class="sec"><div class="sec-title">Files Inside</div>' + (fileRows || '<div class="muted">Click Drill to explore files.</div>') + "</div>" +
        (typeof renderLocationFlowsSection === "function" ? renderLocationFlowsSection({ files: folderFiles }) : "")
      );
    }
    if (diagNode?.ctxMeta) {
      const cm = diagNode.ctxMeta;
      const ctxFiles = Array.from(cm.files || []);
      if (ctxFiles.length === 1 && ddIdxByPath.has(ctxFiles[0])) {
        return renderFileInspector(ctxFiles[0]);
      }
      const openBtn = cm.folderPath && cm.unitSlug
        ? '<button class="action-btn" data-open-folder="' + esc(cm.unitSlug + "::" + cm.folderPath) + '">Open ' + esc(cm.label) + " →</button>"
        : "";
      const fList = ctxFiles.slice(0, 18).map((fp) =>
        '<div class="row"><span class="row-link mono" data-open-file="' + esc(fp) + '">' + esc(fp) + '</span><span class="badge b-na">Code →</span></div>'
      ).join("");
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(diagNode.label) + '</div><div class="drawer-sub">' + esc(diagNode.sublabel || "") + "</div></div></div>" +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + openBtn + '<button class="action-btn sec-btn" data-clear-sel="1">Back</button></div>' +
        (fList ? '<div class="sec"><div class="sec-title"><span>Referenced Files (' + ctxFiles.length + ')</span><span class="muted">click for code</span></div>' + fList + "</div>" : "")
      );
    }
    return null;
  }
`;
}
