import fs from "node:fs";
import path from "node:path";
import type {
  AsyncHandoff,
  EntityFieldLifecycle,
  ExtractedStateMachine,
  FlowAnalysisBundle,
  WorkFlowRecord,
} from "./types.ts";

interface FlowsHtmlRenderers {
  repoDir?: string;
  renderSwimlane: (flow: WorkFlowRecord, options?: { mode?: "current" | "optimized" }) => string;
  renderDataHub: (entityName: string, fields: readonly EntityFieldLifecycle[]) => string;
  renderStateMachine: (machine: ExtractedStateMachine) => string;
  renderAsync: (handoffs: readonly AsyncHandoff[]) => string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readSnippetMap(repoDir: string | undefined, files: Set<string>): Record<string, string[]> {
  if (!repoDir) return {};
  const map: Record<string, string[]> = {};
  for (const rel of files) {
    if (!rel || rel === ".") continue;
    const abs = path.join(repoDir, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 220_000) continue;
      map[rel] = fs.readFileSync(abs, "utf8").split("\n");
    } catch {
      continue;
    }
  }
  return map;
}

export function buildFlowsHtmlDocument(
  bundle: FlowAnalysisBundle,
  title: string,
  renderers: FlowsHtmlRenderers,
): string {
  const topFlows = bundle.workFlows.slice(0, 24);
  const byEntity = new Map<string, EntityFieldLifecycle[]>();
  for (const lf of bundle.entityLifecycles) {
    const arr = byEntity.get(lf.entity) ?? [];
    arr.push(lf);
    byEntity.set(lf.entity, arr);
  }
  const entities = Array.from(byEntity.entries()).slice(0, 12);
  const machines = bundle.stateMachines.slice(0, 12);
  const asyncList = bundle.asyncHandoffs.slice(0, 12);

  const referencedFiles = new Set<string>();
  for (const wf of topFlows) referencedFiles.add(wf.file);
  for (const [, flds] of entities) {
    for (const f of flds.slice(0, 8)) {
      for (const w of f.writers.slice(0, 4)) referencedFiles.add(w.file);
      for (const r of f.readers.slice(0, 4)) referencedFiles.add(r.file);
    }
  }
  for (const sm of machines) referencedFiles.add(sm.file);
  for (const ah of asyncList) {
    referencedFiles.add(ah.producer.file);
    if (ah.consumer) referencedFiles.add(ah.consumer.file);
  }

  const payload = {
    workFlows: topFlows.map((wf) => ({
      id: wf.id,
      name: wf.name,
      entryFn: wf.entryFn ?? wf.name,
      triggerKind: wf.triggerKind,
      file: wf.file,
      line: wf.line,
      serialAwaitCount: wf.serialAwaitCount,
      steps: wf.steps,
      hazards: wf.hazards,
      telemetry: wf.telemetry ?? null,
      svg: renderers.renderSwimlane(wf, { mode: "current" }),
      optimizedSvg: renderers.renderSwimlane(wf, { mode: "optimized" }),
    })),
    dataHubs: entities.map(([entity, fields]) => ({
      entity,
      fields: fields.slice(0, 8),
      svg: renderers.renderDataHub(entity, fields),
    })),
    stateMachines: machines.map((sm) => ({
      id: sm.id,
      name: sm.name,
      file: sm.file,
      line: sm.line,
      states: sm.states,
      transitions: sm.transitions,
      svg: renderers.renderStateMachine(sm),
    })),
    asyncHandoffs: asyncList,
    asyncHandoffsSvg: asyncList.length > 0 ? renderers.renderAsync(asyncList) : "",
    sources: readSnippetMap(renderers.repoDir, referencedFiles),
  };

  const json = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#080b12;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.45}
  .bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;background:#0b101b;border-bottom:1px solid #1e293b}
  .tabs,.sub{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .btn{background:#131b2c;color:#cbd5e1;border:1px solid #26334d;border-radius:7px;padding:5px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
  .btn.active{background:#2563eb;color:#fff;border-color:#3b82f6}
  .ws{display:grid;grid-template-columns:minmax(0,1fr) 430px;min-height:calc(100vh - 52px)}
  @media (max-width:1020px){.ws{grid-template-columns:1fr}}
  .stage{padding:14px 16px;overflow:auto}
  .drawer{background:#0c1220;border-left:1px solid #1e293b;padding:14px 16px;overflow:auto}
  .card{background:#101829;border:1px solid #1e293b;border-radius:10px;padding:14px;margin-bottom:12px}
  .mono{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px}
  .muted{color:#94a3b8}
  .code{background:#070b14;border:1px solid #1e293b;border-radius:7px;padding:8px 0;overflow:auto;font-family:ui-monospace,monospace;font-size:11.5px;margin-top:8px}
  .cline{display:flex;gap:10px;padding:1px 10px;white-space:pre}
  .cline.hi{background:rgba(56,189,248,0.16);border-left:3px solid #38bdf8}
  .ln{color:#64748b;min-width:34px;text-align:right;user-select:none}
  .pill{display:inline-block;padding:2px 7px;border-radius:4px;font-family:ui-monospace,monospace;font-size:10.5px;font-weight:700;background:#1e293b;color:#cbd5e1}
  .err{background:rgba(239,68,68,0.16);color:#fca5a5}
  .warn{background:rgba(245,158,11,0.16);color:#fcd34d}
  .ok{background:rgba(34,197,94,0.16);color:#86efac}
  .ref-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid #1e293b;border-radius:6px;margin-top:6px;cursor:pointer;background:#11192b}
  .ref-row:hover{border-color:#38bdf8}
  .search{background:#111827;color:#e2e8f0;border:1px solid #26334d;border-radius:7px;padding:5px 9px;font-size:12px;width:200px}
</style>
</head>
<body>
<div class="bar">
  <div class="tabs" id="top-tabs"></div>
  <div class="sub"><input id="q" class="search" placeholder="Filter flows / files..."/><button id="hz-btn" class="btn">Hazards only</button></div>
</div>
<div class="ws">
  <div class="stage" id="stage"></div>
  <aside class="drawer" id="drawer"></aside>
</div>
<script id="flow-data" type="application/json">${json}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById("flow-data").textContent);
  const st = { tab: "workflows", flowId: D.workFlows[0]?.id || null, mode: "current", stepIdx: null, hubField: null, smState: null, asyncIdx: null, codeFile: null, codeLine: 1, q: "", hzOnly: false };
  const esc = (s) => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const renderCode = (file, line) => {
    const lines = D.sources[file];
    if (!lines) return '<div class="muted mono" style="margin-top:8px">' + esc(file) + ":" + line + " (source snippet unavailable)</div>";
    const start = Math.max(0, line - 9);
    const end = Math.min(lines.length, line + 12);
    const rows = [];
    for (let i = start; i < end; i += 1) {
      rows.push('<div class="cline' + (i + 1 === line ? " hi" : "") + '"><span class="ln">' + (i + 1) + '</span><span>' + esc(lines[i]) + "</span></div>");
    }
    return '<div class="mono muted" style="margin-top:8px">' + esc(file) + ":" + line + '</div><div class="code">' + rows.join("") + "</div>";
  };

  function render() {
    document.getElementById("top-tabs").innerHTML = [
      ["workflows", "Work Flows (" + D.workFlows.length + ")"],
      ["hubs", "Data Hubs (" + D.dataHubs.length + ")"],
      ["machines", "Statecharts (" + D.stateMachines.length + ")"],
      ["async", "Async Handoffs (" + D.asyncHandoffs.length + ")"],
    ].map(([id, lbl]) => '<button class="btn' + (st.tab === id ? " active" : "") + '" data-tab="' + id + '">' + lbl + "</button>").join("");
    document.getElementById("hz-btn").classList.toggle("active", st.hzOnly);

    const stage = document.getElementById("stage");
    const drawer = document.getElementById("drawer");

    if (st.tab === "workflows") {
      const list = D.workFlows.filter((w) => (!st.hzOnly || w.hazards.length > 0) && (!st.q || (w.name + " " + w.file).toLowerCase().includes(st.q)));
      const wf = list.find((w) => w.id === st.flowId) || list[0] || null;
      if (!wf) { stage.innerHTML = '<div class="muted">No matching work flows.</div>'; drawer.innerHTML = ""; return; }
      st.flowId = wf.id;
      const picker = list.slice(0, 18).map((w) => '<button class="btn' + (w.id === wf.id ? " active" : "") + '" data-flow="' + esc(w.id) + '">' + esc(w.name) + (w.hazards.length ? " [" + w.hazards.length + "!]" : "") + "</button>").join("");
      stage.innerHTML =
        '<div class="sub" style="margin-bottom:10px">' + picker + '</div>' +
        '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><div><strong>' + esc(wf.name) + '</strong> <span class="mono muted">' + esc(wf.file) + ":" + wf.line + '</span></div>' +
        '<div class="sub"><button class="btn' + (st.mode === "current" ? " active" : "") + '" data-mode="current">Current</button><button class="btn' + (st.mode === "optimized" ? " active" : "") + '" data-mode="optimized">What-If (Optimized)</button></div></div>' +
        (st.mode === "optimized" ? wf.optimizedSvg : wf.svg) + "</div>";

      const selStep = st.stepIdx !== null ? wf.steps.find((s) => s.index === st.stepIdx) : null;
      const focusFile = st.codeFile || selStep?.file || wf.file;
      const focusLine = st.codeFile ? st.codeLine : (selStep?.line || wf.line);
      const hazHtml = wf.hazards.map((h) => '<div class="ref-row" data-jump-file="' + esc(h.file) + '" data-jump-line="' + h.line + '"><div><span class="pill ' + (h.severity === "error" ? "err" : "warn") + '">' + esc(h.kind) + '</span><div style="margin-top:4px;font-size:12px">' + esc(h.summary) + '</div></div><span class="mono muted">:' + h.line + "</span></div>").join("");
      const stepHtml = selStep
        ? '<div class="card"><strong>Selected Step: ' + esc(selStep.fn) + '</strong><div class="sub" style="margin-top:6px"><span class="pill">' + esc(selStep.op) + '</span><span class="pill">' + esc(selStep.lane) + '</span>' + (selStep.afterResponse ? '<span class="pill ok">post-response</span>' : '<span class="pill warn">blocking</span>') + (selStep.bestEffort ? '<span class="pill">best-effort</span>' : "") + "</div></div>"
        : '<div class="muted" style="margin-bottom:10px">Click any bar on the swimlane to inspect its step details &amp; source line.</div>';
      drawer.innerHTML = stepHtml + (hazHtml ? '<div style="margin-bottom:10px"><strong>DDIA Tradeoffs (' + wf.hazards.length + ")</strong>" + hazHtml + "</div>" : "") + "<strong>Code Reference</strong>" + renderCode(focusFile, focusLine);
    } else if (st.tab === "hubs") {
      stage.innerHTML = D.dataHubs.map((h) => '<div class="card"><div style="margin-bottom:8px"><strong>Entity Hub: ' + esc(h.entity) + "</strong></div>" + h.svg + "</div>").join("") || '<div class="muted">No data hubs.</div>';
      const allFields = D.dataHubs.flatMap((h) => h.fields.map((f) => ({ key: h.entity + "::" + f.field, entity: h.entity, field: f })));
      const sel = allFields.find((x) => x.key === st.hubField) || allFields[0];
      if (!sel) { drawer.innerHTML = ""; return; }
      const f = sel.field;
      const focusFile = st.codeFile || f.writers[0]?.file || f.readers[0]?.file || ".";
      const focusLine = st.codeFile ? st.codeLine : (f.writers[0]?.line || f.readers[0]?.line || 1);
      const wRows = f.writers.map((w) => '<div class="ref-row" data-jump-file="' + esc(w.file) + '" data-jump-line="' + w.line + '"><span class="mono">' + esc(w.fn) + '</span><span class="pill ' + (w.mode === "tx" ? "ok" : "warn") + '">' + esc(w.mode) + " :" + w.line + "</span></div>").join("");
      const rRows = f.readers.map((r) => '<div class="ref-row" data-jump-file="' + esc(r.file) + '" data-jump-line="' + r.line + '"><span class="mono">' + esc(r.fn) + '</span><span class="pill">' + (r.derived ? "derived" : "read") + " :" + r.line + "</span></div>").join("");
      drawer.innerHTML = '<strong>' + esc(sel.entity + "." + f.field) + '</strong><div style="margin-top:8px"><strong>Writers (' + f.writers.length + ")</strong>" + (wRows || '<div class="muted">None</div>') + '</div><div style="margin-top:10px"><strong>Readers (' + f.readers.length + ")</strong>" + (rRows || '<div class="muted">Direct doc reads</div>') + "</div><div style='margin-top:10px'><strong>Code Reference</strong>" + renderCode(focusFile, focusLine) + "</div>";
    } else if (st.tab === "machines") {
      stage.innerHTML = D.stateMachines.map((m) => '<div class="card"><div style="margin-bottom:8px"><strong>' + esc(m.name) + '</strong> <span class="mono muted">' + esc(m.file) + ":" + m.line + "</span></div>" + m.svg + "</div>").join("") || '<div class="muted">No state machines.</div>';
      const [smId, stateName] = (st.smState || "").split("::");
      const sm = D.stateMachines.find((m) => m.id === smId) || D.stateMachines[0];
      if (!sm) { drawer.innerHTML = ""; return; }
      const activeSt = stateName || sm.states[0];
      const outTr = sm.transitions.filter((t) => t.from === activeSt);
      const inTr = sm.transitions.filter((t) => t.to === activeSt);
      drawer.innerHTML = '<strong>' + esc(sm.name) + ' · state <code>' + esc(activeSt) + '</code></strong><div style="margin-top:8px"><strong>Outgoing (' + outTr.length + ')</strong>' + outTr.map((t) => '<div class="ref-row"><span class="mono">→ ' + esc(t.to) + '</span>' + (t.guard ? '<span class="pill warn">guard: ' + esc(t.guard) + "</span>" : '<span class="pill">' + esc(t.event) + "</span>") + "</div>").join("") + '</div><div style="margin-top:10px"><strong>Incoming (' + inTr.length + ')</strong>' + inTr.map((t) => '<div class="ref-row"><span class="mono">' + esc(t.from) + ' →</span><span class="pill">' + esc(t.event) + "</span></div>").join("") + "</div><div style='margin-top:10px'><strong>Code Reference</strong>" + renderCode(sm.file, sm.line) + "</div>";
    } else {
      stage.innerHTML = D.asyncHandoffsSvg ? '<div class="card"><strong>Cross-Boundary Async Handoffs</strong>' + D.asyncHandoffsSvg + "</div>" : '<div class="muted">No async handoffs.</div>';
      const ah = D.asyncHandoffs[st.asyncIdx ?? 0];
      if (!ah) { drawer.innerHTML = ""; return; }
      const focusFile = st.codeFile || ah.producer.file;
      const focusLine = st.codeFile ? st.codeLine : ah.producer.line;
      drawer.innerHTML = '<strong>' + esc(ah.channel) + '</strong><div class="sub" style="margin-top:6px"><span class="pill">' + esc(ah.transport) + '</span><span class="pill ' + (ah.delivery === "best-effort" ? "warn" : "ok") + '">' + esc(ah.delivery) + '</span></div>' +
        '<div class="ref-row" data-jump-file="' + esc(ah.producer.file) + '" data-jump-line="' + ah.producer.line + '"><span>Producer: <span class="mono">' + esc(ah.producer.fn) + '</span></span><span class="mono muted">:' + ah.producer.line + "</span></div>" +
        (ah.consumer ? '<div class="ref-row" data-jump-file="' + esc(ah.consumer.file) + '" data-jump-line="' + ah.consumer.line + '"><span>Consumer: <span class="mono">' + esc(ah.consumer.fn) + '</span></span><span class="mono muted">:' + ah.consumer.line + "</span></div>" : '<div class="muted" style="margin-top:6px">Consumer outside scanned repo.</div>') +
        "<div style='margin-top:10px'><strong>Code Reference</strong>" + renderCode(focusFile, focusLine) + "</div>";
    }
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const tb = t.closest("[data-tab]");
    if (tb) { st.tab = tb.getAttribute("data-tab"); st.codeFile = null; render(); return; }
    const fb = t.closest("[data-flow]");
    if (fb) { st.flowId = fb.getAttribute("data-flow"); st.stepIdx = null; st.codeFile = null; render(); return; }
    const mb = t.closest("[data-mode]");
    if (mb) { st.mode = mb.getAttribute("data-mode"); render(); return; }
    const sn = t.closest("[data-flow-step]");
    if (sn) { st.stepIdx = Number(sn.getAttribute("data-flow-step")); st.codeFile = null; render(); return; }
    const hr = t.closest("[data-hub-field]");
    if (hr) { st.hubField = hr.getAttribute("data-hub-field"); st.codeFile = null; render(); return; }
    const smn = t.closest("[data-sm-state]");
    if (smn) { st.smState = smn.getAttribute("data-sm-state"); st.codeFile = null; render(); return; }
    const ar = t.closest("[data-async-idx]");
    if (ar) { st.asyncIdx = Number(ar.getAttribute("data-async-idx")); st.codeFile = null; render(); return; }
    const jf = t.closest("[data-jump-file]");
    if (jf) { st.codeFile = jf.getAttribute("data-jump-file"); st.codeLine = Number(jf.getAttribute("data-jump-line")) || 1; render(); return; }
    if (t.id === "hz-btn") { st.hzOnly = !st.hzOnly; render(); }
  });
  document.getElementById("q").addEventListener("input", (e) => {
    st.q = String(e.target.value || "").trim().toLowerCase();
    render();
  });
  render();
})();
</script>
</body>
</html>`;
}
