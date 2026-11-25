import type { RepoSpecV4 } from "./schema.ts";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCompactRenderPayload(spec: RepoSpecV4, digest: string, inline: boolean): Record<string, unknown> {
  return {
    schemaVersion: spec.schemaVersion,
    digest,
    repo: spec.repo,
    summary: spec.summary,
    verification: spec.verification,
    diagnostics: spec.diagnostics,
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      domain: n.domain,
      kind: n.kind,
      role: n.role,
      label: n.label,
      group: n.group,
      ownerId: n.ownerId,
      provenance: n.provenance,
      findings: n.findings,
      meta: inline
        ? {
            dir: n.meta.dir ?? null,
            archetype: n.meta.archetype ?? null,
            layerAxis: n.meta.layerAxis ?? null,
            layerRank: n.meta.layerRank ?? null,
          }
        : n.meta,
    })),
    edges: spec.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
      weight: e.weight,
      violation: e.violation,
      ruleIds: e.ruleIds,
      confidence: e.confidence,
      evidence: e.evidence?.slice(0, inline ? 2 : 5),
    })),
    invariants: spec.invariants.map((inv) => ({
      ...inv,
      evidence: inv.evidence.slice(0, inline ? 8 : 15),
    })),
    entities: spec.entities.slice(0, inline ? 60 : 250),
    stateMachines: spec.stateMachines.slice(0, inline ? 20 : 40),
    loops: spec.loops.slice(0, inline ? 20 : 40),
    modules: spec.modules.slice(0, inline ? 80 : 300).map((m) => ({
      ...m,
      topExports: m.topExports.slice(0, inline ? 8 : 12),
      files: m.files.slice(0, inline ? 10 : 40),
    })),
    traces: spec.traces,
    surfaces: {
      endpoints: spec.surfaces.endpoints.slice(0, inline ? 50 : 420),
      foreignKeys: spec.surfaces.foreignKeys.slice(0, inline ? 40 : 180),
      envBindings: spec.surfaces.envBindings.slice(0, inline ? 40 : 160),
      govRules: spec.surfaces.govRules.slice(0, inline ? 40 : 160),
    },
    diagrams: inline
      ? spec.diagrams
          .filter((d) => d.category !== "subsystem" || spec.diagrams.length <= 10)
          .slice(0, 16)
          .map((d) => ({
            ...d,
            edges: d.edges.map((e) => ({
              ...e,
              evidence: e.violation ? e.evidence?.slice(0, 2) : undefined,
            })),
          }))
      : spec.diagrams,
  };
}

