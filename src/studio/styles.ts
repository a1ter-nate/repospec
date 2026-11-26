export function renderStudioCss(inline: boolean): string {
  const outerCss = inline
    ? `
    html, body { margin: 0; padding: 0; background: transparent; color: var(--text-2); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 14px; line-height: 1.5; }
    .app { width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 8px; }
    .workspace { display: flex; flex-direction: column; gap: 8px; }
    .canvas-shell { height: 500px; border-radius: 10px; border: 1px solid var(--rs-border); }
    .drawer { max-height: 440px; border-radius: 10px; border: 1px solid var(--rs-border); }`
    : `
    html, body { margin: 0; padding: 0; background: #080b12; color: var(--text-2); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 14px; line-height: 1.5; overflow: hidden; }
    .app { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
    .workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 6px var(--drawer-w, 392px); transition: grid-template-columns 0.16s ease-out; }
    .workspace.code-open { grid-template-columns: minmax(0, 1fr) 6px var(--drawer-w, clamp(500px, 44vw, 680px)); }
    .workspace.resizing { transition: none; user-select: none; }
    .workspace.drawer-collapsed { grid-template-columns: minmax(0, 1fr) 0 0 !important; }
    .workspace.drawer-collapsed .drawer, .workspace.drawer-collapsed .drawer-resizer { overflow: hidden; padding: 0; border: 0; opacity: 0; pointer-events: none; }
    .drawer-resizer { position: relative; cursor: col-resize; background: #0b0f19; z-index: 25; touch-action: none; }
    .drawer-resizer::after { content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 2px; background: var(--rs-border); transition: background 0.12s ease; }
    .drawer-resizer:hover::after, .workspace.resizing .drawer-resizer::after { background: var(--accent); }
    .drawer-reopen-btn { position: absolute; top: 58px; right: 12px; z-index: 26; background: var(--rs-surface-2); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: var(--text-1); border: 1px solid var(--rs-border-hi); border-radius: 8px; padding: 5px 10px; font-family: var(--font-mono, monospace); font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: var(--rs-shadow); transition: border-color 0.12s ease, background 0.12s ease; }
    .drawer-reopen-btn:hover { border-color: var(--accent); background: #151e30; }
    .canvas-shell { height: 100%; border-radius: 0; border: 0; }
    .drawer { height: 100%; border-left: 0; border-radius: 0; }
    @media (max-width: 1080px) {
      html, body { overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .workspace, .workspace.code-open { grid-template-columns: 1fr; }
      .drawer-resizer, .drawer-reopen-btn { display: none; }
      .canvas-shell { height: 540px; }
      .drawer { height: auto; max-height: 540px; border-left: 0; border-top: 1px solid var(--rs-border); }
    }`;

  return `
  :root {
    --rs-canvas: #080b12;
    --rs-surface-1: #111622;
    --rs-surface-2: rgba(15, 20, 32, 0.92);
    --rs-code-bg: #0a0f19;
    --rs-border: rgba(255, 255, 255, 0.095);
    --rs-border-hi: rgba(255, 255, 255, 0.18);
    --rs-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    --text-1: #e6ebf5;
    --text-2: #aab4c8;
    --text-3: #8793ab;
    --text-4: #738099;
    --accent: #7cc8ff;
    --ok: #5fd9a0;
    --warn: #f5c26b;
    --err: #ff8a8a;
  }
  *, *::before, *::after { box-sizing: border-box; }
  ${outerCss}

  .studio-bar { display: flex; align-items: center; justify-content: space-between; gap: 6px 14px; padding: ${inline ? "6px 2px 8px" : "4px 16px"}; min-height: ${inline ? "auto" : "50px"}; height: auto; flex-wrap: wrap; background: ${inline ? "transparent" : "#0b0f19"}; border-bottom: 1px solid var(--rs-border); flex-shrink: 0; z-index: 30; }
  .bar-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-1); letter-spacing: -0.01em; white-space: nowrap; }
  .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1; box-shadow: 0 0 8px rgba(99,102,241,0.65); }
  .brand-ver { font-size: 11.5px; font-weight: 600; color: var(--text-2); font-family: var(--font-mono, monospace); padding: 1px 6px; border-radius: 4px; background: rgba(148,163,184,0.12); border: 1px solid var(--rs-border); }
  .tabs { display: flex; align-items: center; gap: 4px; height: 100%; }
  .tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--text-3); padding: ${inline ? "6px 10px" : "10px 10px 8px"}; font-size: 13px; font-weight: 500; cursor: pointer; transition: color 0.12s ease, border-color 0.12s ease; }
  .tab:hover { color: var(--text-1); }
  .tab.active { color: var(--text-1); font-weight: 600; border-bottom-color: #7cc8ff; }

  .bar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .status-pills { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-family: var(--font-mono, monospace); color: var(--text-2); }
  .s-dot { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 3px 7px; font: inherit; cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }
  .s-dot:hover { background: rgba(255,255,255,0.07); border-color: var(--rs-border-hi); }
  .s-dot::before { content: ""; width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .s-dot.ok::before { background: var(--ok); }
  .s-dot.err::before { background: #ef4444; }
  .s-dot.warn::before { background: var(--warn); }
  .status-fail { color: var(--err); font-weight: 600; }
  .status-warn { color: var(--warn); font-weight: 600; }
  .status-pass { color: var(--ok); font-weight: 600; }

  .search-wrap { position: relative; }
  .search { background: #111622; color: var(--text-1); border: 1px solid var(--rs-border-hi); border-radius: 7px; padding: 6px 34px 6px 11px; font-size: 13px; width: 214px; outline: none; transition: border-color 0.14s ease, width 0.14s ease; }
  .search::placeholder { color: var(--text-3); }
  .search:focus { border-color: var(--accent); width: 288px; }
  .search-kbd { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 11px; font-family: var(--font-mono, monospace); color: var(--text-3); border: 1px solid var(--rs-border-hi); border-radius: 4px; padding: 0 5px; line-height: 18px; }
  .search-dropdown { position: absolute; top: 38px; right: 0; width: 440px; max-height: 380px; overflow-y: auto; background: #0d121e; border: 1px solid var(--rs-border-hi); border-radius: 9px; z-index: 50; box-shadow: var(--rs-shadow); display: none; }
  .search-dropdown.open { display: block; }
  .search-item { padding: 9px 12px; border-bottom: 1px solid #161e30; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .search-item:hover { background: rgba(124, 200, 255, 0.1); }
  .search-item-main { font-size: 13px; color: var(--text-1); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-item-kind { font-size: 11.5px; color: var(--text-3); text-transform: uppercase; flex-shrink: 0; }

  .canvas-panel { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--rs-canvas); }
  .canvas-shell { position: relative; overflow: hidden; flex: 1; background-color: var(--rs-canvas); background-image: radial-gradient(rgba(148, 163, 184, 0.15) 1px, transparent 1px); background-size: 22px 22px; cursor: grab; user-select: none; touch-action: none; }
  .canvas-shell.matrix-mode { overflow: auto; cursor: default; user-select: text; padding: 62px 20px 24px; background-image: none; }
  .canvas-shell.dragging { cursor: grabbing; }
  .canvas-shell svg { width: 100%; height: 100%; display: block; }

  .hud-pill { position: absolute; z-index: 20; display: flex; align-items: center; gap: 6px; background: var(--rs-surface-2); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--rs-border-hi); border-radius: 10px; padding: 5px 8px; box-shadow: var(--rs-shadow); }
  .hud-top-left { top: 12px; left: 12px; max-width: calc(100% - 330px); flex-wrap: wrap; }
  .hud-top-right { top: 12px; right: 12px; }
  .hud-bottom-left { bottom: 14px; left: 12px; flex-direction: column; padding: 5px; gap: 3px; }
  .hud-bottom-center { bottom: 14px; left: 50%; transform: translateX(-50%); padding: 5px 12px; font-size: 12px; color: var(--text-2); gap: 11px; white-space: nowrap; max-width: calc(100% - 160px); overflow: hidden; }
  .hud-minimap { position: absolute; bottom: 14px; right: 14px; z-index: 20; width: 158px; height: 100px; background: rgba(11, 15, 25, 0.94); backdrop-filter: blur(10px); border: 1px solid var(--rs-border-hi); border-radius: 9px; box-shadow: var(--rs-shadow); padding: 5px; cursor: crosshair; user-select: none; touch-action: none; }
  .hud-minimap:hover { border-color: rgba(124, 200, 255, 0.6); }
  .hud-minimap svg { width: 100%; height: 100%; display: block; pointer-events: none; }

  .sub-toggles { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .pill-btn { background: transparent; color: #c3cce0; border: 1px solid transparent; border-radius: 6px; padding: 4px 10px; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; }
  .pill-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-1); }
  .pill-btn.active { background: #151c2c; color: var(--text-1); border-color: rgba(124,200,255,0.45); font-weight: 600; }
  .crumb-sep { color: var(--text-4); font-size: 12.5px; user-select: none; }
  .crumb-cur { font-family: var(--font-mono, monospace); font-size: 12.5px; font-weight: 600; color: var(--text-1); padding: 0 4px; }

  .seg-group { display: inline-flex; background: rgba(8,11,18,0.8); border: 1px solid var(--rs-border); border-radius: 7px; padding: 2px; gap: 2px; }
  .seg-btn { background: transparent; color: var(--text-3); border: 0; border-radius: 5px; padding: 4px 10px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: var(--font-mono, monospace); transition: background 0.12s ease, color 0.12s ease; }
  .seg-btn:hover { color: var(--text-1); background: rgba(255,255,255,0.05); }
  .seg-btn.active { background: #1c263b; color: var(--text-1); font-weight: 600; }
  .tbtn { background: transparent; color: #c3cce0; border: 1px solid transparent; border-radius: 6px; padding: 4px 9px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: var(--font-mono, monospace); display: inline-flex; align-items: center; justify-content: center; gap: 5px; transition: background 0.12s ease, color 0.12s ease; }
  .tbtn:hover { background: rgba(255,255,255,0.09); color: var(--text-1); }
  .tbtn.active { background: rgba(124,200,255,0.16); color: var(--text-1); border-color: rgba(124,200,255,0.45); }
  .zoom-pct { background: transparent; border: 0; font-size: 12px; font-weight: 600; font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; color: var(--text-2); text-align: center; padding: 3px 4px; min-width: 42px; border-radius: 5px; cursor: pointer; }
  .zoom-pct:hover { color: var(--text-1); background: rgba(255,255,255,0.08); }
  .keycap { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 4px; font-size: 11px; font-family: var(--font-mono, monospace); color: var(--text-2); background: rgba(255,255,255,0.06); border: 1px solid var(--rs-border-hi); }

  .edge-tooltip { position: absolute; pointer-events: none; z-index: 40; background: #0d121e; border: 1px solid rgba(124, 200, 255, 0.55); color: var(--text-1); border-radius: 7px; padding: 6px 10px; font-size: 12px; font-family: var(--font-mono, monospace); box-shadow: var(--rs-shadow); display: none; max-width: 400px; white-space: nowrap; }
  .leg-item { display: inline-flex; align-items: center; gap: 6px; }
  .leg-swatch { width: 13px; height: 2.5px; border-radius: 2px; display: inline-block; }

  .tray { position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 18; padding: 5px 10px; background: var(--rs-surface-2); border: 1px dashed var(--rs-border-hi); border-radius: 8px; font-size: 12px; color: var(--text-2); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: 76%; }
  .tray-chip { padding: 3px 8px; border-radius: 5px; background: #151c2c; border: 1px solid var(--rs-border); color: var(--text-1); font-family: var(--font-mono, monospace); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.12s ease; }
  .tray-chip:hover { color: #ffffff; background: rgba(124,200,255,0.18); border-color: rgba(124,200,255,0.5); }

  .svg-node { cursor: pointer; outline: none; transition: opacity 0.14s ease; }
  .svg-node .port-dot { opacity: 0; transition: opacity 0.14s ease; }
  .svg-node .drill-chev { transition: stroke 0.14s ease; }
  .svg-node:hover .port-dot, .svg-node.selected .port-dot, .svg-node.hover-active .port-dot { opacity: 1; }
  .svg-node:hover .drill-chev, .svg-node.selected .drill-chev { stroke: #7cc8ff; }
  .svg-node:hover .node-shape, .svg-node:focus .node-shape { stroke: rgba(124, 200, 255, 0.9) !important; stroke-width: 1.8 !important; fill: #172033; }
  .svg-node.selected .node-shape { stroke: #7cc8ff !important; stroke-width: 2.2 !important; fill: #182238; }
  .svg-node.dimmed { opacity: 0.36; }
  .svg-edge-group { cursor: pointer; transition: opacity 0.14s ease; }
  .svg-edge-group.edge-detail-hidden { display: none; }
  .svg-edge-group.dimmed { opacity: 0.09; }
  .svg-edge-group .edge-glow { opacity: 0; transition: opacity 0.14s ease; }
  .svg-edge-group .edge-pill { opacity: 0; transition: opacity 0.14s ease; }
  .svg-edge-group.selected .edge-glow, .svg-edge-group.hover-out .edge-glow, .svg-edge-group.hover-in .edge-glow, .svg-edge-group.hover-viol .edge-glow { opacity: 0.25; }
  .svg-edge-group.selected .edge-pill, .svg-edge-group.hover-out .edge-pill, .svg-edge-group.hover-in .edge-pill, .svg-edge-group.hover-viol .edge-pill, .svg-edge-group.show-pill .edge-pill { opacity: 1; }
  .svg-edge-group.selected .svg-edge-vis { stroke-width: 2.4 !important; stroke: #7cc8ff !important; }
  .svg-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }

  svg.hover-focus .svg-node { opacity: 0.36; }
  svg.hover-focus .svg-node.hover-active { opacity: 1 !important; }
  svg.hover-focus .svg-edge-group { opacity: 0.08; }
  svg.hover-focus .svg-edge-group.hover-out { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis { stroke: #7cc8ff !important; stroke-width: 2.2 !important; }
  svg.hover-focus .svg-edge-group.hover-in { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke: #5fd9a0 !important; stroke-width: 2.2 !important; }
  svg.hover-focus .svg-edge-group.hover-viol { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-viol .svg-edge-vis { stroke: #ff8a8a !important; stroke-width: 2.4 !important; }

  @media (prefers-reduced-motion: no-preference) {
    @keyframes dashFlow { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
    @keyframes canvasIn { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
    .canvas-anim { animation: canvasIn 0.14s ease-out; transform-origin: center center; }
    svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis,
    svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke-dasharray: 5 5; animation: dashFlow 0.7s linear infinite; }
  }

  .dsm-wrap { display: inline-block; min-width: 100%; }
  .dsm-note { font-size: 12.5px; color: var(--text-2); margin-bottom: 12px; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .dsm-table { border-collapse: separate; border-spacing: 2px; font-family: var(--font-mono, monospace); font-size: 12px; }
  .dsm-table th, .dsm-table td { padding: 0; text-align: center; }
  .dsm-corner { text-align: right; padding: 4px 10px !important; color: var(--text-3); font-size: 11.5px; }
  .dsm-col-th { vertical-align: bottom; padding-bottom: 6px !important; min-width: 32px; max-width: 36px; cursor: pointer; }
  .dsm-col-lbl { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; max-height: 130px; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); font-size: 11.5px; padding: 2px 4px; border-radius: 3px; }
  .dsm-col-th:hover .dsm-col-lbl, .dsm-col-th.hl .dsm-col-lbl { color: var(--accent); background: rgba(124,200,255,0.14); }
  .dsm-row-th { text-align: right !important; padding: 4px 10px !important; white-space: nowrap; color: var(--text-2); font-size: 12px; cursor: pointer; border-radius: 3px; }
  .dsm-row-th:hover, .dsm-row-th.hl { color: var(--accent); background: rgba(124,200,255,0.14); }
  .dsm-lane-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .dsm-cell { width: 32px; height: 28px; border-radius: 4px; background: rgba(17, 22, 34, 0.72); border: 1px solid rgba(255,255,255,0.06); color: var(--text-4); font-size: 11.5px; }
  .dsm-cell.diag { background: rgba(148, 163, 184, 0.06); color: var(--text-4); }
  .dsm-cell.hit { cursor: pointer; color: #e0f2fe; font-weight: 600; border-color: rgba(124, 200, 255, 0.45); }
  .dsm-cell.hit:hover { outline: 2px solid var(--accent); z-index: 2; }
  .dsm-cell.viol { background: #2d1416 !important; border-color: #ff8a8a !important; color: #ff9a9a !important; cursor: pointer; font-weight: 600; }
  .dsm-cell.sel { outline: 2px solid var(--text-1) !important; }

  .drawer { background: #0d121e; padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .drawer-title { font-size: 16px; font-weight: 600; color: var(--text-1); word-break: break-word; letter-spacing: -0.01em; line-height: 1.3; }
  .drawer-sub { font-size: 12.5px; color: var(--text-3); font-family: var(--font-mono, monospace); overflow-wrap: break-word; margin-top: 3px; }
  .drawer .tbtn { background: #151c2c; border-color: var(--rs-border); color: var(--text-1); }
  .drawer .tbtn:hover { background: #1d263b; border-color: rgba(124,200,255,0.45); }
  .sec { border-top: 1px solid #161e30; padding-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  .sec-title { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-3); display: flex; justify-content: space-between; align-items: center; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; min-height: 30px; padding: 4px 6px; border-bottom: 1px solid rgba(22, 30, 48, 0.7); transition: background 0.1s ease; }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: rgba(255,255,255,0.04); }
  .row-link { cursor: pointer; color: var(--text-1); font-weight: 500; }
  .row-link:hover { color: var(--accent); }
  .mono { font-family: var(--font-mono, ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .muted { color: var(--text-3); }

  details.disc { background: #111622; border: 1px solid var(--rs-border); border-left: 3px solid rgba(148,163,184,0.38); border-radius: 8px; overflow: hidden; }
  details.disc.tone-fail { border-left-color: #ef4444; }
  details.disc.tone-warn { border-left-color: var(--warn); }
  details.disc.tone-pass { border-left-color: var(--ok); }
  details.disc.tone-info { border-left-color: var(--accent); }
  summary.disc-sum { list-style: none; cursor: pointer; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; user-select: none; }
  summary.disc-sum::-webkit-details-marker { display: none; }
  summary.disc-sum:hover { background: rgba(255,255,255,0.035); }
  .disc-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
  .disc-chev { color: var(--text-3); font-size: 11.5px; transition: transform 0.14s ease; flex-shrink: 0; display: inline-block; }
  details.disc[open] > summary.disc-sum .disc-chev { transform: rotate(90deg); color: var(--text-1); }
  .disc-title { font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disc-meta { font-size: 11.5px; color: var(--text-3); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .disc-body { padding: 10px 12px 12px; border-top: 1px solid #161e30; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; color: var(--text-2); }
  .ev-item { padding: 8px 10px; border-radius: 6px; background: var(--rs-code-bg); border: 1px solid #161e30; display: flex; flex-direction: column; gap: 4px; color: var(--text-1); }
  .fix-note { padding: 8px 10px; border-radius: 6px; background: rgba(124, 200, 255, 0.08); border: 1px solid rgba(124, 200, 255, 0.25); color: var(--text-1); font-size: 12.5px; }

  .ev-box { background: #111622; border: 1px solid var(--rs-border); border-left: 3px solid var(--accent); border-radius: 7px; padding: 8px 10px; font-size: 12.5px; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
  .ev-box.fail { border-left-color: #ef4444; }
  .ev-box.warn { border-left-color: var(--warn); }
  .links-row { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; align-items: center; }
  .ext-link { color: var(--accent); text-decoration: none; font-family: var(--font-mono, monospace); font-size: 12px; }
  .ext-link:hover { text-decoration: underline; }
  .trace-card { background: #111622; border: 1px solid var(--rs-border); border-radius: 8px; padding: 9px 11px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; transition: border-color 0.12s ease; }
  .trace-card:hover, .trace-card.active { border-color: var(--accent); }
  .trace-note { font-size: 12px; color: var(--text-3); }

  .table-wrap { flex: 1; overflow: auto; background: #0b0f19; padding: 16px 22px; }
  table.data-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.data-tbl th { text-align: left; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); padding: 9px 10px; border-bottom: 1px solid var(--rs-border-hi); }
  table.data-tbl td { padding: 9px 10px; border-bottom: 1px solid #161e30; vertical-align: top; color: var(--text-1); }

  .badge { display: inline-flex; align-items: center; height: 21px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0 8px; border-radius: 5px; font-family: var(--font-mono, monospace); flex-shrink: 0; border: 1px solid transparent; }
  .b-fail { background: #2d1416; border-color: rgba(255,154,154,0.32); color: #ff9a9a; }
  .b-warn { background: #2b2210; border-color: rgba(245,194,107,0.34); color: #f5c26b; }
  .b-pass { background: #10281f; border-color: rgba(110,231,176,0.34); color: #6ee7b0; }
  .b-na { background: rgba(148,163,184,0.1); border-color: rgba(148,163,184,0.22); color: var(--text-2); }
  .b-info { background: rgba(124,200,255,0.12); border-color: rgba(124,200,255,0.32); color: #9ad6ff; }
  .b-purple { background: rgba(199,164,255,0.13); border-color: rgba(199,164,255,0.32); color: #c7a4ff; }
  .b-cyan { background: rgba(79,216,196,0.13); border-color: rgba(79,216,196,0.32); color: #4fd8c4; }

  .pill-row { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
  .story-box { background: #111622; border: 1px solid var(--rs-border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 11px 13px; font-size: 13px; color: var(--text-2); line-height: 1.55; }
  .story-box strong { color: var(--text-1); }
  .api-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 6px; background: #111622; border: 1px solid var(--rs-border); font-size: 12.5px; color: var(--text-1); }
  .action-btn { background: #4f46e5; color: #ffffff; border: 1px solid rgba(129,140,248,0.45); border-radius: 7px; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background 0.12s ease; }
  .action-btn:hover { background: #4338ca; }
  .action-btn.sec-btn { background: #151c2c; color: var(--text-1); border-color: var(--rs-border-hi); }
  .action-btn.sec-btn:hover { background: #1d263b; }

  .info-btn { width: 26px; height: 26px; border-radius: 999px; border: 1px solid var(--rs-border-hi); background: #151c2c; color: var(--text-2); font-size: 12.5px; font-weight: 600; font-family: var(--font-mono, monospace); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.12s ease; }
  .info-btn:hover, .info-btn.active { background: rgba(124,200,255,0.18); border-color: rgba(124,200,255,0.65); color: var(--text-1); }
  .info-popover { position: absolute; top: 58px; right: 12px; z-index: 45; width: 370px; max-width: calc(100% - 24px); background: rgba(13, 18, 30, 0.98); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(124, 200, 255, 0.45); border-radius: 10px; padding: 14px 16px; box-shadow: var(--rs-shadow); display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--text-2); line-height: 1.55; }
  .info-pop-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-1); }
  .info-pop-kicker { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); }
  .info-pop-list { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 5px; color: var(--text-2); }
  .why-note { padding: 8px 10px; border-radius: 6px; background: #2b2210; border: 1px solid rgba(245, 194, 107, 0.3); color: #f5c26b; font-size: 12.5px; }
  .tangle-banner { padding: 10px 12px; border-radius: 8px; background: #2d1416; border: 1px solid rgba(255, 138, 138, 0.35); display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #ff9a9a; }
  .sev-group-hdr { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; padding: 4px 0 2px; display: flex; align-items: center; justify-content: space-between; }
  .sev-group-hdr.fail { color: var(--err); }
  .sev-group-hdr.warn { color: var(--warn); }

  .split-diff-wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rs-border); padding-top: 56px; padding-bottom: 48px; }
  .split-pane { position: relative; background-color: var(--rs-canvas); background-image: radial-gradient(rgba(148, 163, 184, 0.11) 1px, transparent 1px); background-size: 22px 22px; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .split-pane svg { width: 100%; height: 100%; flex: 1; }
  .split-head { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--rs-border); background: rgba(11, 15, 25, 0.9); font-size: 12.5px; flex-shrink: 0; }
  @media (max-width: 900px) { .split-diff-wrap { grid-template-columns: 1fr; } }

  .code-frame { display: flex; flex-direction: column; flex-shrink: 0; background: var(--rs-code-bg); border: 1px solid #1b2438; border-radius: 9px; overflow: hidden; }
  .code-chrome { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #0d121e; border-bottom: 1px solid #1b2438; min-height: 38px; flex-wrap: wrap; }
  .code-chrome-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .code-fname { font-family: var(--font-mono, monospace); font-size: 12.5px; font-weight: 600; color: #d6deeb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .code-range { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-3); }
  .code-chrome-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .code-box { background: var(--rs-code-bg); max-height: 520px; overflow: auto; scrollbar-gutter: stable; font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.65; tab-size: 2; font-variant-ligatures: none; padding: 10px 0; }
  .code-box::-webkit-scrollbar { width: 8px; height: 8px; }
  .code-box::-webkit-scrollbar-thumb { background: #1f2a40; border-radius: 4px; }
  .code-line { display: flex; white-space: pre; min-width: 100%; width: max-content; }
  .code-line.dim-line .code-tx { opacity: 0.48; }
  .code-line.scope-start { border-top: 1px solid #1b2438; }
  .code-line.scope-end { border-bottom: 1px solid #1b2438; }
  .code-line.focus-line { background: #141c2e; }
  .code-line.focus-line .code-ln { background: #141c2e; color: #b4bfd6; font-weight: 600; box-shadow: inset -2px 0 0 #7cc8ff; }
  .code-ln { position: sticky; left: 0; z-index: 2; width: 52px; flex-shrink: 0; text-align: right; padding: 0 12px 0 6px; background: var(--rs-code-bg); border-right: 1px solid #161e30; color: #738099; font-size: 12px; user-select: none; }
  .code-tx { padding: 0 16px 0 14px; color: #d6deeb; }
  .code-foot { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; background: #0d121e; border-top: 1px solid #161e30; font-family: var(--font-mono, monospace); font-size: 11.5px; color: var(--text-3); }
  .code-box ::selection { background: rgba(124, 200, 255, 0.24); }
  .tok-kw { color: #c7a4ff; }
  .tok-fn { color: #7cc8ff; }
  .tok-ty { color: #4fd8c4; }
  .tok-st { color: #a3e6a0; }
  .tok-nu { color: #ffb86e; }
  .tok-cm { color: #7f8ba6; font-style: italic; }
  .tok-op { color: #8fb8e0; }
  .tok-pu { color: #9aa6bd; }
  .tok-pr { color: #8fd3f0; }
  .tok-dec { color: #e8c97a; }

  .explain-box { background: #111622; border: 1px solid #1d273c; border-left: 3px solid #7cc8ff; border-radius: 9px; padding: 11px 13px; display: flex; flex-direction: column; gap: 8px; }
  .explain-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .explain-head-left { display: flex; align-items: center; gap: 8px; }
  .explain-head-right { display: flex; align-items: center; gap: 6px; }
  .explain-ai-btn { border-color: rgba(199, 164, 255, 0.38) !important; color: #d8c2ff !important; }
  .explain-ai-btn:hover { background: rgba(199, 164, 255, 0.14) !important; border-color: rgba(199, 164, 255, 0.65) !important; color: #ffffff !important; }
  .explain-ai-btn:disabled { opacity: 0.6; cursor: wait; }
  .explain-body { font-size: 13px; line-height: 1.55; color: var(--text-1); }
  .explain-watch { font-size: 12.5px; line-height: 1.5; color: #f5c26b; background: rgba(43, 34, 16, 0.72); border: 1px solid rgba(245, 194, 107, 0.28); border-radius: 6px; padding: 6px 9px; }
  .explain-tag { font-size: 11.5px; font-family: var(--font-mono, monospace); color: var(--text-2); background: #0d121e; border: 1px solid #1d273c; border-radius: 5px; padding: 2px 7px; }
  .explain-err { font-size: 12px; font-family: var(--font-mono, monospace); color: #ff9a9a; background: #2d1416; border: 1px solid rgba(255, 154, 154, 0.3); border-radius: 6px; padding: 7px 9px; line-height: 1.45; }
  .explain-cfg { border-top: 1px solid #1b2438; padding-top: 9px; display: flex; flex-direction: column; gap: 8px; }
  .explain-cfg-row { display: flex; align-items: center; gap: 8px; }
  .explain-lbl { width: 64px; flex-shrink: 0; font-size: 11.5px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .explain-inp { flex: 1; min-width: 0; background: #0a0f19; color: var(--text-1); border: 1px solid var(--rs-border-hi); border-radius: 6px; padding: 5px 8px; font-family: var(--font-mono, monospace); font-size: 12px; outline: none; }
  .explain-inp:focus { border-color: var(--accent); }
  .explain-cfg-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; }

  .svg-node.blast-0 .node-shape { stroke: #ff8a8a !important; stroke-width: 2.6 !important; fill: rgba(239,68,68,0.22) !important; }
  .svg-node.blast-1 .node-shape { stroke: #f87171 !important; stroke-width: 2.1 !important; fill: rgba(239,68,68,0.14) !important; }
  .svg-node.blast-2 .node-shape { stroke: #f5c26b !important; stroke-width: 1.9 !important; fill: rgba(245,158,11,0.12) !important; }
  .svg-node.blast-3 .node-shape { stroke: #7cc8ff !important; stroke-width: 1.7 !important; fill: rgba(56,189,248,0.1) !important; }
  .svg-node.blast-dim { opacity: 0.24 !important; }
  .blast-banner { background: #1a1118; border: 1px solid rgba(255,138,138,0.38); border-left: 3px solid #ef4444; border-radius: 9px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }

  .diff-ln { display: flex; white-space: pre; min-width: 100%; width: max-content; }
  .diff-ln.diff-hdr { background: rgba(124,200,255,0.1); color: #7cc8ff; font-weight: 600; }
  .diff-ln.diff-add { background: rgba(16,185,129,0.13); }
  .diff-ln.diff-del { background: rgba(239,68,68,0.13); }
  .diff-sig { position: sticky; left: 0; width: 24px; flex-shrink: 0; text-align: center; user-select: none; color: var(--text-3); background: inherit; }
  .diff-ln.diff-add .diff-sig { color: #5fd9a0; font-weight: 700; }
  .diff-ln.diff-del .diff-sig { color: #ff8a8a; font-weight: 700; }
  .diff-tx { padding: 0 14px 0 6px; color: #d6deeb; }

  .tl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
  .tl-card { background: #111622; border: 1px solid var(--rs-border); border-radius: 9px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
  .tl-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .tl-val { font-size: 20px; font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; }
  .live-badge { display: none; align-items: center; gap: 5px; font-size: 11.5px; font-family: var(--font-mono, monospace); color: #5fd9a0; background: #10281f; border: 1px solid rgba(95,217,160,0.35); border-radius: 999px; padding: 2px 8px; }
  .live-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #5fd9a0; }

  .flow-launch-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .flow-launch-pill { border: 1px solid rgba(79,216,196,0.36); background: rgba(79,216,196,0.09); color: #67e8f9; border-radius: 6px; padding: 3px 9px; font-family: var(--font-mono, monospace); font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.12s ease; }
  .flow-launch-pill:hover { background: rgba(79,216,196,0.18); border-color: rgba(124,200,255,0.65); color: #ffffff; }
  .flow-launch-pill.has-warn { border-color: rgba(245,194,107,0.42); background: rgba(245,158,11,0.1); color: #fcd34d; }
  .flow-launch-pill.is-async { border-color: rgba(168,85,247,0.42); background: rgba(168,85,247,0.1); color: #d8b4fe; }
  .drawer-topbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -6px 0 -6px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .drawer-kicker { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-4); }
  .stat-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .stat-cell { background: #111622; border: 1px solid var(--rs-border); border-radius: 7px; padding: 7px 9px; }
  .stat-num { font-family: var(--font-mono, monospace); font-size: 15px; font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; line-height: 1.2; }
  .stat-lbl { font-size: 11px; color: var(--text-3); margin-top: 2px; }
  .more-wrap { position: relative; display: inline-block; }
  .more-wrap > summary { list-style: none; cursor: pointer; }
  .more-wrap > summary::-webkit-details-marker { display: none; }
  .more-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; min-width: 176px; background: #111726; border: 1px solid var(--rs-border-hi); border-radius: 8px; padding: 4px; box-shadow: var(--rs-shadow); display: flex; flex-direction: column; gap: 2px; }
  .more-menu button, .more-menu a { width: 100%; text-align: left; justify-content: flex-start; padding: 6px 9px; border-radius: 5px; font-size: 12px; text-decoration: none; color: var(--text-1); }
  .doc-note { font-size: 12.5px; line-height: 1.5; color: var(--text-2); border-left: 2px solid rgba(124,200,255,0.45); padding: 3px 10px; background: rgba(124,200,255,0.04); border-radius: 0 5px 5px 0; }
`;
}
