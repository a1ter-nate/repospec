export function renderDrilldownClientScript(): string {
  return `
  const DD_FILES = (DATA.drilldown && DATA.drilldown.files) || [];
  const DD_EDGES = (DATA.drilldown && DATA.drilldown.edges) || [];
  const ddIdxByPath = new Map();
  const ddByUnit = new Map();
  const ddOutByIdx = new Map();
  const ddInByIdx = new Map();
  for (let i = 0; i < DD_FILES.length; i += 1) {
    const f = DD_FILES[i];
    ddIdxByPath.set(f.p, i);
    const list = ddByUnit.get(f.u) || [];
    list.push(i);
    ddByUnit.set(f.u, list);
  }
  for (const edge of DD_EDGES) {
    const a = edge[0];
    const b = edge[1];
    const ln = edge[2];
    const oList = ddOutByIdx.get(a) || [];
    oList.push({ to: b, line: ln });
    ddOutByIdx.set(a, oList);
    const iList = ddInByIdx.get(b) || [];
    iList.push({ from: a, line: ln });
    ddInByIdx.set(b, iList);
  }

  function ddInnerPath(f) {
    let rel = f.d && f.p.startsWith(f.d + "/") ? f.p.slice(f.d.length + 1) : f.p;
    rel = rel.replace(new RegExp("^(?:src|app|lib|functions)/"), "");
    return rel;
  }

  function ddUnitPeelPrefix(unitSlug) {
    const idxs = ddByUnit.get(unitSlug) || [];
    if (idxs.length < 2) return "";
    const rels = idxs.map((i) => ddInnerPath(DD_FILES[i]));
    const counts = new Map();
    let allNested = true;
    for (const r of rels) {
      const parts = r.split("/");
      if (parts.length < 2 || !parts[0]) { allNested = false; break; }
      counts.set(parts[0], (counts.get(parts[0]) || 0) + 1);
    }
    if (allNested && counts.size === 1) {
      return Array.from(counts.keys())[0] + "/";
    }
    if (allNested && counts.size >= 2 && counts.size <= 3) {
      const normU = unitSlug.toLowerCase().replace(new RegExp("[^a-z0-9]", "g"), "");
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 4 && top[1] / rels.length >= 0.6 && top[0].toLowerCase().replace(new RegExp("[^a-z0-9]", "g"), "") === normU) {
        return top[0] + "/";
      }
    }
    return "";
  }

  function ddLogicalRel(f, peelPrefix) {
    const inner = ddInnerPath(f);
    return peelPrefix && inner.startsWith(peelPrefix) ? inner.slice(peelPrefix.length) : inner;
  }

  function unitHasFolderFiles(unitSlug, folderPath) {
    const idxs = ddByUnit.get(unitSlug) || [];
    if (idxs.length === 0) return 0;
    const peel = ddUnitPeelPrefix(unitSlug);
    const pref = folderPath.replace(new RegExp("/+$"), "") + "/";
    let count = 0;
    for (const i of idxs) {
      if (ddLogicalRel(DD_FILES[i], peel).startsWith(pref)) count += 1;
    }
    return count;
  }

  function buildFolderContextDiagram(unitSlug, folderPath) {
    const idxs = ddByUnit.get(unitSlug) || [];
    if (idxs.length === 0) return null;
    const peel = ddUnitPeelPrefix(unitSlug);
    const cleanFolder = folderPath.replace(new RegExp("^/+|/+$", "g"), "");
    const prefix = cleanFolder ? cleanFolder + "/" : "";

    const insideSet = new Set();
    const childGroups = new Map();
    const fileToChildId = new Map();

    for (const idx of idxs) {
      const f = DD_FILES[idx];
      const logical = ddLogicalRel(f, peel);
      if (prefix && !logical.startsWith(prefix)) continue;
      insideSet.add(idx);
      const rest = prefix ? logical.slice(prefix.length) : logical;
      const parts = rest.split("/");
      const isDir = parts.length >= 2 && Boolean(parts[0]);
      const name = isDir ? parts[0] : rest;
      const childId = isDir ? "folder:" + unitSlug + ":" + (cleanFolder ? cleanFolder + "/" + name : name) : "file:" + f.p;
      fileToChildId.set(idx, childId);
      const cur = childGroups.get(childId);
      if (cur) {
        cur.fileIdxs.push(idx);
        cur.lines += f.l;
        cur.exports += f.e;
        for (const c of f.c) if (c !== "PURE") cur.caps.add(c);
      } else {
        const caps = new Set();
        for (const c of f.c) if (c !== "PURE") caps.add(c);
        childGroups.set(childId, {
          id: childId,
          label: isDir ? name + "/" : name.replace(new RegExp("\\\\.(?:tsx?|mts|cts|jsx?|mjs|cjs|rs|py|cs)$"), ""),
          fullName: name,
          isDir,
          folderPath: isDir ? (cleanFolder ? cleanFolder + "/" + name : name) : null,
          fileIdx: isDir ? -1 : idx,
          fileIdxs: [idx],
          lines: f.l,
          exports: f.e,
          caps,
          provenanceFile: f.p,
        });
      }
    }

    if (childGroups.size === 0) return null;

    const callerGroups = new Map();
    const depGroups = new Map();
    const edgePairs = new Map();

    const addEdgePair = (fromId, toId, ev, kind) => {
      if (fromId === toId) return;
      const k = fromId + ">" + toId;
      const cur = edgePairs.get(k);
      if (cur) {
        cur.weight += 1;
        if (cur.evidence.length < 10) cur.evidence.push(ev);
      } else {
        edgePairs.set(k, { from: fromId, to: toId, kind, weight: 1, evidence: [ev] });
      }
    };

    const outsideBucketOf = (idx) => {
      const f = DD_FILES[idx];
      const logical = ddLogicalRel(f, peel);
      const parts = logical.split("/");
      const top = parts.length >= 2 ? parts[0] : logical.replace(new RegExp("\\\\.(?:tsx?|mts|cts|jsx?|mjs|cjs|rs|py|cs)$"), "");
      const sub = parts.length >= 3 ? parts[0] + "/" + parts[1] : top;
      const isDir = parts.length >= 2;
      return {
        key: f.u === unitSlug ? sub : f.u + "/" + top,
        label: f.u === unitSlug ? (isDir ? sub + "/" : top) : f.u + " · " + top,
        unitSlug: f.u,
        folderPath: isDir ? (parts.length >= 3 ? parts[0] + "/" + parts[1] : parts[0]) : null,
        filePath: f.p,
      };
    };

    const sortedChildren = Array.from(childGroups.values())
      .sort((a, b) => b.fileIdxs.length - a.fileIdxs.length || b.lines - a.lines || a.label.localeCompare(b.label));
    const keptChildren = sortedChildren.slice(0, 36);
    const foldedCount = Math.max(0, sortedChildren.length - keptChildren.length);
    const keptChildIds = new Set(keptChildren.map((c) => c.id));

    for (const child of keptChildren) {
      for (const idx of child.fileIdxs) {
        const f = DD_FILES[idx];
        for (const inc of ddInByIdx.get(idx) || []) {
          if (insideSet.has(inc.from)) {
            const fromChild = fileToChildId.get(inc.from);
            if (fromChild && keptChildIds.has(fromChild) && fromChild !== child.id) {
              addEdgePair(fromChild, child.id, { file: DD_FILES[inc.from].p, line: inc.line, detail: "imports " + f.p.split("/").pop() }, "imports_layer");
            }
          } else {
            const b = outsideBucketOf(inc.from);
            const cid = "ctx_in:" + b.key;
            const cur = callerGroups.get(cid);
            if (cur) { cur.count += 1; cur.files.add(DD_FILES[inc.from].p); }
            else callerGroups.set(cid, { id: cid, label: b.label, unitSlug: b.unitSlug, folderPath: b.folderPath, filePath: b.filePath, count: 1, files: new Set([DD_FILES[inc.from].p]) });
            addEdgePair(cid, child.id, { file: DD_FILES[inc.from].p, line: inc.line, detail: "calls " + child.label }, "imports_layer");
          }
        }
        for (const out of ddOutByIdx.get(idx) || []) {
          if (insideSet.has(out.to)) continue;
          const b = outsideBucketOf(out.to);
          const did = "ctx_out:" + b.key;
          const cur = depGroups.get(did);
          if (cur) { cur.count += 1; cur.files.add(DD_FILES[out.to].p); }
          else depGroups.set(did, { id: did, label: b.label, unitSlug: b.unitSlug, folderPath: b.folderPath, filePath: b.filePath, count: 1, files: new Set([DD_FILES[out.to].p]), shape: "box", kind: "folder_ref" });
          addEdgePair(child.id, did, { file: f.p, line: out.line, detail: "imports " + DD_FILES[out.to].p.split("/").pop() }, "imports_layer");
        }
        for (const ext of f.x) {
          const eid = "ctx_ext:" + ext;
          const cur = depGroups.get(eid);
          if (cur) cur.count += 1;
          else depGroups.set(eid, { id: eid, label: ext, unitSlug: null, folderPath: null, filePath: f.p, count: 1, files: new Set([f.p]), shape: "pill", kind: "external_service" });
          addEdgePair(child.id, eid, { file: f.p, detail: "calls external " + ext }, "calls_external");
        }
        for (const ent of f.t.slice(0, 3)) {
          const ds = ent.split(":")[0] || "store";
          const did = "ctx_db:" + ds;
          const cur = depGroups.get(did);
          if (cur) cur.count += 1;
          else depGroups.set(did, { id: did, label: ds.charAt(0).toUpperCase() + ds.slice(1), unitSlug: null, folderPath: null, filePath: f.p, count: 1, files: new Set([f.p]), shape: "db", kind: "datastore" });
          addEdgePair(child.id, did, { file: f.p, detail: "accesses " + ent }, "reads_writes");
        }
      }
    }

    const keptCallers = Array.from(callerGroups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 12);
    const keptDeps = Array.from(depGroups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 14);
    const keptCallerIds = new Set(keptCallers.map((c) => c.id));
    const keptDepIds = new Set(keptDeps.map((d) => d.id));

    const splitCenter = keptChildren.length > 10;
    const midSplit = Math.ceil(keptChildren.length / 2);
    const centerCols = splitCenter ? [keptChildren.slice(0, midSplit), keptChildren.slice(midSplit)] : [keptChildren];

    const cols = [];
    if (keptCallers.length > 0) cols.push({ id: "callers", label: "← Callers (" + keptCallers.length + ")", items: keptCallers.map((c) => ({ id: c.id, label: c.label, sublabel: c.files.size + " file" + (c.files.size === 1 ? "" : "s") + " · " + c.count + " refs", shape: "pill", kind: "caller_ctx", expandable: Boolean(c.folderPath), provenance: { file: c.filePath }, ctxMeta: c })) });
    centerCols.forEach((arr, ci) => {
      cols.push({
        id: "inside_" + ci,
        label: (ci === 0 ? "Inside " + cleanFolder + "/ (" + keptChildren.length + (foldedCount ? "+" + foldedCount : "") + ")" : cleanFolder + "/ (cont.)"),
        items: arr.map((ch) => {
          const caps = Array.from(ch.caps).slice(0, 2);
          const sub = (ch.isDir ? ch.fileIdxs.length + " files · " : "") + ch.lines + "L · " + (caps.length > 0 ? caps.join("+") : "PURE") + (ch.isDir ? " · ⊞" : "");
          return { id: ch.id, label: ch.label, sublabel: sub, shape: ch.isDir ? "box" : "box", kind: ch.isDir ? "folder" : "file", expandable: ch.isDir, provenance: { file: ch.provenanceFile }, childMeta: ch };
        }),
      });
    });
    if (keptDeps.length > 0) cols.push({ id: "deps", label: "→ Deps & External (" + keptDeps.length + ")", items: keptDeps.map((d) => ({ id: d.id, label: d.label, sublabel: d.kind === "external_service" ? "external · " + d.count + " refs" : d.kind === "datastore" ? "datastore · " + d.count + " refs" : d.files.size + " files · " + d.count + " refs", shape: d.shape, kind: d.kind, expandable: Boolean(d.folderPath), provenance: { file: d.filePath }, ctxMeta: d })) });

    const marginX = 28;
    const topY = 48;
    const laneGap = 76;
    const nodeGapY = 18;
    const padX = 16;
    const padTop = 34;
    const padBottom = 18;
    let curX = marginX;
    let maxBottom = topY + 180;
    const layoutNodes = [];
    const posById = new Map();
    const lanes = [];
    const laneIdxById = new Map();

    cols.forEach((col, ci) => {
      laneIdxById.set(col.id, ci);
      const widths = col.items.map((it) => Math.max(152, Math.min(256, Math.max(it.label.length, (it.sublabel || "").length * 0.85) * 7.4 + 34)));
      const colW = Math.round(Math.max(164, ...widths));
      const laneW = colW + padX * 2;
      let curY = topY + padTop;
      for (const it of col.items) {
        const h = 50;
        const ln = {
          id: it.id,
          label: it.label,
          sublabel: it.sublabel,
          lane: col.id,
          layerRank: ci,
          kind: it.kind,
          role: "module",
          domain: "arch",
          shape: it.shape,
          expandable: it.expandable,
          x: Math.round((curX + padX + colW / 2) * 10) / 10,
          y: Math.round((curY + h / 2) * 10) / 10,
          w: colW,
          h,
          provenance: it.provenance,
          ctxMeta: it.ctxMeta,
          childMeta: it.childMeta,
        };
        layoutNodes.push(ln);
        posById.set(ln.id, ln);
        curY += h + nodeGapY;
      }
      const laneH = Math.max(120, curY - nodeGapY + padBottom - topY);
      lanes.push({ id: col.id, label: col.label, x: curX, y: topY, w: laneW, h: laneH });
      if (topY + laneH > maxBottom) maxBottom = topY + laneH;
      curX += laneW + laneGap;
    });
    for (const l of lanes) l.h = maxBottom - topY;

    const validIds = new Set(layoutNodes.map((n) => n.id));
    const layoutEdges = [];
    let eSeq = 0;
    const sortedEdgeEntries = Array.from(edgePairs.values()).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    const isDense = sortedEdgeEntries.length > 26;
    for (const ep of sortedEdgeEntries) {
      if (!validIds.has(ep.from) || !validIds.has(ep.to)) continue;
      if (ep.from.startsWith("ctx_in:") && !keptCallerIds.has(ep.from)) continue;
      if ((ep.to.startsWith("ctx_out:") || ep.to.startsWith("ctx_ext:") || ep.to.startsWith("ctx_db:")) && !keptDepIds.has(ep.to)) continue;
      const a = posById.get(ep.from);
      const b = posById.get(ep.to);
      if (!a || !b) continue;
      const la = laneIdxById.get(a.lane) ?? 0;
      const lb = laneIdxById.get(b.lane) ?? 0;
      const pts = [];
      if (lb > la) {
        const sx = a.x + a.w / 2;
        const tx = b.x - b.w / 2;
        const dx = Math.max(24, (tx - sx) * 0.45);
        pts.push({ x: sx, y: a.y }, { x: sx + dx, y: a.y }, { x: tx - dx, y: b.y }, { x: tx, y: b.y });
      } else if (lb < la) {
        const sx = a.x - a.w / 2;
        const tx = b.x + b.w / 2;
        const arcY = maxBottom + 18 + (eSeq % 4) * 7;
        pts.push({ x: sx, y: a.y }, { x: sx - 16, y: a.y }, { x: sx - 16, y: arcY }, { x: tx + 16, y: arcY }, { x: tx + 16, y: b.y }, { x: tx, y: b.y });
      } else {
        const rx = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 18 + (eSeq % 3) * 7;
        pts.push({ x: a.x + a.w / 2, y: a.y }, { x: rx, y: a.y }, { x: rx, y: b.y }, { x: b.x + b.w / 2, y: b.y });
      }
      const isInternal = !ep.from.startsWith("ctx_") && !ep.to.startsWith("ctx_");
      const tier = !isDense || isInternal || ep.weight >= 2 || ep.kind === "calls_external" || ep.kind === "reads_writes" ? "spine" : "detail";
      layoutEdges.push({
        id: "fld:" + eSeq,
        from: ep.from,
        to: ep.to,
        kind: ep.kind,
        tier,
        label: ep.weight > 1 ? String(ep.weight) : undefined,
        weight: ep.weight,
        confidence: "observed",
        evidence: ep.evidence,
        points: pts,
      });
      eSeq += 1;
    }

    return {
      id: "folder:" + unitSlug + ":" + cleanFolder,
      title: unitSlug + " › " + cleanFolder + "/ — Files & Context",
      subtitle: insideSet.size + " files · " + keptCallers.length + " caller groups · " + keptDeps.length + " deps & external APIs. Click any file for exports & lines; double-click subfolders to go deeper.",
      category: "subsystem",
      unitSlug,
      folderPath: cleanFolder,
      rankdir: "LR",
      width: Math.max(520, curX - laneGap + marginX),
      height: Math.max(260, maxBottom + 44),
      lanes,
      foldedCount,
      nodes: layoutNodes,
      edges: layoutEdges,
    };
  }

  function renderFileInspector(filePath) {
    const idx = ddIdxByPath.get(filePath);
    if (idx === undefined) return renderBriefingDrawer();
    const f = DD_FILES[idx];
    const inLinks = ddInByIdx.get(idx) || [];
    const outLinks = ddOutByIdx.get(idx) || [];
    const fileEndpoints = DATA.surfaces.endpoints.filter((ep) => ep.file === f.p);
    const fileFindings = DATA.invariants.filter((inv) => (inv.status === "fail" || inv.status === "warn") && inv.evidence.some((ev) => ev.file === f.p));

    const pills =
      '<div class="pill-row">' +
      '<span class="badge b-info">' + f.l + " lines</span>" +
      '<span class="badge b-na">' + f.e + " exports</span>" +
      f.c.map((c) => '<span class="badge ' + capBadgeClass(c) + '">' + esc(c) + "</span>").join("") +
      "</div>";

    const symsHtml =
      '<div class="sec"><div class="sec-title"><span>Exported API (' + f.s.length + ")</span></div>" +
      (f.s.length === 0
        ? '<div class="muted" style="font-size:11px">No named top-level exports indexed.</div>'
        : f.s.map((sym) => {
            const gh = githubUrl(f.p, sym[2]);
            const loc = gh ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">:' + sym[2] + " ↗</a>" : '<span class="mono muted">:' + sym[2] + "</span>";
            return '<div class="api-row"><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sym[0]) + '</span><span style="display:flex;gap:5px;align-items:center;flex-shrink:0"><span class="badge b-na">' + esc(sym[1]) + "</span>" + loc + "</span></div>";
          }).join("")) +
      "</div>";

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

    const callersSec =
      '<div class="sec"><div class="sec-title"><span>Imported By (' + inLinks.length + ')</span><span class="muted">click to jump</span></div>' +
      (inLinks.length === 0
        ? '<div class="muted" style="font-size:11px">No direct production callers indexed (entry point or dynamic).</div>'
        : inLinks.slice(0, 20).map((inc) => {
            const cf = DD_FILES[inc.from];
            return '<div class="row"><span class="row-link mono" data-open-file="' + esc(cf.p) + '">← ' + esc(cf.p) + '</span><span class="mono muted">:' + inc.line + "</span></div>";
          }).join("") + (inLinks.length > 20 ? '<div class="muted">+' + (inLinks.length - 20) + " more</div>" : "")) +
      "</div>";

    const importsSec =
      '<div class="sec"><div class="sec-title"><span>Imports (' + outLinks.length + ')</span><span class="muted">click to jump</span></div>' +
      (outLinks.length === 0
        ? '<div class="muted" style="font-size:11px">Leaf file (0 internal file imports).</div>'
        : outLinks.slice(0, 20).map((out) => {
            const tf = DD_FILES[out.to];
            return '<div class="row"><span class="row-link mono" data-open-file="' + esc(tf.p) + '">→ ' + esc(tf.p) + '</span><span class="mono muted">:' + out.line + "</span></div>";
          }).join("") + (outLinks.length > 20 ? '<div class="muted">+' + (outLinks.length - 20) + " more</div>" : "")) +
      "</div>";

    const findingsSec = fileFindings.length > 0
      ? '<div class="sec"><div class="sec-title">Active Findings (' + fileFindings.length + ")</div>" +
        fileFindings.map((inv) => renderFindingDisclosure(inv, { open: inv.status === "fail", filterEv: (ev) => ev.file === f.p })).join("") +
        "</div>"
      : "";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(f.p.split("/").pop()) + '</div><div class="drawer-sub">' + esc(f.u + " · " + f.p) + "</div></div></div>" +
      provenanceLinksHtml(f.p, 1) +
      pills +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + '</button><button class="action-btn sec-btn" data-clear-sel="1">Folder Briefing</button></div>' +
      findingsSec +
      symsHtml +
      surfacesSec +
      callersSec +
      importsSec
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
      const fileRows = (ch ? ch.fileIdxs.slice(0, 24) : []).map((idx) => {
        const f = DD_FILES[idx];
        return '<div class="row"><span class="row-link mono" data-open-file="' + esc(f.p) + '">' + esc(f.p.split("/").pop()) + '</span><span class="mono muted">' + f.l + "L · " + f.e + " exp</span></div>";
      }).join("");
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(fPath + "/") + '</div><div class="drawer-sub">' + esc(uSlug + " · " + cnt + " files") + "</div></div></div>" +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="action-btn" data-open-folder="' + esc(uSlug + "::" + fPath) + '">Drill into ' + esc(fPath.split("/").pop()) + "/ (" + cnt + ' files) →</button><button class="action-btn sec-btn" data-clear-sel="1">Back</button></div>' +
        '<div class="sec"><div class="sec-title">Files Inside</div>' + (fileRows || '<div class="muted">Click Drill to explore files.</div>') + "</div>"
      );
    }
    if (diagNode?.ctxMeta) {
      const cm = diagNode.ctxMeta;
      const openBtn = cm.folderPath && cm.unitSlug
        ? '<button class="action-btn" data-open-folder="' + esc(cm.unitSlug + "::" + cm.folderPath) + '">Open ' + esc(cm.label) + " →</button>"
        : "";
      const fList = Array.from(cm.files || []).slice(0, 18).map((fp) =>
        '<div class="row"><span class="row-link mono" data-open-file="' + esc(fp) + '">' + esc(fp) + "</span></div>"
      ).join("");
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(diagNode.label) + '</div><div class="drawer-sub">' + esc(diagNode.sublabel || "") + "</div></div></div>" +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + openBtn + '<button class="action-btn sec-btn" data-clear-sel="1">Back</button></div>' +
        (fList ? '<div class="sec"><div class="sec-title">Referenced Files</div>' + fList + "</div>" : "")
      );
    }
    return null;
  }
`;
}
