export function renderEntityJourneyClientScript(): string {
  return `
  let ENTITY_JOURNEYS_CACHE = null;

  function jrnNormEntity(raw) {
    let s = String(raw || "").trim().toLowerCase().replace(/^[^:]+:/, "").replace(/[^a-z0-9]/g, "");
    if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
    else if (s.endsWith("ses") && s.length > 4) s = s.slice(0, -2);
    else if (s.endsWith("s") && s.length > 3 && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is")) s = s.slice(0, -1);
    return s;
  }

  function jrnLayerOf(fp) {
    const p = "/" + String(fp || "").toLowerCase();
    if (/\\/(?:routes?|routers?|endpoints?)\\//.test(p)) return "route";
    if (/\\/(?:controllers?|handlers?|resolvers?)\\//.test(p)) return "controller";
    if (/\\/(?:services?|usecases?|domain|application|managers?)\\//.test(p)) return "service";
    if (/\\/(?:daos?|repositor(?:y|ies)|persistence|stores?|db)\\//.test(p)) return "dao";
    return "other";
  }

  function jrnGroupKey(fp, layer) {
    const clean = String(fp || "").replace(/^(?:apps|packages|services)\\/[^/]+\\//, "").replace(/^(?:functions|src|lib)\\//, "");
    const parts = clean.split("/").filter(Boolean);
    const lIdx = parts.findIndex((s) => s.toLowerCase().startsWith(layer));
    if (lIdx >= 0 && parts.length > lIdx + 2) return parts[lIdx + 1];
    if (lIdx >= 0 && parts.length === lIdx + 2) return parts[lIdx + 1].replace(/\\.[^.]+$/, "");
    return parts.length > 1 ? parts[parts.length - 2] : (parts[0] || layer).replace(/\\.[^.]+$/, "");
  }

  function jrnIsOwnerService(group, stem) {
    const ng = jrnNormEntity(group);
    if (!stem || stem.length < 3 || !ng || ng.length < 3) return false;
    if (ng === stem) return true;
    if (ng.startsWith(stem) && stem.length >= 4) return true;
    if (stem.startsWith(ng) && ng.length >= 5) return true;
    return false;
  }

  function jrnLooksReadFile(fp) {
    return /(?:read|get|list|query|search|projection|assembly|metrics|view|lookup|fetch|summary|report)/.test(String(fp || "").toLowerCase());
  }

  function jrnLooksWriteFile(fp) {
    return /(?:write|create|update|delete|purge|save|set|patch|mutate|sync|install|replace|assign|provision|bulk|migration|crud|management|status|firmware|cartridge)/.test(String(fp || "").toLowerCase());
  }

  function buildEntityJourneys() {
    if (ENTITY_JOURNEYS_CACHE) return ENTITY_JOURNEYS_CACHE;
    const hubs = DATA.flows?.dataHubs || [];
    const sms = DATA.flows?.stateMachines || [];
    const eps = DATA.surfacesModel?.endpoints || [];
    const ents = DATA.surfacesModel?.entities || [];

    const byKey = new Map();
    const ensureEnt = (rawName, ds) => {
      const k = jrnNormEntity(rawName);
      if (!k || k.length < 3) return null;
      let rec = byKey.get(k);
      if (!rec) {
        rec = { key: k, label: rawName, datastore: ds || "datastore", daoIdxs: new Set(), hub: null, sm: null, totalRefs: 0 };
        byKey.set(k, rec);
      }
      if (ds && rec.datastore === "datastore") rec.datastore = ds;
      return rec;
    };

    for (const e of ents) {
      const r = ensureEnt(e.entity, e.datastore);
      if (r) r.totalRefs = Math.max(r.totalRefs, e.totalRefs || 0);
    }
    for (const h of hubs) {
      const r = ensureEnt(h.entity, "datastore");
      if (r) { r.hub = h; if (h.entity.length > r.label.length) r.label = h.entity; }
    }
    DD_FILES.forEach((f, idx) => {
      for (const tag of f.t || []) {
        const parts = String(tag).split(":");
        const ds = parts.length > 1 ? parts[0] : "datastore";
        const name = parts.length > 1 ? parts.slice(1).join(":") : parts[0];
        const r = ensureEnt(name, ds);
        if (r) r.daoIdxs.add(idx);
      }
    });
    for (const sm of sms) {
      const low = (sm.name + " " + sm.file).toLowerCase();
      for (const r of byKey.values()) {
        if (!r.sm && low.includes(r.key)) r.sm = sm;
      }
    }

    const epByFileIdx = new Map();
    for (const ep of eps) {
      if (!ep.file || /(?:^|\\/)app\\.[tj]sx?$/i.test(ep.file)) continue;
      const idx = ddIdxByPath.get(ep.file);
      if (idx === undefined) continue;
      const arr = epByFileIdx.get(idx) || [];
      arr.push(ep);
      epByFileIdx.set(idx, arr);
    }

    const journeys = [];
    for (const rec of byKey.values()) {
      const hubWriters = new Set();
      const hubReaders = new Set();
      if (rec.hub) {
        for (const fld of rec.hub.fields || []) {
          for (const w of fld.writers || []) hubWriters.add(w.file);
          for (const r of fld.readers || []) hubReaders.add(r.file);
        }
      }
      const daoFiles = Array.from(rec.daoIdxs).map((i) => DD_FILES[i]).filter(Boolean);
      if (daoFiles.length === 0 && hubWriters.size === 0) continue;

      const svcNodes = new Map();
      const ctrlNodes = new Map();
      const layerSkips = [];
      const svcToCtrlEdges = new Map();

      const addSvc = (idx) => {
        const f = DD_FILES[idx];
        if (!f) return null;
        const g = jrnGroupKey(f.p, "service");
        const isOwn = jrnIsOwnerService(g, rec.key);
        const key = (isOwn ? "own:" : "ext:") + g;
        let bucket = svcNodes.get(key);
        if (!bucket) bucket = { id: "svc:" + key, label: g, isOwn, files: [], fileIdxs: new Set(), isWrite: false, isRead: false, bypass: !isOwn };
        if (!bucket.fileIdxs.has(idx)) {
          bucket.fileIdxs.add(idx);
          bucket.files.push({ file: f.p, line: 1, isWriter: hubWriters.has(f.p), isReader: hubReaders.has(f.p) });
        }
        if (hubWriters.has(f.p) || jrnLooksWriteFile(f.p)) bucket.isWrite = true;
        if (hubReaders.has(f.p) || jrnLooksReadFile(f.p)) bucket.isRead = true;
        svcNodes.set(key, bucket);
        return bucket;
      };

      const addCtrl = (idx, directSkip) => {
        const f = DD_FILES[idx];
        if (!f) return null;
        const g = jrnGroupKey(f.p, "controller");
        const key = "ctrl:" + g;
        let bucket = ctrlNodes.get(key);
        if (!bucket) bucket = { id: key, label: g, files: [], fileIdxs: new Set(), isWrite: false, isRead: false, directSkip: false };
        if (!bucket.fileIdxs.has(idx)) {
          bucket.fileIdxs.add(idx);
          bucket.files.push({ file: f.p, line: 1, directSkip: Boolean(directSkip) });
        }
        if (directSkip) bucket.directSkip = true;
        if (hubWriters.has(f.p) || jrnLooksWriteFile(f.p)) bucket.isWrite = true;
        if (hubReaders.has(f.p) || jrnLooksReadFile(f.p)) bucket.isRead = true;
        ctrlNodes.set(key, bucket);
        return bucket;
      };

      for (const daoIdx of rec.daoIdxs) {
        const daoFile = DD_FILES[daoIdx];
        for (const inc of ddInByIdx.get(daoIdx) || []) {
          const caller = DD_FILES[inc.from];
          if (!caller) continue;
          const layer = jrnLayerOf(caller.p);
          if (layer === "service") {
            const svc = addSvc(inc.from);
            if (svc) {
              for (const inc2 of ddInByIdx.get(inc.from) || []) {
                const c2 = DD_FILES[inc2.from];
                if (!c2) continue;
                const l2 = jrnLayerOf(c2.p);
                if (l2 === "controller" || l2 === "route") {
                  const cb = addCtrl(inc2.from, false);
                  if (cb) svcToCtrlEdges.set(cb.id + "->" + svc.id, { ctrlId: cb.id, svcId: svc.id });
                }
              }
            }
          } else if (layer === "controller" || layer === "route") {
            const cb = addCtrl(inc.from, true);
            if (cb) layerSkips.push({ ctrlId: cb.id, from: caller.p, to: daoFile.p, line: inc.line || 1 });
          }
        }
      }

      for (const wfPath of hubWriters) {
        const idx = ddIdxByPath.get(wfPath);
        if (idx === undefined) continue;
        const l = jrnLayerOf(wfPath);
        if (l === "service") { const s = addSvc(idx); if (s) s.isWrite = true; }
        else if (l === "controller") { const c = addCtrl(idx, false); if (c) c.isWrite = true; }
      }

      const routeGroupsW = new Map();
      const routeGroupsR = new Map();
      const routeToCtrlW = new Map();
      const routeToCtrlR = new Map();

      const addRouteEp = (ep, ctrlId) => {
        const map = ep.isWrite ? routeGroupsW : routeGroupsR;
        const edgeMap = ep.isWrite ? routeToCtrlW : routeToCtrlR;
        const gKey = ep.prefix || "root";
        const id = (ep.isWrite ? "rw:" : "rr:") + gKey;
        let rg = map.get(id);
        if (!rg) rg = { id, label: gKey === "root" ? "/" : "/" + gKey, isWrite: ep.isWrite, endpoints: [], methods: new Set() };
        if (!rg.endpoints.some((x) => x.id === ep.id)) {
          rg.endpoints.push(ep);
          rg.methods.add(ep.method);
        }
        map.set(id, rg);
        if (ctrlId) edgeMap.set(id + "->" + ctrlId, { routeId: id, ctrlId });
      };

      for (const cb of ctrlNodes.values()) {
        for (const cIdx of cb.fileIdxs) {
          for (const ep of epByFileIdx.get(cIdx) || []) {
            if (ep.isWrite) cb.isWrite = true; else cb.isRead = true;
            addRouteEp(ep, cb.id);
          }
          for (const inc of ddInByIdx.get(cIdx) || []) {
            for (const ep of epByFileIdx.get(inc.from) || []) {
              if (ep.isWrite) cb.isWrite = true; else cb.isRead = true;
              addRouteEp(ep, cb.id);
            }
          }
        }
      }

      const stemRe = new RegExp("/" + rec.key + "s?(?:/|$)", "i");
      for (const ep of eps) {
        if (!stemRe.test(ep.path)) continue;
        const already = ep.isWrite ? routeGroupsW : routeGroupsR;
        let found = false;
        for (const rg of already.values()) if (rg.endpoints.some((x) => x.id === ep.id)) found = true;
        if (!found) {
          const matchCtrl = Array.from(ctrlNodes.values()).find((c) => c.label.toLowerCase().includes(rec.key));
          addRouteEp(ep, matchCtrl ? matchCtrl.id : null);
        }
      }

      for (const s of svcNodes.values()) if (!s.isWrite && !s.isRead) { s.isWrite = true; s.isRead = true; }
      for (const c of ctrlNodes.values()) if (!c.isWrite && !c.isRead) { c.isWrite = true; c.isRead = true; }

      const allSvcs = Array.from(svcNodes.values()).sort((a, b) => (b.isOwn ? 1 : 0) - (a.isOwn ? 1 : 0) || b.files.length - a.files.length);
      const writeSvcs = allSvcs.filter((s) => s.isWrite).slice(0, 8);
      const readSvcs = allSvcs.filter((s) => s.isRead).slice(0, 8);
      const allCtrls = Array.from(ctrlNodes.values()).sort((a, b) => (b.directSkip ? 1 : 0) - (a.directSkip ? 1 : 0) || b.files.length - a.files.length);
      const writeCtrls = allCtrls.filter((c) => c.isWrite).slice(0, 8);
      const readCtrls = allCtrls.filter((c) => c.isRead).slice(0, 8);
      const writeRoutes = Array.from(routeGroupsW.values()).sort((a, b) => b.endpoints.length - a.endpoints.length).slice(0, 7);
      const readRoutes = Array.from(routeGroupsR.values()).sort((a, b) => b.endpoints.length - a.endpoints.length).slice(0, 7);

      const bypassSvcCount = allSvcs.filter((s) => !s.isOwn).length;
      const ownSvcCount = allSvcs.filter((s) => s.isOwn).length;
      const totalWriteEps = writeRoutes.reduce((s, r) => s + r.endpoints.length, 0);
      const totalReadEps = readRoutes.reduce((s, r) => s + r.endpoints.length, 0);
      const score = daoFiles.length + allSvcs.length * 3 + totalWriteEps + totalReadEps + (rec.hub ? rec.hub.fieldCount * 2 : 0);
      if (allSvcs.length === 0 && layerSkips.length === 0 && totalWriteEps + totalReadEps === 0) continue;

      journeys.push({
        key: rec.key, label: rec.label, datastore: rec.datastore,
        daoFiles: daoFiles.map((f) => ({ file: f.p, line: 1 })),
        hub: rec.hub, sm: rec.sm,
        writeRoutes, readRoutes, writeCtrls, readCtrls, writeSvcs, readSvcs, allSvcs, allCtrls,
        svcToCtrlEdges: Array.from(svcToCtrlEdges.values()),
        routeToCtrlW: Array.from(routeToCtrlW.values()),
        routeToCtrlR: Array.from(routeToCtrlR.values()),
        layerSkips, bypassSvcCount, ownSvcCount, totalWriteEps, totalReadEps, score,
      });
    }

    journeys.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    ENTITY_JOURNEYS_CACHE = journeys.slice(0, 28);
    return ENTITY_JOURNEYS_CACHE;
  }

  function renderJourneyRailListHtml() {
    const q = String(state.flowSearch || "").trim().toLowerCase();
    const chip = state.flowFilterChip || "all";
    const all = buildEntityJourneys().filter((j) => {
      if (chip === "bypass" && j.bypassSvcCount === 0 && j.layerSkips.length === 0) return false;
      if (q && !(j.label + " " + j.key + " " + j.datastore).toLowerCase().includes(q)) return false;
      return true;
    });
    if (all.length === 0) return '<div class="fx-empty">No domain entity journeys match.</div>';
    const activeKey = state.activeJourneyKey || all[0].key;
    return all.map((j) => {
      const hasBp = j.bypassSvcCount > 0 || j.layerSkips.length > 0;
      const gCls = j.layerSkips.length > 0 ? "g-err" : hasBp ? "g-warn" : "g-http";
      const badge = hasBp
        ? '<span class="fr-hz' + (j.layerSkips.length > 0 ? " is-err" : "") + '" title="Outside-domain services or layer skips">' + (j.bypassSvcCount + j.layerSkips.length) + "</span>"
        : '<span class="fr-deliv" style="color:var(--ok)">clean</span>';
      return (
        '<button class="fr-item" data-select-journey="' + esc(j.key) + '" aria-selected="' + (j.key === activeKey ? "true" : "false") + '">' +
        '<span class="fr-glyph ' + gCls + '">' + flowGlyphSvg("journey") + "</span>" +
        '<span class="fr-main"><span class="fr-title mono">' + esc(j.label) + '</span><span class="fr-sub">' + j.totalWriteEps + "W · " + j.totalReadEps + "R · " + j.allSvcs.length + " svcs</span></span>" +
        '<span class="fr-meta">' + badge + "</span></button>"
      );
    }).join("");
  }

  function applyJourneyHoverSpotlight(nodeEl) {
    const svg = nodeEl?.closest(".rs-jrn-svg");
    if (!svg) return;
    svg.querySelectorAll(".is-hi").forEach((el) => el.classList.remove("is-hi"));
    svg.classList.add("jrn-hover");
    const k = nodeEl.getAttribute("data-jrn-key");
    if (!k) return;
    const hitNodes = new Set([k]);
    svg.querySelectorAll(".rs-jrn-edge").forEach((e) => {
      const a = e.getAttribute("data-ja"), b = e.getAttribute("data-jb");
      if (a === k || b === k) {
        e.classList.add("is-hi");
        if (a) hitNodes.add(a);
        if (b) hitNodes.add(b);
      }
    });
    for (const nk of hitNodes) svg.querySelector('[data-jrn-key="' + nk + '"]')?.classList.add("is-hi");
  }

  function clearJourneyHoverSpotlight() {
    document.querySelectorAll(".rs-jrn-svg.jrn-hover").forEach((svg) => {
      svg.classList.remove("jrn-hover");
      svg.querySelectorAll(".is-hi").forEach((el) => el.classList.remove("is-hi"));
    });
  }

  function handleJourneyClick(target) {
    const sel = target.closest("[data-select-journey]");
    if (sel) {
      state.activeJourneyKey = sel.getAttribute("data-select-journey");
      state.jrnSelNode = "MODEL";
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const pick = target.closest("[data-jrn-pick]");
    if (pick) {
      state.jrnSelNode = pick.getAttribute("data-jrn-pick") || "MODEL";
      state.flowCodeFile = null;
      ensureFileSourcesLoaded();
      render();
      return true;
    }
    const bp = target.closest("[data-jrn-bypass]");
    if (bp) {
      state.jrnBypassOnly = bp.getAttribute("data-jrn-bypass") === "1";
      render();
      return true;
    }
    const cp = target.closest("[data-copy-journey-ctx]");
    if (cp) {
      const k = cp.getAttribute("data-copy-journey-ctx");
      const j = buildEntityJourneys().find((x) => x.key === k);
      if (j) {
        const lines = [
          "# Entity Journey: " + j.label + " (" + j.datastore + ")",
          "- Write routes: " + j.totalWriteEps + " | Read routes: " + j.totalReadEps + " | DAOs: " + j.daoFiles.length,
          "- Canonical owner service groups: " + j.ownSvcCount + " | Outside-domain bypass service groups: " + j.bypassSvcCount + " | Controller->DAO skips: " + j.layerSkips.length,
          "## Outside-Domain Services Accessing " + j.label + " DAO Directly",
          ...j.allSvcs.filter((s) => !s.isOwn).flatMap((s) => s.files.map((f) => "- " + f.file)),
          "## Write Routes",
          ...j.writeRoutes.flatMap((r) => r.endpoints.slice(0, 8).map((ep) => "- " + ep.method + " " + ep.path + " (" + (ep.file || "openapi") + ")")),
          "## Read Routes",
          ...j.readRoutes.flatMap((r) => r.endpoints.slice(0, 8).map((ep) => "- " + ep.method + " " + ep.path + " (" + (ep.file || "openapi") + ")")),
        ];
        copyTextToClipboard(lines.join("\\n"), cp, "Copy Context");
      }
      return true;
    }
    return false;
  }
`;
}
