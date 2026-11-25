export function renderStudioCss(inline: boolean): string {
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

  return `
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
`;
}
