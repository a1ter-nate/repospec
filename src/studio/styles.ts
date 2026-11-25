export function renderStudioCss(inline: boolean): string {
  const outerCss = inline
    ? `
    html, body { margin: 0; padding: 0; background: transparent; color: var(--foreground, #e5e7eb); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 13px; line-height: 1.45; }
    .app { width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 8px; }
    .workspace { display: flex; flex-direction: column; gap: 8px; }
    .canvas-shell { height: 490px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); }
    .drawer { max-height: 390px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); }`
    : `
    html, body { margin: 0; padding: 0; background: #080b12; color: var(--foreground, #e5e7eb); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 13px; line-height: 1.45; overflow: hidden; }
    .app { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
    .workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 392px; }
    .canvas-shell { height: 100%; border-radius: 0; border: 0; }
    .drawer { height: 100%; border-left: 1px solid rgba(255,255,255,0.08); border-radius: 0; }
    @media (max-width: 1040px) {
      html, body { overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .workspace { grid-template-columns: 1fr; }
      .canvas-shell { height: 540px; }
      .drawer { height: auto; max-height: 480px; border-left: 0; border-top: 1px solid rgba(255,255,255,0.08); }
    }`;

  return `
  :root {
    --rs-canvas: #080b12;
    --rs-surface-1: #111622;
    --rs-surface-2: rgba(15, 20, 32, 0.88);
    --rs-border: rgba(255, 255, 255, 0.085);
    --rs-border-hi: rgba(255, 255, 255, 0.16);
    --rs-shadow: 0 8px 28px rgba(0, 0, 0, 0.48);
  }
  *, *::before, *::after { box-sizing: border-box; }
  ${outerCss}

  .studio-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: ${inline ? "4px 2px 6px" : "0 14px"}; height: ${inline ? "auto" : "46px"}; flex-wrap: wrap; background: ${inline ? "transparent" : "#0b0f19"}; border-bottom: 1px solid var(--rs-border); flex-shrink: 0; z-index: 30; }
  .bar-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #f8fafc; letter-spacing: -0.01em; white-space: nowrap; }
  .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1; box-shadow: 0 0 8px rgba(99,102,241,0.6); }
  .brand-ver { font-size: 10px; font-weight: 600; color: #94a3b8; font-family: var(--font-mono, monospace); padding: 1px 5px; border-radius: 4px; background: rgba(148,163,184,0.1); border: 1px solid var(--rs-border); }
  .tabs { display: flex; align-items: center; gap: 2px; height: 100%; }
  .tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: #94a3b8; padding: ${inline ? "4px 8px" : "12px 10px 10px"}; font-size: 12px; font-weight: 500; cursor: pointer; transition: color 0.12s ease, border-color 0.12s ease; }
  .tab:hover { color: #e2e8f0; }
  .tab.active { color: #f8fafc; font-weight: 600; border-bottom-color: #6366f1; }

  .bar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .status-pills { display: flex; align-items: center; gap: 8px; font-size: 11px; font-family: var(--font-mono, monospace); color: #94a3b8; }
  .s-dot { display: inline-flex; align-items: center; gap: 4px; background: transparent; border: 1px solid transparent; border-radius: 5px; padding: 2px 5px; font: inherit; cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }
  .s-dot:hover { background: rgba(255,255,255,0.06); border-color: var(--rs-border-hi); }
  .s-dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .s-dot.ok::before { background: #10b981; }
  .s-dot.err::before { background: #ef4444; }
  .s-dot.warn::before { background: #f59e0b; }
  .status-fail { color: #fca5a5; font-weight: 600; }
  .status-warn { color: #fcd34d; font-weight: 600; }
  .status-pass { color: #6ee7b7; font-weight: 600; }

  .search-wrap { position: relative; }
  .search { background: rgba(17, 22, 34, 0.9); color: #f8fafc; border: 1px solid var(--rs-border); border-radius: 7px; padding: 5px 34px 5px 10px; font-size: 12px; width: 230px; outline: none; transition: border-color 0.14s ease, width 0.14s ease; }
  .search:focus { border-color: #6366f1; width: 270px; }
  .search-kbd { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 10px; font-family: var(--font-mono, monospace); color: #64748b; border: 1px solid var(--rs-border); border-radius: 4px; padding: 0 4px; line-height: 16px; }
  .search-dropdown { position: absolute; top: 32px; right: 0; width: 400px; max-height: 360px; overflow-y: auto; background: #0d121e; border: 1px solid var(--rs-border-hi); border-radius: 9px; z-index: 50; box-shadow: var(--rs-shadow); display: none; }
  .search-dropdown.open { display: block; }
  .search-item { padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .search-item:hover { background: rgba(99, 102, 241, 0.12); }
  .search-item-main { font-size: 12px; color: #f8fafc; font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-item-kind { font-size: 10px; color: #94a3b8; text-transform: uppercase; flex-shrink: 0; }

  .canvas-panel { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--rs-canvas); }
  .canvas-shell { position: relative; overflow: hidden; flex: 1; background-color: var(--rs-canvas); background-image: radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px); background-size: 22px 22px; cursor: grab; user-select: none; touch-action: none; }
  .canvas-shell.matrix-mode { overflow: auto; cursor: default; user-select: text; padding: 56px 18px 20px; background-image: none; }
  .canvas-shell.dragging { cursor: grabbing; }
  .canvas-shell svg { width: 100%; height: 100%; display: block; }

  .hud-pill { position: absolute; z-index: 20; display: flex; align-items: center; gap: 5px; background: var(--rs-surface-2); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--rs-border); border-radius: 9px; padding: 4px 6px; box-shadow: var(--rs-shadow); }
  .hud-top-left { top: 12px; left: 12px; max-width: calc(100% - 290px); flex-wrap: wrap; }
  .hud-top-right { top: 12px; right: 12px; }
  .hud-bottom-left { bottom: 14px; left: 12px; flex-direction: column; padding: 4px; gap: 3px; }
  .hud-bottom-center { bottom: 14px; left: 50%; transform: translateX(-50%); padding: 4px 10px; font-size: 10.5px; color: #94a3b8; gap: 9px; white-space: nowrap; max-width: calc(100% - 140px); overflow: hidden; }
  .hud-minimap { position: absolute; bottom: 14px; right: 14px; z-index: 20; width: 156px; height: 98px; background: rgba(11, 15, 25, 0.92); backdrop-filter: blur(10px); border: 1px solid var(--rs-border-hi); border-radius: 9px; box-shadow: var(--rs-shadow); padding: 5px; cursor: crosshair; user-select: none; touch-action: none; }
  .hud-minimap:hover { border-color: rgba(129, 140, 248, 0.55); }
  .hud-minimap svg { width: 100%; height: 100%; display: block; pointer-events: none; }

  .sub-toggles { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .pill-btn { background: transparent; color: #cbd5e1; border: 1px solid transparent; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 500; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; }
  .pill-btn:hover { background: rgba(255,255,255,0.08); color: #f8fafc; }
  .pill-btn.active { background: rgba(99,102,241,0.22); color: #e0e7ff; border-color: rgba(99,102,241,0.45); font-weight: 600; }
  .crumb-sep { color: #475569; font-size: 11px; user-select: none; }
  .crumb-cur { font-family: var(--font-mono, monospace); font-size: 11.5px; font-weight: 600; color: #f8fafc; padding: 0 4px; }

  .seg-group { display: inline-flex; background: rgba(8,11,18,0.7); border: 1px solid var(--rs-border); border-radius: 6px; padding: 2px; gap: 2px; }
  .seg-btn { background: transparent; color: #94a3b8; border: 0; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: var(--font-mono, monospace); transition: background 0.12s ease, color 0.12s ease; }
  .seg-btn:hover { color: #e2e8f0; background: rgba(255,255,255,0.04); }
  .seg-btn.active { background: #1e293b; color: #f8fafc; font-weight: 600; }
  .tbtn { background: transparent; color: #cbd5e1; border: 1px solid transparent; border-radius: 5px; padding: 4px 7px; font-size: 11px; cursor: pointer; font-family: var(--font-mono, monospace); display: inline-flex; align-items: center; justify-content: center; gap: 4px; transition: background 0.12s ease, color 0.12s ease; }
  .tbtn:hover { background: rgba(255,255,255,0.09); color: #f8fafc; }
  .tbtn.active { background: rgba(99,102,241,0.24); color: #e0e7ff; border-color: rgba(99,102,241,0.45); }
  .zoom-pct { background: transparent; border: 0; font-size: 10px; font-family: var(--font-mono, monospace); color: #94a3b8; text-align: center; padding: 2px 3px; min-width: 36px; border-radius: 4px; cursor: pointer; }
  .zoom-pct:hover { color: #f8fafc; background: rgba(255,255,255,0.08); }
  .keycap { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; font-size: 9.5px; font-family: var(--font-mono, monospace); color: #94a3b8; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); }

  .edge-tooltip { position: absolute; pointer-events: none; z-index: 40; background: rgba(11, 15, 25, 0.96); border: 1px solid rgba(99, 102, 241, 0.6); color: #f8fafc; border-radius: 7px; padding: 5px 9px; font-size: 11px; font-family: var(--font-mono, monospace); box-shadow: var(--rs-shadow); display: none; max-width: 360px; white-space: nowrap; }
  .leg-item { display: inline-flex; align-items: center; gap: 5px; }
  .leg-swatch { width: 12px; height: 2.5px; border-radius: 2px; display: inline-block; }

  .tray { position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%); z-index: 18; padding: 4px 8px; background: var(--rs-surface-2); border: 1px dashed var(--rs-border-hi); border-radius: 7px; font-size: 10.5px; color: #94a3b8; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; max-width: 72%; }
  .tray-chip { padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: #cbd5e1; font-family: var(--font-mono, monospace); font-size: 10px; cursor: pointer; }
  .tray-chip:hover { color: #f8fafc; background: rgba(99,102,241,0.22); }

  .svg-node { cursor: pointer; outline: none; transition: opacity 0.14s ease; }
  .svg-node .port-dot { opacity: 0; transition: opacity 0.14s ease; }
  .svg-node .drill-chev { transition: stroke 0.14s ease; }
  .svg-node:hover .port-dot, .svg-node.selected .port-dot, .svg-node.hover-active .port-dot { opacity: 1; }
  .svg-node:hover .drill-chev, .svg-node.selected .drill-chev { stroke: #a5b4fc; }
  .svg-node:hover .node-shape, .svg-node:focus .node-shape { stroke: rgba(129, 140, 248, 0.9) !important; stroke-width: 1.8 !important; fill: #171f31; }
  .svg-node.selected .node-shape { stroke: #818cf8 !important; stroke-width: 2.2 !important; fill: #182034; }
  .svg-node.dimmed { opacity: 0.34; }
  .svg-edge-group { cursor: pointer; transition: opacity 0.14s ease; }
  .svg-edge-group.edge-detail-hidden { display: none; }
  .svg-edge-group.dimmed { opacity: 0.08; }
  .svg-edge-group .edge-glow { opacity: 0; transition: opacity 0.14s ease; }
  .svg-edge-group .edge-pill { opacity: 0; transition: opacity 0.14s ease; }
  .svg-edge-group.selected .edge-glow, .svg-edge-group.hover-out .edge-glow, .svg-edge-group.hover-in .edge-glow, .svg-edge-group.hover-viol .edge-glow { opacity: 0.24; }
  .svg-edge-group.selected .edge-pill, .svg-edge-group.hover-out .edge-pill, .svg-edge-group.hover-in .edge-pill, .svg-edge-group.hover-viol .edge-pill, .svg-edge-group.show-pill .edge-pill { opacity: 1; }
  .svg-edge-group.selected .svg-edge-vis { stroke-width: 2.4 !important; stroke: #818cf8 !important; }
  .svg-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }

  svg.hover-focus .svg-node { opacity: 0.34; }
  svg.hover-focus .svg-node.hover-active { opacity: 1 !important; }
  svg.hover-focus .svg-edge-group { opacity: 0.07; }
  svg.hover-focus .svg-edge-group.hover-out { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis { stroke: #38bdf8 !important; stroke-width: 2.1 !important; }
  svg.hover-focus .svg-edge-group.hover-in { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke: #34d399 !important; stroke-width: 2.1 !important; }
  svg.hover-focus .svg-edge-group.hover-viol { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-viol .svg-edge-vis { stroke: #ef4444 !important; stroke-width: 2.4 !important; }

  @media (prefers-reduced-motion: no-preference) {
    @keyframes dashFlow { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
    @keyframes canvasIn { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
    .canvas-anim { animation: canvasIn 0.14s ease-out; transform-origin: center center; }
    svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis,
    svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke-dasharray: 5 5; animation: dashFlow 0.7s linear infinite; }
  }

  .dsm-wrap { display: inline-block; min-width: 100%; }
  .dsm-note { font-size: 11px; color: #94a3b8; margin-bottom: 10px; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .dsm-table { border-collapse: separate; border-spacing: 2px; font-family: var(--font-mono, monospace); font-size: 10.5px; }
  .dsm-table th, .dsm-table td { padding: 0; text-align: center; }
  .dsm-corner { text-align: right; padding: 4px 8px !important; color: #64748b; font-size: 9.5px; }
  .dsm-col-th { vertical-align: bottom; padding-bottom: 6px !important; min-width: 30px; max-width: 32px; cursor: pointer; }
  .dsm-col-lbl { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; max-height: 120px; overflow: hidden; text-overflow: ellipsis; color: #cbd5e1; font-size: 10px; padding: 2px 4px; border-radius: 3px; }
  .dsm-col-th:hover .dsm-col-lbl, .dsm-col-th.hl .dsm-col-lbl { color: #818cf8; background: rgba(99,102,241,0.16); }
  .dsm-row-th { text-align: right !important; padding: 3px 8px !important; white-space: nowrap; color: #cbd5e1; cursor: pointer; border-radius: 3px; }
  .dsm-row-th:hover, .dsm-row-th.hl { color: #818cf8; background: rgba(99,102,241,0.16); }
  .dsm-lane-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .dsm-cell { width: 30px; height: 26px; border-radius: 4px; background: rgba(17, 22, 34, 0.7); border: 1px solid rgba(255,255,255,0.06); color: #64748b; }
  .dsm-cell.diag { background: rgba(148, 163, 184, 0.06); color: #475569; }
  .dsm-cell.hit { cursor: pointer; color: #e0f2fe; font-weight: 700; border-color: rgba(56, 189, 248, 0.45); }
  .dsm-cell.hit:hover { outline: 2px solid #818cf8; z-index: 2; }
  .dsm-cell.viol { background: rgba(239, 68, 68, 0.34) !important; border-color: #ef4444 !important; color: #fecaca !important; cursor: pointer; font-weight: 700; }
  .dsm-cell.sel { outline: 2px solid #f8fafc !important; }

  .drawer { background: #0d121e; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 11px; }
  .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .drawer-title { font-size: 14.5px; font-weight: 700; color: #f8fafc; word-break: break-word; letter-spacing: -0.01em; }
  .drawer-sub { font-size: 11px; color: #94a3b8; font-family: var(--font-mono, monospace); word-break: break-all; margin-top: 2px; }
  .sec { border-top: 1px solid var(--rs-border); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .sec-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; display: flex; justify-content: space-between; align-items: center; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; font-size: 11.5px; padding: 2.5px 4px; border-radius: 4px; transition: background 0.1s ease; }
  .row:hover { background: rgba(255,255,255,0.035); }
  .row-link { cursor: pointer; color: #e2e8f0; }
  .row-link:hover { color: #818cf8; }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; font-variant-numeric: tabular-nums; }
  .muted { color: #94a3b8; }

  details.disc { background: rgba(17, 22, 34, 0.72); border: 1px solid var(--rs-border); border-left: 2.5px solid rgba(148,163,184,0.35); border-radius: 7px; overflow: hidden; }
  details.disc.tone-fail { border-left-color: #ef4444; }
  details.disc.tone-warn { border-left-color: #f59e0b; }
  details.disc.tone-pass { border-left-color: #10b981; }
  details.disc.tone-info { border-left-color: #6366f1; }
  summary.disc-sum { list-style: none; cursor: pointer; padding: 7px 9px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11.5px; user-select: none; }
  summary.disc-sum::-webkit-details-marker { display: none; }
  summary.disc-sum:hover { background: rgba(255,255,255,0.03); }
  .disc-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
  .disc-chev { color: #64748b; font-size: 10px; transition: transform 0.14s ease; flex-shrink: 0; display: inline-block; }
  details.disc[open] > summary.disc-sum .disc-chev { transform: rotate(90deg); color: #cbd5e1; }
  .disc-title { font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disc-meta { font-size: 10px; color: #64748b; font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disc-body { padding: 7px 9px 9px; border-top: 1px solid var(--rs-border); display: flex; flex-direction: column; gap: 6px; font-size: 11px; }
  .ev-item { padding: 5px 7px; border-radius: 5px; background: rgba(8, 11, 18, 0.72); border: 1px solid var(--rs-border); display: flex; flex-direction: column; gap: 2px; }
  .fix-note { padding: 5px 7px; border-radius: 5px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); color: #cbd5e1; font-size: 10.5px; }

  .ev-box { background: rgba(17, 22, 34, 0.72); border: 1px solid var(--rs-border); border-left: 2.5px solid #6366f1; border-radius: 6px; padding: 6px 8px; font-size: 11px; display: flex; flex-direction: column; gap: 3px; }
  .ev-box.fail { border-left-color: #ef4444; }
  .ev-box.warn { border-left-color: #f59e0b; }
  .links-row { display: flex; gap: 8px; flex-wrap: wrap; font-size: 10px; align-items: center; }
  .ext-link { color: #818cf8; text-decoration: none; font-family: var(--font-mono, monospace); }
  .ext-link:hover { text-decoration: underline; }
  .trace-card { background: rgba(17, 22, 34, 0.72); border: 1px solid var(--rs-border); border-radius: 7px; padding: 7px 9px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: border-color 0.12s ease; }
  .trace-card:hover, .trace-card.active { border-color: #6366f1; }
  .trace-note { font-size: 10px; color: #64748b; }

  .table-wrap { flex: 1; overflow: auto; background: #0b0f19; padding: 14px 18px; }
  table.data-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.data-tbl th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; padding: 7px 8px; border-bottom: 1px solid var(--rs-border); }
  table.data-tbl td { padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; color: #e2e8f0; }

  .badge { display: inline-block; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 4px; font-family: var(--font-mono, monospace); flex-shrink: 0; border: 1px solid transparent; }
  .b-fail { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.3); color: #fca5a5; }
  .b-warn { background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.3); color: #fcd34d; }
  .b-pass { background: rgba(16,185,129,0.14); border-color: rgba(16,185,129,0.3); color: #6ee7b7; }
  .b-na { background: rgba(148,163,184,0.08); border-color: rgba(148,163,184,0.18); color: #94a3b8; }
  .b-info { background: rgba(99,102,241,0.14); border-color: rgba(99,102,241,0.32); color: #a5b4fc; }
  .b-purple { background: rgba(139,92,246,0.14); border-color: rgba(139,92,246,0.32); color: #c4b5fd; }
  .b-cyan { background: rgba(6,182,212,0.14); border-color: rgba(6,182,212,0.32); color: #67e8f9; }

  .pill-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .story-box { background: rgba(17, 22, 34, 0.8); border: 1px solid var(--rs-border); border-left: 2.5px solid #6366f1; border-radius: 7px; padding: 9px 11px; font-size: 12px; color: #cbd5e1; line-height: 1.55; }
  .api-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 4px 7px; border-radius: 5px; background: rgba(17, 22, 34, 0.75); border: 1px solid var(--rs-border); font-size: 11px; }
  .action-btn { background: #4f46e5; color: #ffffff; border: 1px solid rgba(129,140,248,0.4); border-radius: 6px; padding: 5px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background 0.12s ease; }
  .action-btn:hover { background: #4338ca; }
  .action-btn.sec-btn { background: rgba(255,255,255,0.05); color: #e2e8f0; border-color: var(--rs-border-hi); }
  .action-btn.sec-btn:hover { background: rgba(255,255,255,0.09); }

  .info-btn { width: 22px; height: 22px; border-radius: 999px; border: 1px solid var(--rs-border-hi); background: rgba(255,255,255,0.05); color: #94a3b8; font-size: 11px; font-weight: 700; font-family: var(--font-mono, monospace); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.12s ease; }
  .info-btn:hover, .info-btn.active { background: rgba(99,102,241,0.22); border-color: rgba(129,140,248,0.65); color: #e0e7ff; }
  .info-popover { position: absolute; top: 54px; right: 12px; z-index: 45; width: 340px; max-width: calc(100% - 24px); background: rgba(13, 18, 30, 0.97); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(129, 140, 248, 0.45); border-radius: 10px; padding: 12px 14px; box-shadow: var(--rs-shadow); display: flex; flex-direction: column; gap: 8px; font-size: 11.5px; color: #cbd5e1; line-height: 1.5; }
  .info-pop-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: #f8fafc; }
  .info-pop-kicker { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #818cf8; }
  .info-pop-list { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 4px; color: #cbd5e1; }
  .why-note { padding: 5px 7px; border-radius: 5px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.24); color: #fde68a; font-size: 10.5px; }
  .tangle-banner { padding: 8px 10px; border-radius: 7px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); display: flex; flex-direction: column; gap: 6px; font-size: 11.5px; color: #fecaca; }
  .sev-group-hdr { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; padding: 4px 0 2px; display: flex; align-items: center; justify-content: space-between; }
  .sev-group-hdr.fail { color: #fca5a5; }
  .sev-group-hdr.warn { color: #fcd34d; }

  .split-diff-wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rs-border); padding-top: 52px; padding-bottom: 44px; }
  .split-pane { position: relative; background-color: var(--rs-canvas); background-image: radial-gradient(rgba(148, 163, 184, 0.11) 1px, transparent 1px); background-size: 22px 22px; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .split-pane svg { width: 100%; height: 100%; flex: 1; }
  .split-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--rs-border); background: rgba(11, 15, 25, 0.85); font-size: 11px; flex-shrink: 0; }
  @media (max-width: 900px) { .split-diff-wrap { grid-template-columns: 1fr; } }
`;
}