export function renderVisualHtml(
  spec: RepoSpecV4,
  digest: string,
  options?: { inline?: boolean },
): string {
  const inline = options?.inline ?? false;
  const payload = buildCompactRenderPayload(spec, digest, inline);
  const embeddedJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  const outerCss = inline
    ? `
    html, body { margin: 0; padding: 0; background: transparent; color: var(--foreground, #e5e7eb); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 13px; line-height: 1.45; }
    .app { width: 100%; max-width: 100%; }
    .workspace { display: flex; flex-direction: column; gap: 10px; }
    .canvas-shell { height: 470px; }
    .drawer { max-height: 390px; }`
    : `
    html, body { margin: 0; padding: 0; background: var(--background, #090d16); color: var(--foreground, #e5e7eb); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 13px; line-height: 1.45; }
    .app { max-width: 1720px; margin: 0 auto; padding: 14px 18px 18px; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 392px; gap: 12px; align-items: stretch; }
    .canvas-shell { height: calc(100vh - 156px); min-height: 540px; }
    .drawer { height: calc(100vh - 156px); min-height: 540px; }
    @media (max-width: 1040px) {
      .workspace { grid-template-columns: 1fr; }
      .canvas-shell { height: 520px; min-height: 400px; }
      .drawer { height: auto; max-height: 480px; min-height: 220px; }
    }`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RepoSpec v${escapeHtml(spec.schemaVersion)} · ${escapeHtml(spec.repo.name)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  ${outerCss}
  .topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border, #1f2937); margin-bottom: 10px; }
  .title-wrap { display: flex; flex-direction: column; gap: 2px; }
  .title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: var(--foreground, #f8fafc); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status-line { font-size: 11px; color: var(--muted-foreground, #94a3b8); font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace); display: flex; gap: 10px; flex-wrap: wrap; }
  .status-fail { color: var(--destructive, #ef4444); font-weight: 600; }
  .status-warn { color: var(--warning, #f59e0b); font-weight: 600; }
  .status-pass { color: var(--success, #10b981); font-weight: 600; }

  .controls-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .search-wrap { position: relative; }
  .search { background: var(--card, #111827); color: var(--foreground, #f8fafc); border: 1px solid var(--border, #334155); border-radius: var(--radius, 7px); padding: 6px 10px; font-size: 12px; width: 256px; outline: none; }
  .search:focus { border-color: var(--primary, #3b82f6); }
  .search-dropdown { position: absolute; top: 34px; right: 0; width: 390px; max-height: 360px; overflow-y: auto; background: var(--popover, #0f172a); border: 1px solid var(--border, #334155); border-radius: 8px; z-index: 40; box-shadow: 0 12px 28px rgba(0,0,0,0.45); display: none; }
  .search-dropdown.open { display: block; }
  .search-item { padding: 7px 10px; border-bottom: 1px solid var(--border, #1e293b); cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .search-item:hover { background: var(--secondary, #1e293b); }
  .search-item-main { font-size: 12px; color: var(--foreground, #f8fafc); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-item-kind { font-size: 10px; color: var(--muted-foreground, #94a3b8); text-transform: uppercase; flex-shrink: 0; }

  .nav-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tab { background: var(--card, #111827); border: 1px solid var(--border, #1f2937); color: var(--muted-foreground, #cbd5e1); border-radius: var(--radius, 7px); padding: 5px 11px; font-size: 12px; font-weight: 500; cursor: pointer; }
  .tab:hover { color: var(--foreground, #f8fafc); border-color: var(--primary, #3b82f6); }
  .tab.active { background: var(--primary, #2563eb); color: var(--primary-foreground, #ffffff); border-color: var(--primary, #2563eb); font-weight: 600; }
  .sub-toggles { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .pill-btn { background: var(--secondary, #1e293b); color: var(--foreground, #e2e8f0); border: 1px solid var(--border, #334155); border-radius: 6px; padding: 4px 9px; font-size: 11px; cursor: pointer; }
  .pill-btn:hover { border-color: var(--primary, #3b82f6); }
  .pill-btn.active { background: var(--primary, #2563eb); color: #ffffff; border-color: var(--primary, #2563eb); }

  .canvas-panel { background: var(--card, #0f1623); border: 1px solid var(--border, #1f2937); border-radius: var(--radius, 10px); padding: 10px 12px; display: flex; flex-direction: column; min-width: 0; }
  .canvas-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  .canvas-title { font-size: 13px; font-weight: 700; color: var(--foreground, #f8fafc); }
  .canvas-sub { font-size: 11px; color: var(--muted-foreground, #94a3b8); margin-bottom: 6px; }
  .toolbar { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .seg-group { display: inline-flex; border: 1px solid var(--border, #334155); border-radius: 6px; overflow: hidden; }
  .seg-btn { background: var(--secondary, #1e293b); color: var(--muted-foreground, #cbd5e1); border: 0; padding: 3px 9px; font-size: 11px; cursor: pointer; font-family: var(--font-mono, monospace); }
  .seg-btn.active { background: var(--primary, #2563eb); color: #ffffff; font-weight: 600; }
  .tbtn { background: var(--secondary, #1e293b); color: var(--foreground, #e2e8f0); border: 1px solid var(--border, #334155); border-radius: 5px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: var(--font-mono, monospace); }
  .tbtn:hover { border-color: var(--primary, #3b82f6); }
  .tbtn.active { background: var(--primary, #2563eb); color: #ffffff; border-color: var(--primary, #2563eb); }

  .canvas-shell { position: relative; overflow: hidden; border: 1px solid var(--border, #1e293b); border-radius: 8px; background: var(--background, #090d16); cursor: grab; user-select: none; touch-action: none; }
  .canvas-shell.matrix-mode { overflow: auto; cursor: default; user-select: text; padding: 12px; }
  .canvas-shell.dragging { cursor: grabbing; }
  .canvas-shell svg { width: 100%; height: 100%; display: block; }
  .edge-tooltip { position: absolute; pointer-events: none; z-index: 30; background: rgba(15, 23, 42, 0.96); border: 1px solid #3b82f6; color: #f8fafc; border-radius: 6px; padding: 5px 9px; font-size: 11px; font-family: var(--font-mono, monospace); box-shadow: 0 8px 20px rgba(0,0,0,0.45); display: none; max-width: 340px; white-space: nowrap; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding-top: 6px; font-size: 10px; color: var(--muted-foreground, #94a3b8); }
  .leg-item { display: inline-flex; align-items: center; gap: 5px; }
  .leg-swatch { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }

  .tray { margin-top: 6px; padding: 6px 8px; border: 1px dashed var(--border, #334155); border-radius: 6px; font-size: 11px; color: var(--muted-foreground, #94a3b8); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tray-chip { padding: 2px 7px; border-radius: 4px; background: var(--secondary, #1e293b); color: var(--foreground, #cbd5e1); font-family: var(--font-mono, monospace); font-size: 10px; cursor: pointer; border: 1px solid transparent; }
  .tray-chip:hover { border-color: var(--primary, #3b82f6); }

  .svg-node { cursor: pointer; outline: none; transition: opacity 0.12s ease; }
  .svg-node:hover .node-shape, .svg-node:focus .node-shape { stroke-width: 2.3 !important; stroke: var(--primary, #60a5fa) !important; }
  .svg-node.selected .node-shape { stroke-width: 2.8 !important; stroke: var(--primary, #60a5fa) !important; }
  .svg-node.dimmed { opacity: 0.16; }
  .svg-edge-group { cursor: pointer; transition: opacity 0.12s ease; }
  .svg-edge-group.edge-detail-hidden { display: none; }
  .svg-edge-group.dimmed { opacity: 0.1; }
  .svg-edge-group.selected .svg-edge-vis { stroke-width: 3.2 !important; stroke: var(--primary, #60a5fa) !important; }
  .svg-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }

  svg.hover-focus .svg-node { opacity: 0.16; }
  svg.hover-focus .svg-node.hover-active { opacity: 1 !important; }
  svg.hover-focus .svg-edge-group { opacity: 0.06; }
  svg.hover-focus .svg-edge-group.hover-out { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis { stroke: #38bdf8 !important; stroke-width: 2.4 !important; }
  svg.hover-focus .svg-edge-group.hover-in { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke: #34d399 !important; stroke-width: 2.4 !important; }
  svg.hover-focus .svg-edge-group.hover-viol { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-viol .svg-edge-vis { stroke: #ef4444 !important; stroke-width: 2.8 !important; }

  .dsm-wrap { display: inline-block; min-width: 100%; }
  .dsm-note { font-size: 11px; color: var(--muted-foreground, #94a3b8); margin-bottom: 10px; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .dsm-table { border-collapse: separate; border-spacing: 2px; font-family: var(--font-mono, monospace); font-size: 10.5px; }
  .dsm-table th, .dsm-table td { padding: 0; text-align: center; }
  .dsm-corner { text-align: right; padding: 4px 8px !important; color: var(--muted-foreground, #64748b); font-size: 9.5px; }
  .dsm-col-th { vertical-align: bottom; padding-bottom: 6px !important; min-width: 30px; max-width: 32px; cursor: pointer; }
  .dsm-col-lbl { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; max-height: 120px; overflow: hidden; text-overflow: ellipsis; color: #cbd5e1; font-size: 10px; padding: 2px 4px; border-radius: 3px; }
  .dsm-col-th:hover .dsm-col-lbl, .dsm-col-th.hl .dsm-col-lbl { color: #60a5fa; background: rgba(59,130,246,0.14); }
  .dsm-row-th { text-align: right !important; padding: 3px 8px !important; white-space: nowrap; color: #cbd5e1; cursor: pointer; border-radius: 3px; }
  .dsm-row-th:hover, .dsm-row-th.hl { color: #60a5fa; background: rgba(59,130,246,0.14); }
  .dsm-lane-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .dsm-cell { width: 30px; height: 26px; border-radius: 4px; background: rgba(30, 41, 59, 0.35); border: 1px solid rgba(51, 65, 85, 0.35); color: #64748b; }
  .dsm-cell.diag { background: rgba(148, 163, 184, 0.08); border-color: rgba(148, 163, 184, 0.16); color: #475569; }
  .dsm-cell.hit { cursor: pointer; color: #e0f2fe; font-weight: 700; border-color: rgba(56, 189, 248, 0.45); }
  .dsm-cell.hit:hover { outline: 2px solid #60a5fa; z-index: 2; }
  .dsm-cell.viol { background: rgba(239, 68, 68, 0.36) !important; border-color: #ef4444 !important; color: #fecaca !important; cursor: pointer; font-weight: 700; }
  .dsm-cell.sel { outline: 2px solid #f8fafc !important; }

  .drawer { background: var(--card, #0f1623); border: 1px solid var(--border, #1f2937); border-radius: var(--radius, 10px); padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .drawer-title { font-size: 14px; font-weight: 700; color: var(--foreground, #f8fafc); word-break: break-word; }
  .drawer-sub { font-size: 11px; color: var(--muted-foreground, #94a3b8); font-family: var(--font-mono, monospace); word-break: break-all; }
  .sec { border-top: 1px solid var(--border, #1f2937); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .sec-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground, #94a3b8); display: flex; justify-content: space-between; align-items: center; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; font-size: 11.5px; padding: 2px 0; }
  .row-link { cursor: pointer; color: var(--foreground, #e2e8f0); }
  .row-link:hover { color: var(--primary, #60a5fa); }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; }
  .muted { color: var(--muted-foreground, #94a3b8); }

  details.disc { background: var(--background, #090d16); border: 1px solid var(--border, #1f2937); border-left: 3px solid var(--border, #334155); border-radius: 6px; overflow: hidden; }
  details.disc.tone-fail { border-left-color: var(--destructive, #ef4444); }
  details.disc.tone-warn { border-left-color: var(--warning, #f59e0b); }
  details.disc.tone-pass { border-left-color: var(--success, #10b981); }
  details.disc.tone-info { border-left-color: var(--primary, #3b82f6); }
  summary.disc-sum { list-style: none; cursor: pointer; padding: 7px 9px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11.5px; user-select: none; }
  summary.disc-sum::-webkit-details-marker { display: none; }
  summary.disc-sum:hover { background: rgba(148, 163, 184, 0.06); }
  .disc-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
  .disc-chev { color: #64748b; font-size: 10px; transition: transform 0.14s ease; flex-shrink: 0; display: inline-block; }
  details.disc[open] > summary.disc-sum .disc-chev { transform: rotate(90deg); color: #94a3b8; }
  .disc-title { font-weight: 600; color: var(--foreground, #f1f5f9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disc-meta { font-size: 10px; color: var(--muted-foreground, #94a3b8); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disc-body { padding: 7px 9px 9px; border-top: 1px solid rgba(30, 41, 59, 0.9); display: flex; flex-direction: column; gap: 6px; font-size: 11px; }
  .ev-item { padding: 5px 7px; border-radius: 4px; background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(51, 65, 85, 0.45); display: flex; flex-direction: column; gap: 2px; }
  .fix-note { padding: 5px 7px; border-radius: 4px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); color: #cbd5e1; font-size: 10.5px; }

  .ev-box { background: var(--background, #090d16); border: 1px solid var(--border, #1f2937); border-left: 3px solid var(--primary, #3b82f6); border-radius: 5px; padding: 6px 8px; font-size: 11px; display: flex; flex-direction: column; gap: 3px; }
  .ev-box.fail { border-left-color: var(--destructive, #ef4444); }
  .ev-box.warn { border-left-color: var(--warning, #f59e0b); }
  .links-row { display: flex; gap: 8px; flex-wrap: wrap; font-size: 10px; align-items: center; }
  .ext-link { color: var(--primary, #60a5fa); text-decoration: none; font-family: var(--font-mono, monospace); }
  .ext-link:hover { text-decoration: underline; }
  .trace-card { background: var(--background, #090d16); border: 1px solid var(--border, #1f2937); border-radius: 6px; padding: 7px 9px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
  .trace-card:hover, .trace-card.active { border-color: var(--primary, #3b82f6); }
  .trace-note { font-size: 10px; color: var(--muted-foreground, #94a3b8); }

  .table-wrap { background: var(--card, #0f1623); border: 1px solid var(--border, #1f2937); border-radius: var(--radius, 10px); padding: 12px 14px; overflow-x: auto; }
  table.data-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.data-tbl th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground, #94a3b8); padding: 6px 8px; border-bottom: 1px solid var(--border, #1f2937); }
  table.data-tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border, #172030); vertical-align: top; color: var(--foreground, #e2e8f0); }
  .badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; font-family: var(--font-mono, monospace); flex-shrink: 0; }
  .b-fail { background: rgba(239,68,68,0.18); color: #fca5a5; }
  .b-warn { background: rgba(245,158,11,0.18); color: #fcd34d; }
  .b-pass { background: rgba(16,185,129,0.18); color: #6ee7b7; }
  .b-na { background: rgba(148,163,184,0.14); color: #94a3b8; }
  .b-info { background: rgba(59,130,246,0.18); color: #93c5fd; }
  .b-purple { background: rgba(139,92,246,0.2); color: #c4b5fd; }
  .b-cyan { background: rgba(6,182,212,0.18); color: #67e8f9; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .story-box { background: rgba(30, 41, 59, 0.45); border: 1px solid var(--border, #1f2937); border-left: 3px solid var(--primary, #3b82f6); border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #cbd5e1; line-height: 1.5; }
  .crumb-sep { color: #64748b; font-size: 11px; margin: 0 2px; }
  .api-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(51, 65, 85, 0.35); font-size: 11px; }
  .action-btn { background: var(--primary, #2563eb); color: #ffffff; border: 0; border-radius: 5px; padding: 4px 9px; font-size: 11px; font-weight: 600; cursor: pointer; }
  .action-btn.sec-btn { background: var(--secondary, #1e293b); color: var(--foreground, #e2e8f0); border: 1px solid var(--border, #334155); }
</style>
</head>
<body>
<div class="app" id="app"></div>
<script id="repospec-data" type="application/json">${embeddedJson}</script>
<script>
(() => {
  const DATA = JSON.parse(document.getElementById("repospec-data").textContent);
  const INLINE = ${inline ? "true" : "false"};

  const nodeById = new Map(DATA.nodes.map((n) => [n.id, n]));
  const diagById = new Map(DATA.diagrams.map((d) => [d.id, d]));
  const invById = new Map(DATA.invariants.map((i) => [i.id, i]));
  const moduleById = new Map((DATA.modules || []).map((m) => [m.id, m]));
  const layerDiagByOwner = new Map();
  const moduleDiagByOwner = new Map();
  for (const d of DATA.diagrams) {
    if (d.category === "layers" && d.ownerId) layerDiagByOwner.set(d.ownerId, d);
    if (d.category === "modules" && d.ownerId) moduleDiagByOwner.set(d.ownerId, d);
  }
  const moduleDiags = DATA.diagrams.filter((d) => d.category === "modules");
  const behaviorDiags = DATA.diagrams.filter((d) => d.category === "behavior");
  const deliveryDiag = DATA.diagrams.find((d) => d.category === "delivery") || null;
  const runtimeDiag = DATA.diagrams.find((d) => d.category === "runtime") || DATA.diagrams[0] || null;
  const packagesDiag = DATA.diagrams.find((d) => d.category === "packages") || null;
  const domainsDiag = DATA.diagrams.find((d) => d.category === "domains") || null;

  const nonTestUnits = DATA.nodes.filter((n) => n.kind === "app" || n.kind === "package" || n.kind === "native_app");
  const isSingleUnitAtlas = nonTestUnits.length <= 1 && moduleDiags.length >= 1;
  const isLibraryDefault =
    !isSingleUnitAtlas &&
    behaviorDiags.length > 0 &&
    DATA.entities.length === 0 &&
    DATA.nodes.filter((n) => n.kind === "app").length <= 1;

  const state = {
    tab: isLibraryDefault ? "behavior" : "map",
    mapMode: "runtime",
    viewMode: "flow",
    showAllEdges: false,
    activeLayerDiagId: isSingleUnitAtlas ? moduleDiags[0].id : null,
    activeBehaviorId: behaviorDiags[0]?.id || null,
    selectedNodeId: null,
    selectedEdgeId: null,
    focusMode: false,
    activeTraceId: null,
    dataFilter: "",
    dataSubtab: "entities",
    checksFilter: "active",
    search: "",
    tx: 0,
    ty: 0,
    scale: 1,
    fittedDiagId: null,
  };

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
    return '<span class="mono muted">' + label + '</span>';
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

  function renderFindingDisclosure(inv, opts) {
    const matchingEv = opts.filterEv ? inv.evidence.filter(opts.filterEv) : inv.evidence;
    const shownEv = (matchingEv.length > 0 ? matchingEv : inv.evidence).slice(0, 6);
    const hasAnchor = Boolean(shownEv.some((e) => e.anchors && e.anchors.length > 0) || inv.evidence.some((e) => e.anchors && e.anchors.length > 0));
    const tone = inv.status === "fail" ? "fail" : inv.status === "warn" ? "warn" : "pass";
    const evRows = shownEv.map((ev) =>
      '<div class="ev-item"><div>' + esc(ev.detail) + "</div>" + provenanceLinksHtml(ev.file, ev.line) + "</div>"
    ).join("");
    const bodyHtml =
      '<div class="muted">' + esc(inv.statement) + "</div>" +
      evRows +
      (inv.fix ? '<div class="fix-note"><strong>Fix:</strong> ' + esc(inv.fix) + "</div>" : "") +
      '<div class="links-row">' +
      (hasAnchor ? '<button class="tbtn" data-show-inv="' + esc(inv.id) + '">Highlight on map</button>' : "") +
      '<button class="tbtn" data-jump-checks="1">Open in Checks</button>' +
      "</div>";
    return renderDisclosure({
      title: inv.name,
      meta: inv.id + " · " + inv.rung,
      badge: opts.countOverride !== undefined ? opts.countOverride : inv.violationCount,
      badgeClass: tone === "fail" ? "b-fail" : tone === "warn" ? "b-warn" : "b-pass",
      tone,
      open: Boolean(opts.open),
      bodyHtml,
    });
  }

  function activeDiagram() {
    if (state.tab === "behavior") {
      return diagById.get(state.activeBehaviorId) || behaviorDiags[0] || null;
    }
    if (state.tab === "delivery") return deliveryDiag;
    if (state.tab === "map") {
      if (state.activeLayerDiagId && diagById.has(state.activeLayerDiagId)) {
        return diagById.get(state.activeLayerDiagId);
      }
      if (state.mapMode === "packages" && packagesDiag) return packagesDiag;
      if (state.mapMode === "domains" && domainsDiag) return domainsDiag;
      return runtimeDiag;
    }
    return null;
  }

  function supportsMatrix(diag) {
    return Boolean(diag && diag.nodes.length >= 3 && ["modules", "subsystem", "layers", "domains", "packages", "runtime"].includes(diag.category));
  }

  function buildBowTieLayout(diag, centerId) {
    const center = diag.nodes.find((n) => n.id === centerId);
    if (!center) return diag;
    const inEdges = diag.edges.filter((e) => e.to === centerId);
    const outEdges = diag.edges.filter((e) => e.from === centerId);
    const leftNodes = [];
    const rightNodes = [];
    const seenL = new Set();
    const seenR = new Set();
    for (const e of inEdges) {
      if (!seenL.has(e.from)) {
        seenL.add(e.from);
        const n = diag.nodes.find((x) => x.id === e.from);
        if (n) leftNodes.push(n);
      }
    }
    for (const e of outEdges) {
      if (!seenR.has(e.to)) {
        seenR.add(e.to);
        const n = diag.nodes.find((x) => x.id === e.to);
        if (n) rightNodes.push(n);
      }
    }
    const maxPerSide = 8;
    const keptL = leftNodes.slice(0, maxPerSide);
    const keptR = rightNodes.slice(0, maxPerSide);
    const folded = Math.max(0, leftNodes.length - keptL.length) + Math.max(0, rightNodes.length - keptR.length);

    const colX = [148, 430, 712];
    const rowGap = 68;
    const maxRows = Math.max(1, keptL.length, keptR.length);
    const height = Math.max(240, maxRows * rowGap + 74);
    const midY = height / 2;

    const nodes = [];
    const pos = new Map();
    const placeCol = (arr, x) => {
      const startY = midY - ((arr.length - 1) * rowGap) / 2;
      arr.forEach((n, i) => {
        const copy = { ...n, x, y: startY + i * rowGap };
        nodes.push(copy);
        pos.set(copy.id, copy);
      });
    };
    placeCol(keptL, colX[0]);
    const centerCopy = { ...center, x: colX[1], y: midY };
    nodes.push(centerCopy);
    pos.set(centerCopy.id, centerCopy);
    placeCol(keptR, colX[2]);

    const edges = [];
    for (const e of [...inEdges, ...outEdges]) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const sx = a.x < b.x ? a.x + a.w / 2 : a.x - a.w / 2;
      const tx = a.x < b.x ? b.x - b.w / 2 : b.x + b.w / 2;
      const dx = (tx - sx) * 0.45;
      edges.push({
        ...e,
        tier: e.violation ? "violation" : "spine",
        points: [
          { x: sx, y: a.y },
          { x: sx + dx, y: a.y },
          { x: tx - dx, y: b.y },
          { x: tx, y: b.y },
        ],
      });
    }

    return {
      ...diag,
      title: "Focus — " + center.label,
      subtitle: "Bow-tie 1-hop neighborhood (callers left, dependencies right). Press F or Esc to exit Focus.",
      width: 870,
      height,
      lanes: [
        { id: "upstream", label: "Upstream / Callers", x: 20, y: 20, w: 256, h: height - 40 },
        { id: "selected", label: "Selected", x: 302, y: 20, w: 256, h: height - 40 },
        { id: "downstream", label: "Downstream / Deps", x: 584, y: 20, w: 256, h: height - 40 },
      ],
      foldedCount: folded,
      nodes,
      edges,
    };
  }

  function statusHue(findings, violation) {
    if (violation) return "#ef4444";
    if (!findings || findings.length === 0) return null;
    if (findings.some((f) => f.severity === "error")) return "#ef4444";
    if (findings.some((f) => f.severity === "warn")) return "#f59e0b";
    return null;
  }

  function renderShapeSvg(n, strokeColor) {
    const x = n.x - n.w / 2;
    const y = n.y - n.h / 2;
    const fill = "#111827";
    if (n.shape === "db") {
      const ry = 6;
      return (
        '<path class="node-shape" d="M ' + x + " " + (y + ry) +
        " A " + n.w / 2 + " " + ry + " 0 0 1 " + (x + n.w) + " " + (y + ry) +
        " L " + (x + n.w) + " " + (y + n.h - ry) +
        " A " + n.w / 2 + " " + ry + " 0 0 1 " + x + " " + (y + n.h - ry) +
        ' Z" fill="' + fill + '" stroke="' + strokeColor + '" stroke-width="1.6" />' +
        '<ellipse cx="' + n.x + '" cy="' + (y + ry) + '" rx="' + n.w / 2 + '" ry="' + ry +
        '" fill="none" stroke="' + strokeColor + '" stroke-width="1.2" opacity="0.6" />'
      );
    }
    if (n.shape === "hex") {
      const cut = 11;
      const pts = [
        [x + cut, y],
        [x + n.w - cut, y],
        [x + n.w, n.y],
        [x + n.w - cut, y + n.h],
        [x + cut, y + n.h],
        [x, n.y],
      ].map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
      return '<polygon class="node-shape" points="' + pts + '" fill="' + fill + '" stroke="' + strokeColor + '" stroke-width="1.6" />';
    }
    const rx = n.shape === "pill" ? Math.round(n.h / 2) : 7;
    return '<rect class="node-shape" x="' + x + '" y="' + y + '" width="' + n.w + '" height="' + n.h + '" rx="' + rx + '" fill="' + fill + '" stroke="' + strokeColor + '" stroke-width="1.6" />';
  }

  function buildRoundedPolylinePath(pts) {
    let d = "M " + pts[0].x + " " + pts[0].y;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      const dx1 = cur.x - prev.x;
      const dy1 = cur.y - prev.y;
      const dx2 = next.x - cur.x;
      const dy2 = next.y - cur.y;
      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      const r = Math.min(10, len1 / 2, len2 / 2);
      if (r < 1) {
        d += " L " + cur.x + " " + cur.y;
      } else {
        const p1x = (cur.x - (dx1 / len1) * r).toFixed(1);
        const p1y = (cur.y - (dy1 / len1) * r).toFixed(1);
        const p2x = (cur.x + (dx2 / len2) * r).toFixed(1);
        const p2y = (cur.y + (dy2 / len2) * r).toFixed(1);
        d += " L " + p1x + " " + p1y + " Q " + cur.x + " " + cur.y + " " + p2x + " " + p2y;
      }
    }
    const last = pts[pts.length - 1];
    d += " L " + last.x + " " + last.y;
    return d;
  }

  function renderDiagramSvg(diag) {
    const activeTrace = state.activeTraceId ? DATA.traces.find((t) => t.id === state.activeTraceId && t.diagramId === diag.id) : null;
    const traceNodeSet = new Set(activeTrace ? activeTrace.steps.map((s) => s.nodeId) : []);
    const traceEdgeSet = new Set(activeTrace ? activeTrace.steps.map((s) => s.edgeId).filter(Boolean) : []);
    const traceOrder = new Map(activeTrace ? activeTrace.steps.map((s, i) => [s.nodeId, i + 1]) : []);

    const neighborNodes = new Set();
    const neighborEdges = new Set();
    if (state.selectedNodeId) {
      neighborNodes.add(state.selectedNodeId);
      for (const e of diag.edges) {
        if (e.from === state.selectedNodeId || e.to === state.selectedNodeId) {
          neighborEdges.add(e.id);
          neighborNodes.add(e.from);
          neighborNodes.add(e.to);
        }
      }
    } else if (state.selectedEdgeId) {
      const e = diag.edges.find((x) => x.id === state.selectedEdgeId);
      if (e) {
        neighborEdges.add(e.id);
        neighborNodes.add(e.from);
        neighborNodes.add(e.to);
      }
    }
    const hasFilter = Boolean(state.selectedNodeId || state.selectedEdgeId || activeTrace);

    const lanesSvg = (diag.lanes || []).map((l) => {
      const dash = l.lateral ? ' stroke-dasharray="4 4"' : "";
      const fill = l.lateral ? "rgba(99,102,241,0.045)" : "rgba(148,163,184,0.035)";
      const labelSuffix = l.lateral ? " (HOVER ANY NODE TO TRACE IMPORTS)" : "";
      return (
        '<g class="lane">' +
        '<rect x="' + l.x + '" y="' + l.y + '" width="' + l.w + '" height="' + l.h + '" rx="8" fill="' + fill + '" stroke="#1e293b" stroke-width="1"' + dash + " />" +
        '<text x="' + (l.x + 12) + '" y="' + (l.y + 19) + '" font-size="10" font-weight="700" fill="#94a3b8" letter-spacing="0.06em">' + esc(l.label.toUpperCase() + labelSuffix) + "</text>" +
        "</g>"
      );
    }).join("");

    const edgesSvg = diag.edges.map((e) => {
      if (!e.points || e.points.length < 2) return "";
      const p0 = e.points[0];
      let d = "M " + p0.x + " " + p0.y;
      if (e.points.length === 4) {
        d += " C " + e.points[1].x + " " + e.points[1].y + ", " + e.points[2].x + " " + e.points[2].y + ", " + e.points[3].x + " " + e.points[3].y;
      } else if (e.points.length === 3) {
        d += " Q " + e.points[1].x + " " + e.points[1].y + " " + e.points[2].x + " " + e.points[2].y;
      } else if (e.points.length >= 5) {
        d = buildRoundedPolylinePath(e.points);
      } else {
        for (let i = 1; i < e.points.length; i += 1) {
          d += " L " + e.points[i].x + " " + e.points[i].y;
        }
      }
      const isSelected = state.selectedEdgeId === e.id;
      const isTrace = traceEdgeSet.has(e.id);
      const isNeighbor = neighborEdges.has(e.id);
      const hideDetail = !state.showAllEdges && e.tier === "detail" && !e.violation && !isSelected && !isNeighbor && !isTrace;
      const dimmed = hasFilter && !(isTrace || isNeighbor);
      const isOutSel = state.selectedNodeId && e.from === state.selectedNodeId;
      const isInSel = state.selectedNodeId && e.to === state.selectedNodeId;
      const stroke = isTrace ? "#3b82f6" : e.violation ? "#ef4444" : isOutSel ? "#38bdf8" : isInSel ? "#34d399" : "#64748b";
      const dash = e.confidence === "inferred" ? ' stroke-dasharray="4 4"' : "";
      const sw = e.violation ? 2.4 : isOutSel || isInSel ? 2.2 : (e.weight || 1) >= 25 ? 2.4 : (e.weight || 1) >= 5 ? 1.8 : 1.3;
      const markerEnd = isTrace ? "url(#m-blue)" : e.violation ? "url(#m-red)" : isOutSel ? "url(#m-cyan)" : isInSel ? "url(#m-green)" : "url(#m-neutral)";
      const markerStart = e.bidirectional ? (e.violation ? "url(#m-red-s)" : "url(#m-neutral-s)") : "";
      const showLabel = diag.category === "behavior" || e.bidirectional || e.violation;
      const mid = e.points.length === 4
        ? { x: (e.points[1].x + e.points[2].x) / 2, y: (e.points[1].y + e.points[2].y) / 2 }
        : e.points[Math.floor(e.points.length / 2)];
      const lblHtml = showLabel && e.label
        ? '<text x="' + mid.x.toFixed(1) + '" y="' + (mid.y - 6).toFixed(1) + '" text-anchor="middle" font-size="10" fill="' + (e.violation ? "#fca5a5" : "#cbd5e1") + '" font-family="ui-monospace, monospace">' + esc(e.label) + "</text>"
        : "";
      const cls =
        "svg-edge-group" +
        (isSelected ? " selected" : "") +
        (dimmed ? " dimmed" : "") +
        (hideDetail ? " edge-detail-hidden" : "");
      return (
        '<g class="' + cls + '" data-edge="' + esc(e.id) + '" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" data-viol="' + (e.violation ? "1" : "0") + '">' +
        '<path class="svg-edge-hit" d="' + d + '" />' +
        '<path class="svg-edge-vis" d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + ' marker-end="' + markerEnd + '"' + (markerStart ? ' marker-start="' + markerStart + '"' : "") + " />" +
        lblHtml +
        "</g>"
      );
    }).join("");

    const nodesSvg = diag.nodes.map((n) => {
      const isSel = state.selectedNodeId === n.id;
      const isTrace = traceNodeSet.has(n.id);
      const dimmed = hasFilter && !(isTrace || neighborNodes.has(n.id));
      const hue = statusHue(n.findings, false);
      const stroke = isSel || isTrace ? "#3b82f6" : hue || "#475569";
      const cls = "svg-node" + (isSel ? " selected" : "") + (dimmed ? " dimmed" : "");
      const totalFindings = (n.findings || []).reduce((s, f) => s + f.count, 0);
      const hasError = (n.findings || []).some((f) => f.severity === "error");
      const badgeSvg = totalFindings > 0
        ? '<circle cx="' + (n.x + n.w / 2 - 4) + '" cy="' + (n.y - n.h / 2 + 4) + '" r="9" fill="' + (hasError ? "#ef4444" : "#f59e0b") + '" />' +
          '<text x="' + (n.x + n.w / 2 - 4) + '" y="' + (n.y - n.h / 2 + 7.5) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">' + (totalFindings > 99 ? "99+" : totalFindings) + "</text>"
        : "";
      const stepNum = traceOrder.get(n.id);
      const traceBadge = stepNum
        ? '<circle cx="' + (n.x - n.w / 2 + 4) + '" cy="' + (n.y - n.h / 2 + 4) + '" r="9" fill="#2563eb" />' +
          '<text x="' + (n.x - n.w / 2 + 4) + '" y="' + (n.y - n.h / 2 + 7.5) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">' + stepNum + "</text>"
        : "";
      const subText = n.ambientBadges && n.ambientBadges.length > 0
        ? (n.sublabel || "") + " · ◉ " + n.ambientBadges[0]
        : (n.sublabel || "");
      return (
        '<g class="' + cls + '" tabindex="0" role="button" aria-label="' + esc(n.label) + '" data-node="' + esc(n.id) + '">' +
        renderShapeSvg(n, stroke) +
        '<text x="' + n.x + '" y="' + (n.y - (subText ? 4 : -4)) + '" text-anchor="middle" font-size="11.5" font-weight="600" fill="#f8fafc" font-family="ui-monospace, monospace">' + esc(n.label) + "</text>" +
        (subText ? '<text x="' + n.x + '" y="' + (n.y + 12) + '" text-anchor="middle" font-size="9.5" fill="#94a3b8" font-family="ui-monospace, monospace">' + esc(subText.slice(0, 42)) + "</text>" : "") +
        badgeSvg +
        traceBadge +
        "</g>"
      );
    }).join("");

    return (
      '<svg id="diagram-svg" viewBox="0 0 ' + diag.width + " " + diag.height + '" preserveAspectRatio="xMidYMid meet">' +
      "<defs>" +
      '<marker id="m-neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#64748b" /></marker>' +
      '<marker id="m-neutral-s" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 9 1.5 L 0 5 L 9 8.5 z" fill="#64748b" /></marker>' +
      '<marker id="m-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#ef4444" /></marker>' +
      '<marker id="m-red-s" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M 9 1.5 L 0 5 L 9 8.5 z" fill="#ef4444" /></marker>' +
      '<marker id="m-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#3b82f6" /></marker>' +
      '<marker id="m-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8" /></marker>' +
      '<marker id="m-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#34d399" /></marker>' +
      "</defs>" +
      '<g id="viewport-g" transform="translate(' + state.tx + "," + state.ty + ") scale(" + state.scale + ')">' +
      lanesSvg +
      edgesSvg +
      nodesSvg +
      "</g></svg>"
    );
  }

  function renderMatrixView(diag) {
    const laneIdx = new Map((diag.lanes || []).map((l, i) => [l.id, i]));
    const laneColors = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f472b6", "#94a3b8"];
    const ordered = [...diag.nodes].sort((a, b) => {
      const ra = a.layerRank !== undefined ? a.layerRank : (laneIdx.get(a.lane || "") ?? 99);
      const rb = b.layerRank !== undefined ? b.layerRank : (laneIdx.get(b.lane || "") ?? 99);
      return ra - rb || a.label.localeCompare(b.label);
    });

    const edgeByPair = new Map();
    let maxWeight = 1;
    for (const e of diag.edges) {
      edgeByPair.set(e.from + "|" + e.to, e);
      if (e.bidirectional) edgeByPair.set(e.to + "|" + e.from, e);
      if ((e.weight || 1) > maxWeight) maxWeight = e.weight || 1;
    }

    const headCols = ordered.map((n, ci) =>
      '<th class="dsm-col-th" data-dsm-col="' + ci + '" data-select-node="' + esc(n.id) + '" title="' + esc(n.label) + '">' +
      '<div class="dsm-col-lbl">' + esc(n.label) + "</div></th>"
    ).join("");

    const rowsHtml = ordered.map((rowNode, ri) => {
      const lColor = laneColors[(laneIdx.get(rowNode.lane || "") ?? 5) % laneColors.length];
      const cells = ordered.map((colNode, ci) => {
        if (ri === ci) return '<td class="dsm-cell diag">·</td>';
        const e = edgeByPair.get(rowNode.id + "|" + colNode.id);
        if (!e) return '<td class="dsm-cell"></td>';
        const w = e.weight || 1;
        const alpha = (0.18 + Math.min(0.65, (Math.log(w + 1) / Math.log(maxWeight + 1)) * 0.65)).toFixed(2);
        const bg = e.violation ? "" : ' style="background:rgba(56,189,248,' + alpha + ')"';
        const cls = "dsm-cell " + (e.violation ? "viol" : "hit") + (state.selectedEdgeId === e.id ? " sel" : "");
        const tip = rowNode.label + " → " + colNode.label + " · " + w + (e.violation ? " · VIOLATION" : "");
        return '<td class="' + cls + '"' + bg + ' data-edge="' + esc(e.id) + '" data-dsm-r="' + ri + '" data-dsm-c="' + ci + '" title="' + esc(tip) + '">' + (w > 99 ? "99+" : w) + "</td>";
      }).join("");
      return (
        "<tr>" +
        '<th class="dsm-row-th" data-dsm-row="' + ri + '" data-select-node="' + esc(rowNode.id) + '">' +
        '<span class="dsm-lane-dot" style="background:' + lColor + '"></span>' + esc(rowNode.label) +
        "</th>" +
        cells +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="dsm-wrap">' +
      '<div class="dsm-note">' +
      '<span><strong>Design Structure Matrix (Row → Column)</strong> · ' + ordered.length + " nodes · " + diag.edges.length + " dependencies · 0 edge crossings</span>" +
      '<span>Click any cell for file:line evidence · <span style="color:#fca5a5">Red cells</span> = rule violation / cycle</span>' +
      "</div>" +
      '<table class="dsm-table"><thead><tr><th class="dsm-corner">FROM ↓ / TO →</th>' + headCols + "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table></div>"
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
    if (diag.edges.some((e) => e.confidence === "observed")) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#64748b"></span>Spine edge</span>');
    }
    if (diag.edges.some((e) => e.confidence === "inferred")) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="border-top:2px dashed #64748b;height:0"></span>Inferred</span>');
    }
    if (diag.edges.some((e) => e.violation)) {
      items.push('<span class="leg-item"><span class="leg-swatch" style="background:#ef4444"></span>Violation</span>');
    }
    items.push('<span class="leg-item"><span class="leg-swatch" style="background:#38bdf8"></span>Hover outgoing</span>');
    items.push('<span class="leg-item"><span class="leg-swatch" style="background:#34d399"></span>Hover incoming</span>');
    if (detailCount > 0 && !state.showAllEdges) {
      items.push('<span class="leg-item">+' + detailCount + " detail wires on hover / Matrix</span>");
    }
    if (diag.foldedCount && diag.foldedCount > 0) {
      items.push('<span class="leg-item">+' + diag.foldedCount + " folded</span>");
    }
    return '<div class="legend">' + items.join("") + "</div>";
  }

  function capBadgeClass(cap) {
    if (cap === "DB") return "b-purple";
    if (cap === "HTTP") return "b-cyan";
    if (cap === "FS") return "b-warn";
    if (cap === "PROC") return "b-fail";
    if (cap === "ENV") return "b-info";
    return "b-pass";
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

  function renderBriefingDrawer() {
    const apps = DATA.nodes.filter((n) => n.kind === "app" || n.kind === "native_app");
    const pkgs = DATA.nodes.filter((n) => n.kind === "package" || n.kind === "analyzer");
    const stores = DATA.nodes.filter((n) => n.kind === "datastore");
    const exts = DATA.nodes.filter((n) => n.kind === "external_service");
    const activeInvs = DATA.invariants.filter((i) => i.status === "fail" || i.status === "warn");

    const storyHtml = buildArchitectureStory();
    const shapeLine =
      isLibraryDefault
        ? "A " + DATA.repo.ecosystem + " library (" + pkgs.map((p) => esc(shortPkg(p.label))).join(", ") + ") with " + DATA.stateMachines.length + " declared state machine(s)."
        : "A " + DATA.repo.ecosystem + " system with " + apps.length + " app/binary unit(s), " + pkgs.length + " package(s), " + (DATA.modules || []).length + " indexed modules, and " + DATA.summary.indexedSourceFiles + " source files.";

    const findingsHtml =
      '<div class="sec"><div class="sec-title"><span>Needs Attention (' + activeInvs.length + ')</span><span class="muted">click to expand</span></div>' +
      (activeInvs.length === 0
        ? '<div class="muted" style="font-size:12px">All applicable SQL invariants pass.</div>'
        : activeInvs.slice(0, 8).map((inv, i) =>
            renderFindingDisclosure(inv, { open: i === 0 && inv.status === "fail" })
          ).join("")) +
      "</div>";

    const traceHtml = DATA.traces.length > 0
      ? '<div class="sec"><div class="sec-title">Static Paths (click to trace)</div>' +
        DATA.traces.map((t) => {
          const active = state.activeTraceId === t.id ? " active" : "";
          return '<div class="trace-card' + active + '" data-trace="' + esc(t.id) + '">' +
            '<div style="font-weight:600;font-size:12px">' + esc(t.title) + " (" + t.steps.length + " steps)</div>" +
            '<div class="trace-note">' + esc(t.disclaimer) + "</div></div>";
        }).join("") +
        "</div>"
      : "";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">Architecture Briefing</div><div class="drawer-sub">' + esc(DATA.repo.name) + " · " + esc(DATA.repo.languages.join(", ")) + "</div></div></div>" +
      (storyHtml || '<div style="font-size:12px;color:#cbd5e1">' + shapeLine + "</div>") +
      findingsHtml +
      traceHtml +
      '<div class="sec"><div class="sec-title">System Makeup</div>' +
      (apps.length > 0 ? '<div class="row"><span class="muted">Entry / Apps</span><span class="mono">' + esc(apps.slice(0, 4).map((a) => shortPkg(a.label)).join(", ")) + (apps.length > 4 ? " +" + (apps.length - 4) : "") + "</span></div>" : "") +
      (pkgs.length > 0 ? '<div class="row"><span class="muted">Libraries</span><span class="mono">' + esc(pkgs.slice(0, 4).map((p) => shortPkg(p.label)).join(", ")) + (pkgs.length > 4 ? " +" + (pkgs.length - 4) : "") + "</span></div>" : "") +
      (stores.length > 0 ? '<div class="row"><span class="muted">State</span><span class="mono">' + esc(stores.map((s) => s.label).join(", ")) + " (" + DATA.summary.datastoreEntities + ")</span></div>" : "") +
      (exts.length > 0 ? '<div class="row"><span class="muted">External</span><span class="mono">' + esc(exts.slice(0, 5).map((x) => x.label).join(", ")) + (exts.length > 5 ? " +" + (exts.length - 5) : "") + "</span></div>" : "") +
      (DATA.summary.govRules > 0 ? '<div class="row"><span class="muted">Gov Rules</span><span class="mono">' + DATA.summary.govRules + " scoped rules</span></div>" : "") +
      "</div>"
    );
  }

  function renderModuleInspector(modId) {
    const mod = moduleById.get(modId);
    const diag = activeDiagram();
    if (!mod) {
      const diagNode = diag?.nodes.find((n) => n.id === modId);
      if (!diagNode) return renderBriefingDrawer();
      const inEdges = (diag?.edges || []).filter((e) => e.to === modId);
      const outEdges = (diag?.edges || []).filter((e) => e.from === modId);
      const nameOf = (id) => diag?.nodes.find((x) => x.id === id)?.label || id;
      return (
        '<div class="drawer-head"><div><div class="drawer-title">' + esc(diagNode.label) + '</div><div class="drawer-sub">' + esc(diagNode.sublabel || "submodule") + "</div></div></div>" +
        provenanceLinksHtml(diagNode.provenance?.file, diagNode.provenance?.line) +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + '</button><button class="action-btn sec-btn" data-clear-sel="1">Briefing</button></div>' +
        '<div class="sec"><div class="sec-title">Control & Data Flow</div>' +
        outEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.to) + '">→ ' + esc(nameOf(e.to)) + '</span><span class="muted mono">' + (e.weight || 1) + "</span></div>").join("") +
        inEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.from) + '">← ' + esc(nameOf(e.from)) + '</span><span class="muted mono">' + (e.weight || 1) + "</span></div>").join("") +
        "</div>"
      );
    }

    const subDiagId = "subsystem:" + mod.unitSlug + ":" + mod.name;
    const subDiag = mod.hasSubsystemDiagram ? diagById.get(subDiagId) : null;
    const modDiag = diagById.get("modules:" + mod.unitSlug) || diag;
    const outEdges = (modDiag?.edges || []).filter((e) => e.from === mod.id);
    const inEdges = (modDiag?.edges || []).filter((e) => e.to === mod.id);
    const labelOf = (id) => {
      const m = moduleById.get(id);
      return m ? (m.kind === "directory" ? m.name + "/" : m.name) : id;
    };

    const depthRatio = mod.exportCount > 0 ? Math.round(mod.lines / mod.exportCount) : mod.lines;
    const depthBadgeCls = mod.depth === "deep" ? "b-pass" : mod.depth === "contract" ? "b-purple" : mod.depth === "shallow" ? "b-warn" : "b-info";
    const roleBadgeCls = mod.role === "entry" ? "b-cyan" : mod.role === "foundation" ? "b-purple" : mod.role === "adapter" ? "b-warn" : "b-info";

    const pillsHtml =
      '<div class="pill-row">' +
      '<span class="badge ' + roleBadgeCls + '">' + esc(mod.role) + " · L" + mod.level + "</span>" +
      '<span class="badge ' + depthBadgeCls + '">' + esc(mod.depth) + " (" + mod.lines + "L / " + mod.exportCount + " exp)</span>" +
      mod.capabilities.map((c) => '<span class="badge ' + capBadgeClass(c) + '">' + esc(c) + "</span>").join("") +
      (mod.inTangle ? '<span class="badge b-fail">⚠ ' + esc(mod.tangleId || "cycle") + "</span>" : "") +
      "</div>";

    const actions = [
      subDiag ? '<button class="action-btn" data-open-layers="' + esc(subDiag.id) + '">Drill into ' + esc(mod.name) + "/ (" + subDiag.nodes.length + ")</button>" : "",
      '<button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + "</button>",
      '<button class="action-btn sec-btn" data-clear-sel="1">Briefing</button>',
    ].filter(Boolean).join(" ");

    const apiSec =
      '<div class="sec"><div class="sec-title"><span>Public API Surface (' + mod.exportCount + ')</span><span class="muted">' + depthRatio + "L/exp</span></div>" +
      (mod.topExports.length === 0
        ? '<div class="muted" style="font-size:11px">No public symbols exported (entry script or internal helper).</div>'
        : mod.topExports.map((sym) => {
            const gh = githubUrl(sym.file, sym.line);
            const loc = gh
              ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">:' + sym.line + " ↗</a>"
              : '<span class="mono muted">:' + sym.line + "</span>";
            return '<div class="api-row"><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sym.name) + '</span><span style="display:flex;gap:5px;align-items:center;flex-shrink:0"><span class="badge b-na">' + esc(sym.kind) + "</span>" + loc + "</span></div>";
          }).join("")) +
      "</div>";

    const flowSec =
      '<div class="sec"><div class="sec-title"><span>Dependencies</span><span class="muted">in ' + mod.fanIn + " · out " + mod.fanOut + "</span></div>" +
      (inEdges.length > 0
        ? renderDisclosure({
            title: "Upstream Callers (←)",
            badge: inEdges.length,
            badgeClass: "b-pass",
            tone: "pass",
            open: inEdges.length <= 6,
            bodyHtml: inEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.from) + '">← ' + esc(labelOf(e.from)) + '</span><span class="muted mono">' + (e.weight || 1) + "</span></div>").join(""),
          })
        : "") +
      (outEdges.length > 0
        ? renderDisclosure({
            title: "Downstream Imports (→)",
            badge: outEdges.length,
            badgeClass: outEdges.some((e) => e.violation) ? "b-fail" : "b-info",
            tone: outEdges.some((e) => e.violation) ? "fail" : "info",
            open: outEdges.length <= 8,
            bodyHtml: outEdges.map((e) => '<div class="row"><span class="row-link mono" data-select-node="' + esc(e.to) + '">→ ' + esc(labelOf(e.to)) + "</span>" + (e.violation ? '<span class="badge b-fail">cycle</span>' : '<span class="muted mono">' + (e.weight || 1) + "</span>") + "</div>").join(""),
          })
        : "") +
      (inEdges.length === 0 && outEdges.length === 0 ? '<div class="muted" style="font-size:11px">Standalone module (0 internal edges).</div>' : "") +
      "</div>";

    const filesSec =
      '<div class="sec"><div class="sec-title"><span>Files (' + mod.fileCount + ')</span><span class="muted">' + mod.lines + " lines</span></div>" +
      renderDisclosure({
        title: mod.fileCount === 1 ? mod.files[0]?.file || mod.relPath : mod.fileCount + " source files in " + mod.name + "/",
        badge: mod.lines + "L",
        badgeClass: "b-na",
        open: mod.fileCount <= 6,
        bodyHtml: mod.files.map((f) => {
          const gh = githubUrl(f.file, 1);
          const nameHtml = gh
            ? '<a class="ext-link" href="' + esc(gh) + '" target="_blank" rel="noopener">' + esc(f.file) + " ↗</a>"
            : '<span class="mono">' + esc(f.file) + "</span>";
          const io = f.capabilities.filter((c) => c !== "PURE").join(",");
          return '<div class="row">' + nameHtml + '<span class="mono muted">' + f.lines + "L" + (io ? " · " + esc(io) : "") + "</span></div>";
        }).join(""),
      }) +
      "</div>";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(mod.kind === "directory" ? mod.name + "/" : mod.name) + '</div><div class="drawer-sub">' + esc(mod.unitSlug + " · " + mod.language + " · " + mod.relPath) + "</div></div></div>" +
      pillsHtml +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + actions + "</div>" +
      apiSec +
      flowSec +
      filesSec
    );
  }

  function groupEdgesForInspector(edges, dir) {
    const groups = new Map();
    const labelMap = {
      calls_external: dir === "out" ? "Calls External Services" : "Called By",
      reads_writes: dir === "out" ? "Reads / Writes Datastore" : "Accessed By",
      depends_on: dir === "out" ? "Depends On Units" : "Depended On By",
      imports_layer: dir === "out" ? "Imports Layers" : "Imported By Layers",
      imports_domain: dir === "out" ? "Imports Domains" : "Imported By Domains",
      routes_to: dir === "out" ? "Routes To" : "Receives Traffic From",
      verifies: dir === "out" ? "Verifies" : "Verified By CI & Tests",
      deploys: dir === "out" ? "Deploys" : "Deployed By",
      builds_image: dir === "out" ? "Builds Image" : "Built By",
      governs: dir === "out" ? "Governs" : "Governed By Policies",
      analyzes: dir === "out" ? "Analyzes" : "Analyzed By",
    };
    for (const e of edges) {
      if (e.kind === "contains") continue;
      const key = dir + ":" + e.kind;
      const cur = groups.get(key) || { title: labelMap[e.kind] || ((dir === "out" ? "→ " : "← ") + e.kind), kind: e.kind, dir, items: [], hasViol: false };
      cur.items.push(e);
      if (e.violation) cur.hasViol = true;
      groups.set(key, cur);
    }
    return Array.from(groups.values()).sort((a, b) => (b.hasViol ? 1 : 0) - (a.hasViol ? 1 : 0) || b.items.length - a.items.length);
  }

  function renderNodeInspector(nodeId) {
    if (moduleById.has(nodeId) || nodeId.startsWith("mod:") || nodeId.startsWith("sub:")) {
      return renderModuleInspector(nodeId);
    }
    const node = nodeById.get(nodeId);
    if (!node) return renderBriefingDrawer();
    const outEdges = DATA.edges.filter((e) => e.from === nodeId);
    const inEdges = DATA.edges.filter((e) => e.to === nodeId);
    const modDiag = moduleDiagByOwner.get(nodeId);
    const layerDiag = layerDiagByOwner.get(nodeId);
    const unitName = node.label;
    const unitSlug = shortPkg(unitName);
    const unitDir = typeof node.meta?.dir === "string" ? node.meta.dir : "";
    const unitEndpoints = DATA.surfaces.endpoints.filter((ep) => ep.unit === unitName);
    const unitEnvs = DATA.surfaces.envBindings.filter((eb) => eb.units.includes(unitName));
    const unitGovs = DATA.surfaces.govRules.filter((g) => !g.scopePrefix || (unitDir && (unitDir === g.scopePrefix || unitDir.startsWith(g.scopePrefix + "/"))));

    const actions = [
      modDiag ? '<button class="action-btn" data-open-layers="' + esc(modDiag.id) + '">Open Modules (' + modDiag.nodes.length + ")</button>" : "",
      layerDiag ? '<button class="action-btn sec-btn" data-open-layers="' + esc(layerDiag.id) + '">Layers (' + layerDiag.nodes.length + ")</button>" : "",
      '<button class="action-btn sec-btn" data-toggle-focus="1">' + (state.focusMode ? "Exit Focus (F)" : "Focus Bow-Tie (F)") + "</button>",
      '<button class="action-btn sec-btn" data-clear-sel="1">Briefing</button>',
    ].filter(Boolean).join(" ");

    const findingsList = node.findings || [];
    const findingsSec = findingsList.length > 0
      ? '<div class="sec"><div class="sec-title"><span>1. Active Findings (' + findingsList.length + ')</span><span class="muted">expandable</span></div>' +
        findingsList.map((f) => {
          const inv = invById.get(f.ruleId);
          if (!inv) {
            return renderDisclosure({
              title: f.ruleId,
              badge: f.count,
              badgeClass: f.severity === "error" ? "b-fail" : "b-warn",
              tone: f.severity === "error" ? "fail" : "warn",
              open: false,
              bodyHtml: '<div class="muted">Invariant rule ' + esc(f.ruleId) + " reported " + f.count + " hit(s).</div>",
            });
          }
          return renderFindingDisclosure(inv, {
            countOverride: f.count,
            open: f.severity === "error" || findingsList.length <= 2,
            filterEv: (ev) =>
              ev.targetNodeId === nodeId ||
              ev.edgeFromId === nodeId ||
              ev.edgeToId === nodeId ||
              (unitDir && ev.file.startsWith(unitDir + "/")) ||
              ev.subject.includes(unitSlug),
          });
        }).join("") +
        "</div>"
      : "";

    const connGroups = [...groupEdgesForInspector(outEdges, "out"), ...groupEdgesForInspector(inEdges, "in")];
    const connSec =
      '<div class="sec"><div class="sec-title"><span>' + (findingsList.length > 0 ? "2. " : "1. ") + "Connections (" + connGroups.reduce((s, g) => s + g.items.length, 0) + ')</span><span class="muted">grouped</span></div>' +
      (connGroups.length === 0
        ? '<div class="muted" style="font-size:11px">No direct graph connections indexed.</div>'
        : connGroups.map((g, gi) => {
            const rows = g.items
              .sort((a, b) => (b.violation ? 1 : 0) - (a.violation ? 1 : 0) || (b.weight || 1) - (a.weight || 1))
              .slice(0, 25)
              .map((e) => {
                const peerId = g.dir === "out" ? e.to : e.from;
                const peerLabel = shortPkg(nodeById.get(peerId)?.label || peerId);
                const arrow = g.dir === "out" ? "→ " : "← ";
                const extra = e.violation ? '<span class="badge b-fail">violation</span>' : (e.weight && e.weight > 1 ? '<span class="muted mono">' + e.weight + "</span>" : "");
                return '<div class="row"><span class="row-link mono" data-select-node="' + esc(peerId) + '">' + arrow + esc(peerLabel) + "</span>" + extra + "</div>";
              }).join("");
            const more = g.items.length > 25 ? '<div class="muted" style="font-size:10px">+' + (g.items.length - 25) + " more</div>" : "";
            return renderDisclosure({
              title: g.title,
              badge: g.items.length,
              badgeClass: g.hasViol ? "b-fail" : g.kind === "verifies" ? "b-pass" : "b-info",
              tone: g.hasViol ? "fail" : g.kind === "verifies" ? "pass" : "info",
              open: g.hasViol || (gi === 0 && g.items.length <= 8),
              bodyHtml: rows + more,
            });
          }).join("")) +
      "</div>";

    let surfaceItemsHtml = "";
    if (unitEndpoints.length > 0) {
      const byPrefix = new Map();
      for (const ep of unitEndpoints) {
        const segs = ep.path.split("/").filter(Boolean);
        const prefix = segs.length >= 2 && new RegExp("^v\\d+$", "i").test(segs[0]) ? "/" + segs[0] + "/" + segs[1] : (segs[0] ? "/" + segs[0] : "/");
        const list = byPrefix.get(prefix) || [];
        list.push(ep);
        byPrefix.set(prefix, list);
      }
      const prefixGroups = Array.from(byPrefix.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      surfaceItemsHtml += renderDisclosure({
        title: "HTTP Endpoints (" + prefixGroups.length + " groups)",
        meta: unitEndpoints.some((e) => e.source === "openapi") ? "OpenAPI contract + mounted routes" : "AST routes",
        badge: unitEndpoints.length,
        badgeClass: "b-info",
        tone: "info",
        open: false,
        bodyHtml: prefixGroups.slice(0, 14).map(([pref, eps]) =>
          renderDisclosure({
            title: pref,
            badge: eps.length,
            badgeClass: "b-info",
            open: false,
            bodyHtml: eps.slice(0, 15).map((ep) =>
              '<div class="row"><span class="mono">' + esc(ep.method + " " + ep.path) + '</span><span class="badge ' + (ep.authGuard && ep.authGuard !== "public" ? "b-pass" : "b-warn") + '">' + esc(ep.authGuard || "unannotated") + "</span></div>"
            ).join("") + (eps.length > 15 ? '<div class="muted">+' + (eps.length - 15) + " more</div>" : ""),
          })
        ).join(""),
      });
    }
    if (unitEnvs.length > 0) {
      const secrets = unitEnvs.filter((x) => x.isSecret);
      const configs = unitEnvs.filter((x) => !x.isSecret);
      surfaceItemsHtml += renderDisclosure({
        title: "Environment & Secrets",
        meta: secrets.length + " secrets · " + configs.length + " config",
        badge: unitEnvs.length,
        badgeClass: secrets.length > 0 ? "b-warn" : "b-info",
        tone: secrets.length > 0 ? "warn" : "info",
        open: false,
        bodyHtml: unitEnvs.slice(0, 24).map((x) =>
          '<div class="row"><span class="mono">' + esc(x.name) + '</span><span class="badge ' + (x.isSecret ? "b-warn" : "b-na") + '">' + (x.isSecret ? "secret" : "config") + "</span></div>"
        ).join("") + (unitEnvs.length > 24 ? '<div class="muted">+' + (unitEnvs.length - 24) + " more (see Data tab)</div>" : ""),
      });
    }
    const surfaceSec = surfaceItemsHtml
      ? '<div class="sec"><div class="sec-title">Surfaces</div>' + surfaceItemsHtml + "</div>"
      : "";

    const govSec =
      '<div class="sec"><div class="sec-title">Governance (' + unitGovs.length + ")</div>" +
      (unitGovs.length === 0
        ? '<div class="muted" style="font-size:11px">No scoped governance rules indexed.</div>'
        : unitGovs.slice(0, 8).map((g) => {
            const scopeTag = g.scopePrefix ? g.scopePrefix : "repo root";
            const bullets = g.rationale ? g.rationale.split(" | ").filter(Boolean) : [];
            const body =
              '<div class="muted">' + esc(g.text) + "</div>" +
              (bullets.length > 0 ? bullets.map((b) => '<div class="ev-item">• ' + esc(b) + "</div>").join("") : "") +
              provenanceLinksHtml(g.file, g.line);
            return renderDisclosure({
              title: (g.symbol || g.kind) + " · " + scopeTag,
              badge: g.kind,
              badgeClass: "b-na",
              open: false,
              bodyHtml: body,
            });
          }).join("")) +
      "</div>";

    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(shortPkg(node.label)) + '</div><div class="drawer-sub">' + esc(node.kind) + (node.meta?.archetype ? " · " + esc(node.meta.archetype) : "") + (node.meta?.layerAxis ? " · " + esc(node.meta.layerAxis) : "") + "</div></div></div>" +
      provenanceLinksHtml(node.provenance?.file, node.provenance?.line) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + actions + "</div>" +
      findingsSec +
      connSec +
      surfaceSec +
      govSec
    );
  }

  function renderEdgeInspector(diag, edgeId) {
    const e = diag.edges.find((x) => x.id === edgeId);
    if (!e) return renderBriefingDrawer();
    const labelFor = (id) => {
      const m = moduleById.get(id);
      if (m) return m.kind === "directory" ? m.name + "/" : m.name;
      const dn = diag.nodes.find((n) => n.id === id);
      if (dn) return dn.label;
      return shortPkg(nodeById.get(id)?.label || id);
    };
    const fromLabel = labelFor(e.from);
    const toLabel = labelFor(e.to);
    return (
      '<div class="drawer-head"><div><div class="drawer-title">' + esc(fromLabel) + (e.bidirectional ? " ⇄ " : " → ") + esc(toLabel) + '</div><div class="drawer-sub">' + esc(e.kind) + " · " + esc(e.confidence) + (e.weight ? " · weight " + e.weight : "") + "</div></div></div>" +
      '<div><button class="action-btn sec-btn" data-clear-sel="1">Briefing (Esc)</button></div>' +
      (e.ruleIds && e.ruleIds.length > 0
        ? '<div class="sec"><div class="sec-title">Triggered Invariants</div>' + e.ruleIds.map((rid) => {
            const inv = invById.get(rid);
            if (!inv) return '<div class="ev-box warn"><strong class="mono">' + esc(rid) + "</strong></div>";
            return renderFindingDisclosure(inv, {
              open: true,
              filterEv: (ev) => (ev.edgeFromId === e.from && ev.edgeToId === e.to) || (e.bidirectional && ev.edgeFromId === e.to && ev.edgeToId === e.from),
            });
          }).join("") + "</div>"
        : "") +
      '<div class="sec"><div class="sec-title">Source Evidence (' + (e.evidence?.length || 0) + ")</div>" +
      ((e.evidence || []).length === 0
        ? '<div class="muted" style="font-size:11px">Structural edge without line-level evidence items.</div>'
        : e.evidence.map((ev) => '<div class="ev-box ' + (e.violation ? "fail" : "") + '">' + provenanceLinksHtml(ev.file, ev.line) + "<div>" + esc(ev.detail) + "</div></div>").join("")) +
      "</div>"
    );
  }

  function renderDataTab() {
    const q = state.dataFilter.toLowerCase();
    const subBtns =
      '<div class="sub-toggles" style="margin-bottom:10px">' +
      '<button class="pill-btn' + (state.dataSubtab === "entities" ? " active" : "") + '" data-data-sub="entities">Entities (' + DATA.entities.length + ")</button>" +
      (DATA.surfaces.foreignKeys.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "fks" ? " active" : "") + '" data-data-sub="fks">Foreign Keys (' + DATA.summary.foreignKeys + ")</button>" : "") +
      (DATA.surfaces.endpoints.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "endpoints" ? " active" : "") + '" data-data-sub="endpoints">HTTP Endpoints (' + DATA.summary.httpEndpoints + ")</button>" : "") +
      (DATA.surfaces.envBindings.length > 0 ? '<button class="pill-btn' + (state.dataSubtab === "env" ? " active" : "") + '" data-data-sub="env">Env & Secrets (' + DATA.summary.envBindings + ")</button>" : "") +
      '<input class="search" style="width:220px" id="data-filter" placeholder="Filter table..." value="' + esc(state.dataFilter) + '" />' +
      "</div>";

    if (state.dataSubtab === "fks") {
      const rows = DATA.surfaces.foreignKeys.filter((f) => !q || f.fromTable.includes(q) || f.toTable.includes(q));
      return '<div class="table-wrap">' + subBtns +
        '<table class="data-tbl"><thead><tr><th>From</th><th>References</th><th>On Delete</th><th>Migration</th></tr></thead><tbody>' +
        rows.slice(0, 120).map((f) => '<tr><td class="mono">' + esc(f.fromTable + "." + f.fromColumn) + '</td><td class="mono">' + esc(f.toTable + "." + f.toColumn) + '</td><td>' + (f.onDelete ? '<span class="badge ' + (f.onDelete === "CASCADE" ? "b-warn" : "b-info") + '">' + esc(f.onDelete) + "</span>" : '<span class="muted">RESTRICT</span>') + '</td><td class="mono muted">' + esc(f.file) + "</td></tr>").join("") +
        "</tbody></table></div>";
    }
    if (state.dataSubtab === "endpoints") {
      const rows = DATA.surfaces.endpoints.filter((e) => !q || e.path.toLowerCase().includes(q) || e.unit.toLowerCase().includes(q) || (e.authGuard || "").toLowerCase().includes(q));
      return '<div class="table-wrap">' + subBtns +
        '<table class="data-tbl"><thead><tr><th>Method</th><th>Path</th><th>Auth Guard</th><th>Unit</th><th>Authority</th></tr></thead><tbody>' +
        rows.slice(0, 180).map((e) => '<tr><td><span class="badge b-info">' + esc(e.method) + '</span></td><td class="mono">' + esc(e.path) + '</td><td><span class="badge ' + (e.authGuard === "public" || !e.authGuard ? "b-warn" : "b-pass") + '">' + esc(e.authGuard || "unannotated") + '</span></td><td class="mono">' + esc(shortPkg(e.unit)) + '</td><td class="mono muted">' + esc(e.resolution || e.source) + "</td></tr>").join("") +
        "</tbody></table></div>";
    }
    if (state.dataSubtab === "env") {
      const rows = DATA.surfaces.envBindings.filter((e) => !q || e.name.toLowerCase().includes(q) || e.units.join(",").toLowerCase().includes(q));
      return '<div class="table-wrap">' + subBtns +
        '<table class="data-tbl"><thead><tr><th>Env Variable</th><th>Sources</th><th>Units</th><th>Secret</th></tr></thead><tbody>' +
        rows.slice(0, 150).map((e) => '<tr><td class="mono">' + esc(e.name) + '</td><td class="mono muted">' + esc(e.sources.join(", ")) + '</td><td class="mono">' + esc(e.units.map(shortPkg).join(", ")) + '</td><td>' + (e.isSecret ? '<span class="badge b-warn">secret</span>' : '<span class="muted">config</span>') + "</td></tr>").join("") +
        "</tbody></table></div>";
    }

    const rows = DATA.entities.filter((e) => !q || e.entity.toLowerCase().includes(q) || e.domains.join(",").toLowerCase().includes(q));
    return '<div class="table-wrap">' + subBtns +
      '<table class="data-tbl"><thead><tr><th>Entity</th><th>Store</th><th>Refs</th><th>FKs</th><th>Tenancy</th><th>Domains</th><th>Layers</th></tr></thead><tbody>' +
      rows.slice(0, 150).map((e) =>
        '<tr><td class="mono"><strong>' + esc(e.entity) + "</strong>" + (e.authorizedShared ? ' <span class="badge b-info">shared</span>' : "") +
        '</td><td class="mono muted">' + esc(e.datastore) +
        '</td><td class="mono">' + e.totalRefs +
        '</td><td class="mono">' + e.fkCount +
        '</td><td>' + (e.hasTenancyKey ? '<span class="badge b-pass">tenant</span>' : '<span class="muted">—</span>') +
        '</td><td class="mono">' + esc(e.domains.join(", ") || "—") +
        '</td><td class="mono muted">' + esc(e.layers.join(", ") || "—") + "</td></tr>"
      ).join("") +
      "</tbody></table></div>";
  }

  function renderChecksTab() {
    const invs = DATA.invariants.filter((i) => {
      if (state.checksFilter === "active") return i.status === "fail" || i.status === "warn";
      if (state.checksFilter === "na") return i.status === "na";
      return true;
    });
    return (
      '<div class="table-wrap">' +
      '<div class="sub-toggles" style="margin-bottom:10px">' +
      '<button class="pill-btn' + (state.checksFilter === "active" ? " active" : "") + '" data-checks-filter="active">Active (' + DATA.invariants.filter((i) => i.status === "fail" || i.status === "warn").length + ")</button>" +
      '<button class="pill-btn' + (state.checksFilter === "all" ? " active" : "") + '" data-checks-filter="all">All (' + DATA.invariants.length + ")</button>" +
      '<button class="pill-btn' + (state.checksFilter === "na" ? " active" : "") + '" data-checks-filter="na">N/A (' + DATA.invariants.filter((i) => i.status === "na").length + ")</button>" +
      "</div>" +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      invs.map((inv) => {
        if (inv.status === "pass" || inv.status === "na") {
          return renderDisclosure({
            title: inv.name,
            meta: inv.id + " · " + inv.rung,
            badge: inv.status.toUpperCase(),
            badgeClass: inv.status === "pass" ? "b-pass" : "b-na",
            tone: inv.status === "pass" ? "pass" : "",
            open: false,
            bodyHtml:
              '<div class="muted">' + esc(inv.statement) + "</div>" +
              (inv.applicabilityReason ? '<div class="mono muted">N/A: ' + esc(inv.applicabilityReason) + "</div>" : ""),
          });
        }
        return renderFindingDisclosure(inv, { open: inv.status === "fail" });
      }).join("") +
      "</div></div>"
    );
  }

  function renderSearchDropdown() {
    const q = state.search.trim().toLowerCase();
    if (!q) return '<div class="search-dropdown" id="search-dd"></div>';
    const hits = [];
    for (const m of (DATA.modules || [])) {
      if (m.name.toLowerCase().includes(q) || m.relPath.toLowerCase().includes(q)) {
        hits.push({ kind: m.role + " · L" + m.level, label: m.unitSlug + " / " + (m.kind === "directory" ? m.name + "/" : m.name), action: "module", id: m.id });
      } else {
        const symHit = m.topExports.find((s) => s.name.toLowerCase().includes(q));
        if (symHit) {
          hits.push({ kind: symHit.kind, label: symHit.name + " (" + m.name + ")", action: "module", id: m.id });
        }
      }
      if (hits.length >= 8) break;
    }
    for (const n of DATA.nodes) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        hits.push({ kind: n.kind, label: shortPkg(n.label), action: "node", id: n.id });
      }
      if (hits.length >= 14) break;
    }
    for (const ep of DATA.surfaces.endpoints) {
      if (ep.path.toLowerCase().includes(q)) {
        hits.push({ kind: ep.method, label: ep.path + " (" + (ep.authGuard || "unannotated") + ")", action: "endpoints", id: ep.path });
      }
      if (hits.length >= 18) break;
    }
    for (const e of DATA.entities) {
      if (e.entity.toLowerCase().includes(q)) {
        hits.push({ kind: e.datastore, label: e.entity, action: "entity", id: e.entity });
      }
      if (hits.length >= 22) break;
    }
    return (
      '<div class="search-dropdown open" id="search-dd">' +
      (hits.length === 0
        ? '<div class="search-item"><span class="muted">No matches</span></div>'
        : hits.map((h) => '<div class="search-item" data-search-action="' + esc(h.action) + '" data-search-id="' + esc(h.id) + '"><span class="search-item-main">' + esc(h.label) + '</span><span class="search-item-kind">' + esc(h.kind) + "</span></div>").join("")) +
      "</div>"
    );
  }

  function applyTransform() {
    const vp = document.getElementById("viewport-g");
    if (vp) vp.setAttribute("transform", "translate(" + state.tx + "," + state.ty + ") scale(" + state.scale + ")");
  }

  function clearHoverSpotlight() {
    const svg = document.getElementById("diagram-svg");
    if (svg) {
      svg.classList.remove("hover-focus");
      svg.querySelectorAll(".hover-active").forEach((el) => el.classList.remove("hover-active"));
      svg.querySelectorAll(".hover-out,.hover-in,.hover-viol").forEach((el) => el.classList.remove("hover-out", "hover-in", "hover-viol"));
    }
    const tip = document.getElementById("edge-tooltip");
    if (tip) tip.style.display = "none";
  }

  function applyNodeHoverSpotlight(nodeId) {
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    clearHoverSpotlight();
    svg.classList.add("hover-focus");
    const connected = new Set([nodeId]);
    svg.querySelectorAll("[data-edge]").forEach((el) => {
      const fr = el.getAttribute("data-from");
      const to = el.getAttribute("data-to");
      const viol = el.getAttribute("data-viol") === "1";
      if (fr === nodeId || to === nodeId) {
        connected.add(fr);
        connected.add(to);
        if (viol) el.classList.add("hover-viol");
        else if (fr === nodeId) el.classList.add("hover-out");
        else el.classList.add("hover-in");
      }
    });
    svg.querySelectorAll("[data-node]").forEach((el) => {
      if (connected.has(el.getAttribute("data-node"))) el.classList.add("hover-active");
    });
  }

  function showEdgeTooltip(ev, diag, edgeId) {
    const tip = document.getElementById("edge-tooltip");
    const shell = document.getElementById("canvas-shell");
    if (!tip || !shell) return;
    const e = diag.edges.find((x) => x.id === edgeId);
    if (!e) return;
    const labelFor = (id) => {
      const m = moduleById.get(id);
      if (m) return m.kind === "directory" ? m.name + "/" : m.name;
      const dn = diag.nodes.find((n) => n.id === id);
      if (dn) return dn.label;
      return shortPkg(nodeById.get(id)?.label || id);
    };
    const fromL = labelFor(e.from);
    const toL = labelFor(e.to);
    const parts = [fromL + (e.bidirectional ? " ⇄ " : " → ") + toL];
    if (e.weight) parts.push(e.weight + " ref" + (e.weight === 1 ? "" : "s"));
    if (e.violation && e.ruleIds?.length) parts.push("⚠ " + e.ruleIds[0]);
    tip.textContent = parts.join(" · ");
    const r = shell.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(8, ev.clientX - r.left + 12), Math.max(8, r.width - 280)) + "px";
    tip.style.top = Math.max(8, ev.clientY - r.top - 34) + "px";
    tip.style.display = "block";
  }

  function render() {
    const rawDiag = activeDiagram();
    const diag = rawDiag && state.focusMode && state.selectedNodeId ? buildBowTieLayout(rawDiag, state.selectedNodeId) : rawDiag;
    if (diag && state.fittedDiagId !== diag.id + (state.focusMode ? ":f" : "")) {
      state.tx = 0;
      state.ty = 0;
      state.scale = 1;
      state.fittedDiagId = diag.id + (state.focusMode ? ":f" : "");
    }

    const v = DATA.verification;
    const statusHtml =
      '<span class="' + (v.invariantsFailed > 0 ? "status-fail" : "status-pass") + '">' + v.invariantsFailed + " fail</span>" +
      '<span class="' + (v.invariantsWarned > 0 ? "status-warn" : "muted") + '">' + v.invariantsWarned + " warn</span>" +
      '<span class="status-pass">' + v.invariantsPassed + " pass</span>" +
      "<span>" + DATA.summary.indexedSourceFiles + " files · " + v.directTestCoveragePct + "% tested</span>" +
      (DATA.summary.httpEndpoints > 0 ? "<span>" + DATA.summary.httpEndpoints + " endpoints</span>" : "") +
      (DATA.repo.commitSha ? "<span>@" + esc(DATA.repo.commitSha.slice(0, 8)) + "</span>" : "");

    const tabs = [
      { id: "map", label: "Map", show: Boolean(runtimeDiag) },
      { id: "behavior", label: "Behavior (" + behaviorDiags.length + ")", show: behaviorDiags.length > 0 },
      { id: "data", label: "Data (" + DATA.entities.length + ")", show: DATA.entities.length > 0 || DATA.surfaces.endpoints.length > 0 || DATA.surfaces.envBindings.length > 0 },
      { id: "delivery", label: "Delivery", show: Boolean(deliveryDiag) },
      { id: "checks", label: "Checks (" + (v.invariantsFailed + v.invariantsWarned) + ")", show: true },
    ].filter((t) => t.show);

    let subNav = "";
    if (state.tab === "map") {
      if (state.activeLayerDiagId) {
        const ld = diagById.get(state.activeLayerDiagId);
        const ownerModDiag = ld?.ownerId ? moduleDiagByOwner.get(ld.ownerId) : null;
        const ownerLayerDiag = ld?.ownerId ? layerDiagByOwner.get(ld.ownerId) : null;
        const parentDiag = ld?.parentDiagramId ? diagById.get(ld.parentDiagramId) : null;
        const crumbs = [];
        if (!isSingleUnitAtlas || runtimeDiag) {
          crumbs.push('<button class="pill-btn" data-back-map="1">System</button>');
        }
        if (parentDiag) {
          crumbs.push('<span class="crumb-sep">›</span><button class="pill-btn" data-open-layers="' + esc(parentDiag.id) + '">' + esc(parentDiag.id.replace(/^modules:/, "")) + "</button>");
        }
        if (ld) {
          const shortTitle = ld.category === "subsystem"
            ? ld.id.split(":").slice(2).join(":") + "/"
            : ld.id.replace(/^(?:modules|layers):/, "");
          crumbs.push('<span class="crumb-sep">›</span><span class="mono" style="color:#f8fafc;font-weight:600">' + esc(shortTitle) + "</span>");
        }
        if (ownerModDiag && ownerLayerDiag && ld && ld.category !== "subsystem") {
          crumbs.push('<span class="crumb-sep">·</span>');
          crumbs.push('<button class="pill-btn' + (ld.category === "modules" ? " active" : "") + '" data-open-layers="' + esc(ownerModDiag.id) + '">Modules</button>');
          crumbs.push('<button class="pill-btn' + (ld.category === "layers" ? " active" : "") + '" data-open-layers="' + esc(ownerLayerDiag.id) + '">Layers</button>');
        }
        subNav = '<div class="sub-toggles">' + crumbs.join("") + "</div>";
      } else {
        subNav = '<div class="sub-toggles">' +
          (moduleDiags.length === 1 ? '<button class="pill-btn" data-open-layers="' + esc(moduleDiags[0].id) + '">Modules (' + moduleDiags[0].nodes.length + ")</button>" : "") +
          '<button class="pill-btn' + (state.mapMode === "runtime" ? " active" : "") + '" data-map-mode="runtime">Runtime</button>' +
          (packagesDiag ? '<button class="pill-btn' + (state.mapMode === "packages" ? " active" : "") + '" data-map-mode="packages">Packages</button>' : "") +
          (domainsDiag ? '<button class="pill-btn' + (state.mapMode === "domains" ? " active" : "") + '" data-map-mode="domains">Domains</button>' : "") +
          "</div>";
      }
    } else if (state.tab === "behavior" && behaviorDiags.length > 1) {
      subNav = '<div class="sub-toggles">' +
        behaviorDiags.slice(0, 8).map((b) => '<button class="pill-btn' + (state.activeBehaviorId === b.id ? " active" : "") + '" data-behavior-id="' + esc(b.id) + '">' + esc(b.title.split("—")[0]?.trim()) + "</button>").join("") +
        "</div>";
    }

    let bodyHtml = "";
    if (state.tab === "data") {
      bodyHtml = renderDataTab();
    } else if (state.tab === "checks") {
      bodyHtml = renderChecksTab();
    } else if (diag) {
      const canMatrix = supportsMatrix(diag) && !state.focusMode;
      const inMatrix = canMatrix && state.viewMode === "matrix";
      const detailCount = diag.edges.filter((e) => e.tier === "detail" && !e.violation).length;
      const visibleSpineCount = diag.edges.length - detailCount;

      const drawerHtml = state.selectedEdgeId
        ? renderEdgeInspector(diag, state.selectedEdgeId)
        : state.selectedNodeId
          ? renderNodeInspector(state.selectedNodeId)
          : renderBriefingDrawer();

      const trayHtml = !inMatrix && diag.unconnectedNodes && diag.unconnectedNodes.length > 0
        ? '<div class="tray"><span>No edges extracted:</span>' +
          diag.unconnectedNodes.map((u) => '<span class="tray-chip" data-select-node="' + esc(u.id) + '">' + esc(u.label) + "</span>").join("") +
          "</div>"
        : "";

      const viewToggleHtml = canMatrix
        ? '<span class="seg-group">' +
          '<button class="seg-btn' + (!inMatrix ? " active" : "") + '" data-view-mode="flow">Flow</button>' +
          '<button class="seg-btn' + (inMatrix ? " active" : "") + '" data-view-mode="matrix">Matrix (DSM)</button>' +
          "</span>"
        : "";

      const wireToggleHtml = !inMatrix && detailCount > 0
        ? '<button class="tbtn' + (state.showAllEdges ? " active" : "") + '" data-toggle-wires="1">' + (state.showAllEdges ? "All wires (" + diag.edges.length + ")" : "Spine (" + visibleSpineCount + "/" + diag.edges.length + ")") + "</button>"
        : "";

      const zoomControls = !inMatrix
        ? '<button class="tbtn" data-zoom="in">+</button><button class="tbtn" data-zoom="out">−</button><button class="tbtn" data-zoom="fit">Fit</button>'
        : "";

      bodyHtml =
        '<div class="workspace">' +
        '<div class="canvas-panel">' +
        '<div class="canvas-head">' +
        '<div class="canvas-title">' + esc(diag.title) + "</div>" +
        '<div class="toolbar">' +
        viewToggleHtml +
        wireToggleHtml +
        (state.selectedNodeId && !inMatrix ? '<button class="tbtn' + (state.focusMode ? " active" : "") + '" data-toggle-focus="1">Focus (F)</button>' : "") +
        zoomControls +
        "</div></div>" +
        '<div class="canvas-sub">' + esc(diag.subtitle) + "</div>" +
        '<div class="canvas-shell' + (inMatrix ? " matrix-mode" : "") + '" id="canvas-shell">' +
        (inMatrix ? renderMatrixView(diag) : renderDiagramSvg(diag)) +
        '<div class="edge-tooltip" id="edge-tooltip"></div>' +
        "</div>" +
        renderLegend(diag) +
        trayHtml +
        "</div>" +
        '<div class="drawer" id="drawer">' + drawerHtml + "</div>" +
        "</div>";
    }

    document.getElementById("app").innerHTML =
      '<div class="topbar">' +
      '<div class="title-wrap">' +
      '<div class="title">RepoSpec v' + esc(DATA.schemaVersion) + " · " + esc(DATA.repo.name) + "</div>" +
      '<div class="status-line">' + statusHtml + "</div>" +
      "</div>" +
      '<div class="controls-right"><div class="search-wrap"><input class="search" id="global-search" placeholder="Search nodes, endpoints, tables (/)..." value="' + esc(state.search) + '" />' + renderSearchDropdown() + "</div></div>" +
      "</div>" +
      '<div class="nav-bar"><div class="tabs">' +
      tabs.map((t) => '<button class="tab' + (state.tab === t.id ? " active" : "") + '" data-tab="' + esc(t.id) + '">' + esc(t.label) + "</button>").join("") +
      "</div>" + subNav + "</div>" +
      bodyHtml;
  }

  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let origTx = 0;
  let origTy = 0;
  const appEl = document.getElementById("app");

  appEl.addEventListener("mouseover", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const svgNode = target.closest("[data-node]");
    if (svgNode) {
      const nid = svgNode.getAttribute("data-node");
      if (nid) applyNodeHoverSpotlight(nid);
      return;
    }
    const svgEdge = target.closest("g[data-edge]");
    if (svgEdge) {
      const rawDiag = activeDiagram();
      const diag = rawDiag && state.focusMode && state.selectedNodeId ? buildBowTieLayout(rawDiag, state.selectedNodeId) : rawDiag;
      const eid = svgEdge.getAttribute("data-edge");
      if (diag && eid) showEdgeTooltip(ev, diag, eid);
      return;
    }
    const dsmCell = target.closest("td[data-dsm-r]");
    if (dsmCell) {
      const r = dsmCell.getAttribute("data-dsm-r");
      const c = dsmCell.getAttribute("data-dsm-c");
      appEl.querySelectorAll(".dsm-row-th.hl,.dsm-col-th.hl").forEach((el) => el.classList.remove("hl"));
      appEl.querySelector('[data-dsm-row="' + r + '"]')?.classList.add("hl");
      appEl.querySelector('[data-dsm-col="' + c + '"]')?.classList.add("hl");
    }
  });

  appEl.addEventListener("mouseout", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-node]") || target.closest("g[data-edge]")) {
      const rel = ev.relatedTarget;
      if (!(rel instanceof Element) || (!rel.closest("[data-node]") && !rel.closest("g[data-edge]"))) {
        clearHoverSpotlight();
      }
    }
    if (target.closest("td[data-dsm-r]")) {
      appEl.querySelectorAll(".dsm-row-th.hl,.dsm-col-th.hl").forEach((el) => el.classList.remove("hl"));
    }
  });

  appEl.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const tabBtn = target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.getAttribute("data-tab") || "map";
      state.activeLayerDiagId = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const mapModeBtn = target.closest("[data-map-mode]");
    if (mapModeBtn) {
      state.mapMode = mapModeBtn.getAttribute("data-map-mode") || "runtime";
      state.activeLayerDiagId = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const viewModeBtn = target.closest("[data-view-mode]");
    if (viewModeBtn) {
      state.viewMode = viewModeBtn.getAttribute("data-view-mode") || "flow";
      state.focusMode = false;
      render();
      return;
    }

    if (target.closest("[data-toggle-wires]")) {
      state.showAllEdges = !state.showAllEdges;
      render();
      return;
    }

    const behBtn = target.closest("[data-behavior-id]");
    if (behBtn) {
      state.activeBehaviorId = behBtn.getAttribute("data-behavior-id");
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return;
    }

    if (target.closest("[data-back-map]")) {
      state.activeLayerDiagId = null;
      state.focusMode = false;
      state.selectedEdgeId = null;
      state.selectedNodeId = null;
      render();
      return;
    }

    const openLayerBtn = target.closest("[data-open-layers]");
    if (openLayerBtn) {
      state.tab = "map";
      state.activeLayerDiagId = openLayerBtn.getAttribute("data-open-layers");
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
      return;
    }

    if (target.closest("[data-toggle-focus]")) {
      state.focusMode = !state.focusMode;
      render();
      return;
    }

    if (target.closest("[data-clear-sel]")) {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      state.activeTraceId = null;
      render();
      return;
    }

    const zoomBtn = target.closest("[data-zoom]");
    if (zoomBtn) {
      const z = zoomBtn.getAttribute("data-zoom");
      if (z === "in") state.scale = Math.min(3.5, state.scale * 1.25);
      else if (z === "out") state.scale = Math.max(0.45, state.scale / 1.25);
      else { state.tx = 0; state.ty = 0; state.scale = 1; }
      applyTransform();
      return;
    }

    const traceCard = target.closest("[data-trace]");
    if (traceCard) {
      const tid = traceCard.getAttribute("data-trace");
      if (state.activeTraceId === tid) {
        state.activeTraceId = null;
      } else {
        state.activeTraceId = tid;
        const t = DATA.traces.find((x) => x.id === tid);
        if (t) {
          const d = diagById.get(t.diagramId);
          if (d) {
            state.viewMode = "flow";
            if (d.category === "layers" || d.category === "modules" || d.category === "subsystem") { state.tab = "map"; state.activeLayerDiagId = d.id; }
            else if (d.category === "behavior") { state.tab = "behavior"; state.activeBehaviorId = d.id; }
            else { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "runtime"; }
          }
        }
      }
      render();
      return;
    }

    const showInvBtn = target.closest("[data-show-inv]");
    if (showInvBtn) {
      const invId = showInvBtn.getAttribute("data-show-inv");
      const inv = invById.get(invId);
      const anchor = inv?.evidence?.find((e) => e.anchors && e.anchors.length > 0)?.anchors?.[0];
      if (anchor) {
        const d = diagById.get(anchor.diagramId);
        if (d) {
          state.focusMode = false;
          state.activeTraceId = null;
          if (d.category === "layers") { state.tab = "map"; state.activeLayerDiagId = d.id; }
          else if (d.category === "domains") { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "domains"; }
          else if (d.category === "delivery") { state.tab = "delivery"; }
          else { state.tab = "map"; state.activeLayerDiagId = null; state.mapMode = "runtime"; }
          state.selectedEdgeId = anchor.edgeIds[0] || null;
          state.selectedNodeId = state.selectedEdgeId ? null : (anchor.nodeIds[0] || null);
          render();
        }
      }
      return;
    }

    if (target.closest("[data-jump-checks]")) {
      state.tab = "checks";
      render();
      return;
    }

    const dataSub = target.closest("[data-data-sub]");
    if (dataSub) {
      state.dataSubtab = dataSub.getAttribute("data-data-sub") || "entities";
      render();
      return;
    }

    const checksF = target.closest("[data-checks-filter]");
    if (checksF) {
      state.checksFilter = checksF.getAttribute("data-checks-filter") || "active";
      render();
      return;
    }

    const searchItem = target.closest("[data-search-action]");
    if (searchItem) {
      const act = searchItem.getAttribute("data-search-action");
      const id = searchItem.getAttribute("data-search-id") || "";
      state.search = "";
      if (act === "module") {
        const mod = moduleById.get(id);
        state.tab = "map";
        state.activeLayerDiagId = mod ? "modules:" + mod.unitSlug : state.activeLayerDiagId;
        state.selectedNodeId = id;
        state.selectedEdgeId = null;
      } else if (act === "node") {
        state.tab = "map";
        state.activeLayerDiagId = null;
        state.mapMode = "runtime";
        state.selectedNodeId = id;
        state.selectedEdgeId = null;
      } else if (act === "endpoints") {
        state.tab = "data";
        state.dataSubtab = "endpoints";
        state.dataFilter = id;
      } else if (act === "entity") {
        state.tab = "data";
        state.dataSubtab = "entities";
        state.dataFilter = id;
      }
      render();
      return;
    }

    const selNodeEl = target.closest("[data-select-node]");
    if (selNodeEl) {
      state.selectedNodeId = selNodeEl.getAttribute("data-select-node");
      state.selectedEdgeId = null;
      render();
      return;
    }

    const svgNode = target.closest("[data-node]");
    if (svgNode) {
      state.selectedNodeId = svgNode.getAttribute("data-node");
      state.selectedEdgeId = null;
      render();
      return;
    }

    const svgEdge = target.closest("[data-edge]");
    if (svgEdge) {
      state.selectedEdgeId = svgEdge.getAttribute("data-edge");
      state.selectedNodeId = null;
      render();
      return;
    }
  });

  appEl.addEventListener("dblclick", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const svgNode = target.closest("[data-node]");
    if (!svgNode) return;
    const id = svgNode.getAttribute("data-node");
    if (!id) return;
    const mod = moduleById.get(id);
    if (mod && mod.hasSubsystemDiagram) {
      const subId = "subsystem:" + mod.unitSlug + ":" + mod.name;
      if (diagById.has(subId)) {
        state.tab = "map";
        state.activeLayerDiagId = subId;
        state.focusMode = false;
        state.selectedNodeId = null;
        state.selectedEdgeId = null;
        render();
        return;
      }
    }
    const targetDiag = moduleDiagByOwner.get(id) || layerDiagByOwner.get(id) || null;
    if (targetDiag) {
      state.tab = "map";
      state.activeLayerDiagId = targetDiag.id;
      state.focusMode = false;
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      render();
    }
  });

  appEl.addEventListener("input", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "global-search") {
      state.search = target.value;
      const dd = document.getElementById("search-dd");
      if (dd) dd.outerHTML = renderSearchDropdown();
    } else if (target.id === "data-filter") {
      state.dataFilter = target.value;
      render();
      const df = document.getElementById("data-filter");
      if (df instanceof HTMLInputElement) {
        df.focus();
        df.setSelectionRange(df.value.length, df.value.length);
      }
    }
  });

  appEl.addEventListener("pointerdown", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-node]") || target.closest("[data-edge]") || target.closest(".matrix-mode")) return;
    const shell = target.closest("#canvas-shell");
    if (!shell) return;
    dragActive = true;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    origTx = state.tx;
    origTy = state.ty;
    shell.classList.add("dragging");
    shell.setPointerCapture(ev.pointerId);
  });

  appEl.addEventListener("pointermove", (ev) => {
    if (!dragActive) return;
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const ratioX = rect.width > 0 ? vb.width / rect.width : 1;
    const ratioY = rect.height > 0 ? vb.height / rect.height : 1;
    state.tx = origTx + (ev.clientX - dragStartX) * ratioX;
    state.ty = origTy + (ev.clientY - dragStartY) * ratioY;
    applyTransform();
  });

  appEl.addEventListener("pointerup", (ev) => {
    if (!dragActive) return;
    dragActive = false;
    const shell = document.getElementById("canvas-shell");
    if (shell) {
      shell.classList.remove("dragging");
      if (shell.hasPointerCapture(ev.pointerId)) shell.releasePointerCapture(ev.pointerId);
    }
  });

  appEl.addEventListener("wheel", (ev) => {
    if (INLINE) return;
    const target = ev.target;
    if (!(target instanceof Element) || !target.closest("#canvas-shell") || target.closest(".matrix-mode")) return;
    ev.preventDefault();
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const mx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * vb.width;
    const my = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * vb.height;
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextScale = Math.max(0.45, Math.min(3.5, state.scale * factor));
    const ratio = nextScale / state.scale;
    state.tx = mx - (mx - state.tx) * ratio;
    state.ty = my - (my - state.ty) * ratio;
    state.scale = nextScale;
    applyTransform();
  }, { passive: false });

  document.addEventListener("keydown", (ev) => {
    const activeTag = document.activeElement?.tagName;
    if (ev.key === "Escape") {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      state.activeTraceId = null;
      state.search = "";
      render();
      return;
    }
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (ev.key === "/" || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k")) {
      ev.preventDefault();
      const input = document.getElementById("global-search");
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    if (ev.key.toLowerCase() === "f" && state.selectedNodeId) {
      ev.preventDefault();
      state.focusMode = !state.focusMode;
      render();
      return;
    }
    if (ev.key.toLowerCase() === "m") {
      const d = activeDiagram();
      if (supportsMatrix(d)) {
        ev.preventDefault();
        state.viewMode = state.viewMode === "matrix" ? "flow" : "matrix";
        state.focusMode = false;
        render();
      }
    }
  });

  render();
})();
</script>
</body>
</html>`;
}
