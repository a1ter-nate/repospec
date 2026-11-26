import { renderMapFlowOverlayClientScript } from "./mapFlowOverlayClient.ts";

export function renderMapFlowsBridgeClientScript(): string {
  return `
  const ALL_FLOWS = (DATA.flows && (DATA.flows.flowIndex?.workFlows || DATA.flows.workFlows)) || [];
  const ALL_HUBS = (DATA.flows && (DATA.flows.flowIndex?.dataHubs || DATA.flows.dataHubs)) || [];
  const ALL_SMS = (DATA.flows && (DATA.flows.flowIndex?.stateMachines || DATA.flows.stateMachines)) || [];
  const ALL_ASYNCS = (DATA.flows && (DATA.flows.flowIndex?.asyncHandoffs || DATA.flows.asyncHandoffs)) || [];

  const FLOW_BY_ID = new Map();
  const FLOWS_BY_FILE = new Map();
  for (const wf of ALL_FLOWS) {
    FLOW_BY_ID.set(wf.id, wf);
    const seenF = new Set();
    const attach = (fp) => {
      if (!fp || seenF.has(fp)) return;
      seenF.add(fp);
      const arr = FLOWS_BY_FILE.get(fp) || [];
      arr.push(wf);
      FLOWS_BY_FILE.set(fp, arr);
    };
    attach(wf.file);
    for (const s of wf.steps || []) attach(s.file);
  }

  const HUB_FIELDS_BY_FILE = new Map();
  for (const hub of ALL_HUBS) {
    for (const f of hub.fields || []) {
      const addRec = (fp, role, mode, line) => {
        if (!fp) return;
        const arr = HUB_FIELDS_BY_FILE.get(fp) || [];
        arr.push({
          entity: hub.entity,
          field: f.field,
          role,
          mode,
          line: line || 1,
          multiWriterRisk: Boolean(f.multiWriterRisk),
          derivedOnRead: Boolean(f.derivedOnRead),
          writers: f.writers || [],
          readers: f.readers || [],
        });
        HUB_FIELDS_BY_FILE.set(fp, arr);
      };
      for (const w of f.writers || []) addRec(w.file, "writer", w.mode || "write", w.line);
      for (const r of f.readers || []) addRec(r.file, "reader", r.derived ? "derived" : "read", r.line);
    }
  }

  const SMS_BY_FILE = new Map();
  for (const sm of ALL_SMS) {
    if (!sm.file) continue;
    const arr = SMS_BY_FILE.get(sm.file) || [];
    arr.push(sm);
    SMS_BY_FILE.set(sm.file, arr);
  }

  const ASYNC_BY_FILE = new Map();
  ALL_ASYNCS.forEach((ah, idx) => {
    if (ah.producer?.file) {
      const arr = ASYNC_BY_FILE.get(ah.producer.file) || [];
      arr.push({ role: "producer", idx, ah });
      ASYNC_BY_FILE.set(ah.producer.file, arr);
    }
    if (ah.consumer?.file) {
      const arr = ASYNC_BY_FILE.get(ah.consumer.file) || [];
      arr.push({ role: "consumer", idx, ah });
      ASYNC_BY_FILE.set(ah.consumer.file, arr);
    }
  });

  function stepOpTag(op) {
    if (op === "db_read") return "R";
    if (op === "db_write") return "W";
    if (op === "db_commit") return "COMMIT";
    if (op === "cache_del") return "CACHE";
    if (op === "notify") return "NOTIFY";
    if (op === "async_publish") return "PUB";
    if (op === "ext_http") return "HTTP";
    if (op === "respond") return "200";
    return "CALL";
  }

  function stepToneClass(step, wf) {
    const hasHaz = (wf?.hazards || []).some((h) => h.line === step.line);
    if (hasHaz) return "step-haz";
    if (step.op === "respond") return "step-ok";
    if (step.op === "notify" || step.op === "async_publish" || step.op === "cache_del") return "step-async";
    if (step.op === "db_write" || step.op === "db_commit") return "step-write";
    return "step-read";
  }

  function renderFileBehaviorCard(filePath) {
    if (!filePath) return "";
    const flows = (FLOWS_BY_FILE.get(filePath) || []).slice(0, 4);
    const hubs = (HUB_FIELDS_BY_FILE.get(filePath) || []).slice(0, 5);
    const sms = (SMS_BY_FILE.get(filePath) || []).slice(0, 2);
    const asyncs = (ASYNC_BY_FILE.get(filePath) || []).slice(0, 4);
    if (flows.length === 0 && hubs.length === 0 && sms.length === 0 && asyncs.length === 0) return "";

    const blocks = [];

    if (flows.length > 0) {
      const flowItems = flows.map((wf) => {
        const steps = (wf.steps || []).slice(0, 8);
        const chips = steps.map((s, si) => {
          const shortFn = String(s.fn || "").split(".").pop() || s.op;
          const lbl = (si + 1) + ". " + stepOpTag(s.op) + ":" + (shortFn.length > 16 ? shortFn.slice(0, 15) + "…" : shortFn);
          const jumpAttr = s.file === filePath
            ? 'data-jump-line="' + s.line + '"'
            : 'data-open-file="' + esc(s.file) + '" data-open-file-line="' + s.line + '"';
          return '<button class="flow-chip ' + stepToneClass(s, wf) + '" ' + jumpAttr + ' title="' + esc(s.fn + " (" + s.op + " · :" + s.line + ")") + '">' + esc(lbl) + "</button>";
        }).join('<span class="flow-arr">→</span>');
        const hazBadge = wf.hazardCount > 0 ? '<span class="badge b-warn">' + wf.hazardCount + " DDIA</span>" : "";
        return (
          '<div class="beh-item">' +
          '<div class="beh-item-head">' +
          '<span class="mono" style="font-weight:600;color:#e6ebf5">' + esc(wf.name) + ' <span class="muted">(' + wf.serialAwaitCount + " awaits)</span></span>" +
          '<div style="display:flex;gap:5px;align-items:center">' +
          hazBadge +
          '<button class="tbtn" data-map-flow-overlay="' + esc(wf.id) + '" title="Overlay numbered steps on the architecture Map">Walk on Map</button>' +
          '<button class="tbtn" data-jump-flow="' + esc(wf.id) + '" title="Open full Swimlane Waterfall in Flows tab">Swimlane ↗</button>' +
          "</div></div>" +
          (chips ? '<div class="flow-strip">' + chips + "</div>" : "") +
          "</div>"
        );
      }).join("");
      blocks.push('<div class="beh-sub"><div class="beh-sub-lbl">Work Flows (' + flows.length + ')</div>' + flowItems + "</div>");
    }

    if (hubs.length > 0) {
      const seenKey = new Set();
      const hubRows = [];
      for (const h of hubs) {
        const k = h.entity + "." + h.field + ":" + h.role;
        if (seenKey.has(k)) continue;
        seenKey.add(k);
        const peers = (h.writers || []).filter((w) => w.file !== filePath).slice(0, 3);
        const peerBtns = peers.map((p) =>
          '<button class="tray-chip" data-open-file="' + esc(p.file) + '" data-open-file-line="' + p.line + '" title="Jump to sibling writer ' + esc(p.file) + '">↗ ' + esc(p.file.split("/").pop()) + ":" + p.line + "</button>"
        ).join("");
        hubRows.push(
          '<div class="beh-item">' +
          '<div class="beh-item-head">' +
          '<span class="mono">' + (h.role === "writer" ? "Writes " : "Reads ") + '<strong style="color:#c7a4ff">' + esc(h.entity + "." + h.field) + "</strong></span>" +
          '<div style="display:flex;gap:5px;align-items:center">' +
          (h.multiWriterRisk ? '<span class="badge b-warn">multi-writer</span>' : h.derivedOnRead ? '<span class="badge b-info">derived</span>' : "") +
          '<button class="tbtn" data-jump-hub="' + esc(h.entity + "::" + h.field) + '">Hub ↗</button>' +
          "</div></div>" +
          (peerBtns ? '<div class="pill-row" style="margin-top:4px"><span class="muted" style="font-size:11px">Also mutated by:</span>' + peerBtns + "</div>" : "") +
          "</div>"
        );
      }
      blocks.push('<div class="beh-sub"><div class="beh-sub-lbl">Entity Data Lifecycle</div>' + hubRows.join("") + "</div>");
    }

    if (asyncs.length > 0) {
      const aRows = asyncs.map((item) => {
        const ah = item.ah;
        const peer = item.role === "producer" ? ah.consumer : ah.producer;
        const peerBtn = peer && ddIdxByPath.has(peer.file)
          ? '<button class="tray-chip async-chip" data-open-file="' + esc(peer.file) + '" data-open-file-line="' + peer.line + '">' + (item.role === "producer" ? "Consumer: " : "Producer: ") + esc(peer.file.split("/").pop()) + ":" + peer.line + " →</button>"
          : '<span class="muted mono" style="font-size:11px">' + (peer ? esc(peer.fn) : "external consumer") + "</span>";
        return (
          '<div class="beh-item">' +
          '<div class="beh-item-head">' +
          '<span class="mono" style="color:#c7a4ff">⚡ ' + (item.role === "producer" ? "Publishes → " : "Consumes ← ") + esc(ah.channel) + "</span>" +
          '<span class="badge b-purple">' + esc(ah.transport) + "</span>" +
          "</div>" +
          '<div class="pill-row" style="margin-top:4px">' + peerBtn + "</div>" +
          "</div>"
        );
      }).join("");
      blocks.push('<div class="beh-sub"><div class="beh-sub-lbl">Cross-Boundary Async</div>' + aRows + "</div>");
    }

    if (sms.length > 0) {
      const smRows = sms.map((sm) =>
        '<div class="beh-item">' +
        '<div class="beh-item-head">' +
        '<span class="mono" style="font-weight:600">' + esc(sm.name) + "</span>" +
        '<button class="tbtn" data-jump-sm="' + esc(sm.id + "::" + (sm.states?.[0] || "")) + '">Statechart ↗</button>' +
        "</div>" +
        '<div class="flow-strip">' + (sm.states || []).slice(0, 6).map((st) => '<span class="badge b-cyan">' + esc(st) + "</span>").join('<span class="flow-arr">→</span>') + "</div>" +
        "</div>"
      ).join("");
      blocks.push('<div class="beh-sub"><div class="beh-sub-lbl">State Machine</div>' + smRows + "</div>");
    }

    return (
      '<div class="behavior-card">' +
      '<div class="sec-title"><span>How This File Works</span><span class="badge b-cyan">RUNTIME FLOW</span></div>' +
      blocks.join("") +
      "</div>"
    );
  }

  function matchNodeFlows(node, unitDir, fileList) {
    const fileSet = fileList && fileList.length > 0 ? new Set(fileList) : null;
    const prefix = unitDir ? unitDir.replace(/\\/+$/, "") + "/" : "";
    const flows = ALL_FLOWS.filter((wf) => {
      if (fileSet && fileSet.has(wf.file)) return true;
      if (prefix && wf.file.startsWith(prefix)) return true;
      return false;
    });
    const asyncs = ALL_ASYNCS.filter((ah) => {
      const pf = ah.producer?.file || "";
      const cf = ah.consumer?.file || "";
      if (fileSet && (fileSet.has(pf) || fileSet.has(cf))) return true;
      if (prefix && (pf.startsWith(prefix) || cf.startsWith(prefix))) return true;
      if (node && (node.kind === "external_service" || node.kind === "datastore")) {
        const lbl = String(node.label || "").toLowerCase();
        return lbl.includes("pubsub") || lbl.includes("queue") || lbl.includes("bus")
          ? ah.transport.toLowerCase().includes("pubsub") || ah.transport.toLowerCase().includes("queue") || ah.transport.toLowerCase().includes("bus")
          : false;
      }
      return false;
    });
    const hubs = node?.kind === "datastore"
      ? ALL_HUBS
      : ALL_HUBS.filter((hub) =>
          (hub.fields || []).some((f) =>
            (f.writers || []).some((w) => (fileSet && fileSet.has(w.file)) || (prefix && w.file.startsWith(prefix)))
          )
        );
    return { flows, hubs, asyncs };
  }

  function renderNodeFlowsRollup(node, unitDir, fileList) {
    const m = matchNodeFlows(node, unitDir, fileList);
    if (m.flows.length === 0 && m.hubs.length === 0 && m.asyncs.length === 0) return "";
    const parts = [];
    if (m.flows.length > 0) {
      const hazTot = m.flows.reduce((s, w) => s + (w.hazardCount || 0), 0);
      parts.push(
        renderDisclosure({
          title: "Work Flows (" + m.flows.length + ")",
          meta: hazTot > 0 ? hazTot + " DDIA flags · click Walk to trace on Map" : "ordered entrypoint traces",
          badge: m.flows.length,
          badgeClass: hazTot > 0 ? "b-warn" : "b-cyan",
          tone: hazTot > 0 ? "warn" : "info",
          open: m.flows.length <= 6 || hazTot > 0,
          bodyHtml: m.flows.slice(0, 10).map((wf) =>
            '<div class="row">' +
            '<span class="row-link mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-open-file="' + esc(wf.file) + '" data-open-file-line="' + wf.line + '" title="' + esc(wf.file) + '">' + esc(wf.name) + (wf.hazardCount > 0 ? " [" + wf.hazardCount + "!]" : "") + "</span>" +
            '<span style="display:flex;gap:4px;flex-shrink:0">' +
            '<button class="tbtn" data-map-flow-overlay="' + esc(wf.id) + '" title="Overlay this flow on the Map">Walk</button>' +
            '<button class="tbtn" data-jump-flow="' + esc(wf.id) + '" title="Open Swimlane">↗</button>' +
            "</span></div>"
          ).join("") + (m.flows.length > 10 ? '<div class="muted">+' + (m.flows.length - 10) + " more in Flows tab</div>" : ""),
        })
      );
    }
    if (m.hubs.length > 0) {
      parts.push(
        renderDisclosure({
          title: "Entity Data Hubs (" + m.hubs.length + ")",
          meta: "multi-site field writers & derivations",
          badge: m.hubs.length,
          badgeClass: "b-purple",
          tone: "info",
          open: node?.kind === "datastore",
          bodyHtml: m.hubs.slice(0, 8).map((h) => {
            const firstF = h.fields?.[0];
            const firstW = firstF?.writers?.[0];
            return (
              '<div class="row">' +
              '<span class="row-link mono" data-jump-hub="' + esc(h.entity + "::" + (firstF?.field || "")) + '">' + esc(h.entity) + ' <span class="muted">(' + h.fieldCount + " fields)</span></span>" +
              (firstW && ddIdxByPath.has(firstW.file) ? '<button class="tbtn" data-open-file="' + esc(firstW.file) + '" data-open-file-line="' + firstW.line + '">Code</button>' : "") +
              "</div>"
            );
          }).join(""),
        })
      );
    }
    if (m.asyncs.length > 0) {
      parts.push(
        renderDisclosure({
          title: "Async Handoffs (" + m.asyncs.length + ")",
          meta: "queues, pubsub, triggers & consumers",
          badge: m.asyncs.length,
          badgeClass: "b-purple",
          tone: "info",
          open: m.asyncs.length <= 5,
          bodyHtml: m.asyncs.slice(0, 8).map((ah) =>
            '<div class="row">' +
            '<span class="row-link mono" style="color:#c7a4ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-open-file="' + esc(ah.producer.file) + '" data-open-file-line="' + ah.producer.line + '">⚡ ' + esc(ah.channel) + "</span>" +
            '<span class="badge b-na">' + esc(ah.transport) + "</span>" +
            "</div>"
          ).join(""),
        })
      );
    }
    return '<div class="sec"><div class="sec-title"><span>Work Flows &amp; Lifecycles</span><span class="muted">space-time</span></div>' + parts.join("") + "</div>";
  }

  function computeNodeFlowBadge(n) {
    if (!n || ALL_FLOWS.length === 0) return null;
    if (n.id.startsWith("file:")) {
      const fp = n.id.slice(5);
      const fls = FLOWS_BY_FILE.get(fp) || [];
      const asy = ASYNC_BY_FILE.get(fp) || [];
      if (fls.length > 0) {
        const hz = fls.reduce((s, w) => s + (w.hazardCount || 0), 0);
        return { text: fls.length + " flow" + (fls.length === 1 ? "" : "s") + (hz > 0 ? " · " + hz + "!" : ""), warn: hz > 0 };
      }
      if (asy.length > 0) return { text: "⚡ async", warn: false };
      return null;
    }
    const specNode = nodeById.get(n.id);
    if (specNode) {
      if (specNode.kind === "datastore" && ALL_HUBS.length > 0) {
        return { text: ALL_HUBS.length + " hubs", warn: false };
      }
      const dir = typeof specNode.meta?.dir === "string" ? specNode.meta.dir : "";
      if (dir) {
        const pref = dir.replace(/\\/+$/, "") + "/";
        let cnt = 0;
        let hz = 0;
        for (const wf of ALL_FLOWS) {
          if (wf.file.startsWith(pref)) { cnt += 1; hz += wf.hazardCount || 0; }
        }
        if (cnt > 0) return { text: cnt + " flows" + (hz > 0 ? " · " + hz + "!" : ""), warn: hz > 0 };
      }
    }
    const mod = moduleById.get(n.id);
    if (mod && mod.files && mod.files.length > 0) {
      let cnt = 0;
      for (const mf of mod.files) {
        if (FLOWS_BY_FILE.has(mf.file)) cnt += (FLOWS_BY_FILE.get(mf.file) || []).length;
      }
      if (cnt > 0) return { text: cnt + " flow" + (cnt === 1 ? "" : "s"), warn: false };
    }
    return null;
  }
  ${renderMapFlowOverlayClientScript()}
`;
}
