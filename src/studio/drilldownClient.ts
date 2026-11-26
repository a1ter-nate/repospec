import { renderDrilldownInspectorScript } from "./drilldownInspector.ts";

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
        if (state.showAsyncEdges && typeof ASYNC_BY_FILE !== "undefined") {
          for (const rec of ASYNC_BY_FILE.get(f.p) || []) {
            const ah = rec.ah;
            if (rec.role === "producer") {
              const cIdx = ah.consumer?.file ? ddIdxByPath.get(ah.consumer.file) : undefined;
              const cChild = cIdx !== undefined && insideSet.has(cIdx) ? fileToChildId.get(cIdx) : null;
              if (cChild && keptChildIds.has(cChild) && cChild !== child.id) {
                addEdgePair(child.id, cChild, { file: f.p, line: ah.producer.line, detail: "⚡ " + ah.channel + " (" + ah.transport + ")" }, "async_handoff");
              } else {
                const aid = "ctx_out:async:" + ah.channel;
                const peerFiles = ah.consumer?.file ? new Set([ah.consumer.file]) : new Set([f.p]);
                if (!depGroups.has(aid)) {
                  depGroups.set(aid, { id: aid, label: "⚡ " + ah.channel, unitSlug: null, folderPath: null, filePath: ah.consumer?.file || f.p, count: 10, files: peerFiles, shape: "pill", kind: "external_service" });
                }
                addEdgePair(child.id, aid, { file: f.p, line: ah.producer.line, detail: "⚡ publishes " + ah.channel + " (" + ah.delivery + ")" }, "async_handoff");
              }
            } else if (rec.role === "consumer" && ah.producer?.file) {
              const pIdx = ddIdxByPath.get(ah.producer.file);
              if (pIdx === undefined || !insideSet.has(pIdx)) {
                const aid = "ctx_in:async:" + ah.channel;
                if (!callerGroups.has(aid)) {
                  callerGroups.set(aid, { id: aid, label: "⚡ " + ah.channel, unitSlug: null, folderPath: null, filePath: ah.producer.file, count: 10, files: new Set([ah.producer.file]) });
                }
                addEdgePair(aid, child.id, { file: ah.producer.file, line: ah.producer.line, detail: "⚡ triggers " + child.label + " via " + ah.channel }, "async_handoff");
              }
            }
          }
        }
      }
    }

    const fileFindingsByPath = new Map();
    const fileViolTargetsByPath = new Map();
    for (const inv of DATA.invariants || []) {
      if (inv.status !== "fail" && inv.status !== "warn") continue;
      for (const ev of inv.evidence || []) {
        if (!ev.file) continue;
        const arr = fileFindingsByPath.get(ev.file) || [];
        arr.push({ invId: inv.id, severity: inv.status === "fail" ? "error" : "warn", detail: ev.detail, line: ev.line });
        fileFindingsByPath.set(ev.file, arr);
        const tSet = fileViolTargetsByPath.get(ev.file) || [];
        tSet.push({ invId: inv.id, detail: ev.detail, line: ev.line });
        fileViolTargetsByPath.set(ev.file, tSet);
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
    if (keptCallers.length > 0) cols.push({ id: "callers", label: "← Callers (" + keptCallers.length + ")", items: keptCallers.map((c) => ({ id: c.id, label: c.label, sublabel: c.files.size + " file" + (c.files.size === 1 ? "" : "s") + " · " + c.count + " refs", shape: "pill", kind: "caller_ctx", expandable: Boolean(c.folderPath || c.files.size === 1), provenance: { file: c.filePath }, ctxMeta: c })) });
    centerCols.forEach((arr, ci) => {
      cols.push({
        id: "inside_" + ci,
        label: (ci === 0 ? "Inside " + cleanFolder + "/ (" + keptChildren.length + (foldedCount ? "+" + foldedCount : "") + ")" : cleanFolder + "/ (cont.)"),
        items: arr.map((ch) => {
          const caps = Array.from(ch.caps).slice(0, 2);
          const sub = (ch.isDir ? ch.fileIdxs.length + " files · " : "") + ch.lines + "L · " + (caps.length > 0 ? caps.join("+") : "PURE") + (ch.isDir ? " · ⊞" : "");
          const fCounts = new Map();
          for (const fIdx of ch.fileIdxs) {
            const fp = DD_FILES[fIdx].p;
            for (const fnd of fileFindingsByPath.get(fp) || []) {
              const cur = fCounts.get(fnd.invId);
              if (cur) cur.count += 1;
              else fCounts.set(fnd.invId, { ruleId: fnd.invId, severity: fnd.severity, count: 1 });
            }
          }
          const findings = Array.from(fCounts.values());
          const hasSyms = !ch.isDir && ch.fileIdxs.length === 1 && Boolean(DD_FILES[ch.fileIdxs[0]]?.m?.length);
          return { id: ch.id, label: ch.label, sublabel: sub, shape: "box", kind: ch.isDir ? "folder" : "file", expandable: ch.isDir || hasSyms, provenance: { file: ch.provenanceFile }, findings: findings.length > 0 ? findings : undefined, childMeta: ch };
        }),
      });
    });
    if (keptDeps.length > 0) cols.push({ id: "deps", label: "→ Deps & External (" + keptDeps.length + ")", items: keptDeps.map((d) => ({ id: d.id, label: d.label, sublabel: d.kind === "external_service" ? "external · " + d.count + " refs" : d.kind === "datastore" ? "datastore · " + d.count + " refs" : d.files.size + " file" + (d.files.size === 1 ? "" : "s") + " · " + d.count + " refs", shape: d.shape, kind: d.kind, expandable: Boolean(d.folderPath || (d.kind === "folder_ref" && d.files.size === 1)), provenance: { file: d.filePath }, ctxMeta: d })) });

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
      const widths = col.items.map((it) => Math.max(194, Math.min(308, Math.max(it.label.length, (it.sublabel || "").length * 0.85) * 8.2 + 72)));
      const colW = Math.round(Math.max(196, ...widths));
      const laneW = colW + padX * 2;
      let curY = topY + padTop;
      for (const it of col.items) {
        const h = 62;
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
          findings: it.findings,
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
        const dx = Math.max(24, (sx - tx) * 0.45);
        pts.push({ x: sx, y: a.y }, { x: sx - dx, y: a.y }, { x: tx + dx, y: b.y }, { x: tx, y: b.y });
      } else {
        const rx = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 18 + (eSeq % 3) * 6;
        pts.push({ x: a.x + a.w / 2, y: a.y }, { x: rx, y: a.y }, { x: rx, y: b.y }, { x: b.x + b.w / 2, y: b.y });
      }
      const matchedRuleIds = [];
      for (const ev of ep.evidence || []) {
        const viols = fileViolTargetsByPath.get(ev.file) || [];
        for (const v of viols) {
          const targetTok = (b.label || "").replace(new RegExp("/$"), "");
          if (v.detail && targetTok && v.detail.includes(targetTok)) {
            if (!matchedRuleIds.includes(v.invId)) matchedRuleIds.push(v.invId);
          }
        }
      }
      const isViol = matchedRuleIds.length > 0;
      const isInternal = !ep.from.startsWith("ctx_") && !ep.to.startsWith("ctx_");
      const isAsync = ep.kind === "async_handoff";
      const tier = isViol || isAsync || !isDense || isInternal || ep.weight >= 2 || ep.kind === "calls_external" || ep.kind === "reads_writes" ? "spine" : "detail";
      const asyncLabel = isAsync ? (ep.evidence?.[0]?.detail?.match(new RegExp("⚡\\\\s*\\\\S+"))?.[0] || "⚡ async") : undefined;
      layoutEdges.push({
        id: "fld:" + eSeq,
        from: ep.from,
        to: ep.to,
        kind: ep.kind,
        tier: isViol ? "violation" : tier,
        label: isAsync ? asyncLabel : isViol ? "⚠ " + ep.weight : ep.weight > 1 ? String(ep.weight) : undefined,
        weight: ep.weight,
        violation: isViol,
        ruleIds: isViol ? matchedRuleIds : undefined,
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
  ${renderDrilldownInspectorScript()}
`;
}
