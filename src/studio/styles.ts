import { renderChecksCss } from "../internal/render/checksClient.ts";
import { renderFlowsRailCss } from "../internal/render/flowsRailClient.ts";
import { renderSurfacesCss } from "../internal/render/surfacesClient.ts";

export function renderStudioCss(inline: boolean): string {
  const outerCss = inline
    ? `
    html, body { margin: 0; padding: 0; background: transparent; color: var(--text-2); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 14px; line-height: 1.5; }
    .app { width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 8px; }
    .workspace { display: flex; flex-direction: column; gap: 8px; }
    .canvas-shell { height: 500px; border-radius: var(--r-3); border: 1px solid var(--line-2); }
    .drawer { max-height: 440px; border-radius: var(--r-3); border: 1px solid var(--line-2); }`
    : `
    html, body { margin: 0; padding: 0; background: var(--bg-0); color: var(--text-2); font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif); font-size: 14px; line-height: 1.5; overflow: hidden; }
    .app { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
    .workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 6px var(--drawer-w, 392px); transition: grid-template-columns 0.16s ease-out; }
    .workspace.code-open { grid-template-columns: minmax(0, 1fr) 6px var(--drawer-w, clamp(500px, 44vw, 680px)); }
    .workspace.resizing { transition: none; user-select: none; }
    .workspace.drawer-collapsed { grid-template-columns: minmax(0, 1fr) 0 0 !important; }
    .workspace.drawer-collapsed .drawer, .workspace.drawer-collapsed .drawer-resizer { overflow: hidden; padding: 0; border: 0; opacity: 0; pointer-events: none; }
    .drawer-resizer { position: relative; cursor: col-resize; background: var(--bg-1); z-index: 25; touch-action: none; }
    .drawer-resizer::after { content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 2px; background: var(--line-1); transition: background var(--dur) var(--ease); }
    .drawer-resizer:hover::after, .workspace.resizing .drawer-resizer::after { background: var(--accent); }
    .drawer-reopen-btn { position: absolute; top: 54px; right: 12px; z-index: 26; background: var(--rs-surface-2); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: var(--text-1); border: 1px solid var(--line-2); border-radius: var(--r-3); padding: 5px 10px; font-family: var(--font-mono, monospace); font-size: var(--fs-12); font-weight: 600; cursor: pointer; box-shadow: var(--shadow-pop); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
    .drawer-reopen-btn:hover { border-color: var(--accent-line); background: var(--bg-3); }
    .canvas-shell { height: 100%; border-radius: 0; border: 0; }
    .drawer { height: 100%; border-left: 0; border-radius: 0; }
    @media (max-width: 1080px) {
      html, body { overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .workspace, .workspace.code-open, .workspace.flows-open { grid-template-columns: 1fr; }
      .drawer-resizer, .drawer-reopen-btn { display: none; }
      .canvas-shell { height: 540px; }
      .drawer { height: auto; max-height: 540px; border-left: 0; border-top: 1px solid var(--line-2); }
    }`;

  return `
  :root {
    --bg-0: #07090e;
    --bg-1: #0c0f17;
    --bg-2: #11151f;
    --bg-3: #171c28;
    --bg-4: #1e2433;
    --line-1: rgba(255, 255, 255, 0.06);
    --line-2: rgba(255, 255, 255, 0.10);
    --line-3: rgba(255, 255, 255, 0.16);
    --rs-canvas: var(--bg-0);
    --rs-surface-1: var(--bg-2);
    --rs-surface-2: rgba(12, 15, 23, 0.92);
    --rs-code-bg: #080b12;
    --rs-border: var(--line-2);
    --rs-border-hi: var(--line-3);
    --rs-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    --shadow-pop: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--line-2);
    --text-1: #e8ecf4;
    --text-2: #b0b9cb;
    --text-3: #8590a6;
    --text-4: #6b7690;
    --bar: #44516b;
    --accent: #7cc8ff;
    --accent-soft: rgba(124, 200, 255, 0.12);
    --accent-line: rgba(124, 200, 255, 0.45);
    --ok: #5fd9a0;
    --warn: #f5c26b;
    --err: #ff8a8a;
    --ok-soft: rgba(95, 217, 160, 0.12);
    --warn-soft: rgba(245, 194, 107, 0.13);
    --err-soft: rgba(255, 138, 138, 0.13);
    --r-1: 4px;
    --r-2: 6px;
    --r-3: 8px;
    --r-4: 12px;
    --fs-11: 11px;
    --fs-12: 12px;
    --fs-13: 13px;
    --fs-15: 15px;
    --fs-20: 20px;
    --h-row: 32px;
    --h-ctl: 28px;
    --h-bar: 44px;
    --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
    --dur: 120ms;
  }
  *, *::before, *::after { box-sizing: border-box; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-line); outline-offset: -2px; }
  ${outerCss}

  .studio-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: ${inline ? "4px 2px 6px" : "0 14px"}; height: ${inline ? "auto" : "var(--h-bar)"}; min-height: ${inline ? "auto" : "var(--h-bar)"}; flex-wrap: ${inline ? "wrap" : "nowrap"}; background: ${inline ? "transparent" : "var(--bg-1)"}; border-bottom: 1px solid var(--line-1); flex-shrink: 0; z-index: 30; }
  .bar-left { display: flex; align-items: center; gap: 14px; min-width: 0; height: 100%; }
  .brand { display: flex; align-items: center; gap: 8px; font-size: var(--fs-13); font-weight: 600; color: var(--text-1); letter-spacing: -0.01em; white-space: nowrap; }
  .brand-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .brand-ver { font-size: var(--fs-11); font-weight: 600; color: var(--text-3); font-family: var(--font-mono, monospace); padding: 1px 5px; border-radius: var(--r-1); background: var(--bg-2); border: 1px solid var(--line-1); }
  .tabs { display: flex; align-items: stretch; gap: 2px; height: 100%; }
  .tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--text-3); padding: ${inline ? "6px 10px" : "0 10px"}; font-size: var(--fs-13); font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
  .tab:hover { color: var(--text-1); }
  .tab.active { color: var(--text-1); font-weight: 600; border-bottom-color: var(--accent); }
  .tab-n { font-family: var(--font-mono, monospace); font-size: var(--fs-11); color: var(--text-4); font-weight: 500; }
  .tab.active .tab-n { color: var(--text-2); }
  .tab-health { font-family: var(--font-mono, monospace); font-size: var(--fs-11); font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
  .tab-h-err { color: var(--err); }
  .tab-h-warn { color: var(--warn); }
  .tab-h-ok { color: var(--ok); }

  .bar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .header-meta { font-size: var(--fs-12); font-family: var(--font-mono, monospace); color: var(--text-4); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
  @media (max-width: 1280px) { .header-meta { display: none; } }

  .search-wrap { position: relative; }
  .search { background: var(--bg-2); color: var(--text-1); border: 1px solid var(--line-2); border-radius: var(--r-2); padding: 0 38px 0 10px; height: var(--h-ctl); font-size: var(--fs-12); width: 220px; outline: none; transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
  .search::placeholder { color: var(--text-4); }
  .search:focus { border-color: var(--accent-line); background: var(--bg-3); }
  .search-kbd { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 10.5px; font-family: var(--font-mono, monospace); color: var(--text-4); border: 1px solid var(--line-2); border-radius: var(--r-1); padding: 0 4px; line-height: 17px; }
  .search-dropdown { position: absolute; top: 34px; right: 0; width: 540px; max-width: calc(100vw - 24px); max-height: 420px; overflow-y: auto; background: var(--bg-4); border: 1px solid var(--line-2); border-radius: var(--r-3); z-index: 60; box-shadow: var(--shadow-pop); display: none; padding: 4px 0; }
  .search-dropdown.open { display: block; }
  .search-group-h { padding: 7px 12px 4px; font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-4); }
  .search-item { padding: 6px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 30px; transition: background var(--dur) var(--ease); }
  .search-item:hover { background: var(--bg-3); }
  .search-item-main { font-size: var(--fs-12); color: var(--text-1); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-item-kind { font-size: var(--fs-11); color: var(--text-4); text-transform: uppercase; flex-shrink: 0; font-family: var(--font-mono, monospace); }

  .canvas-panel { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-0); }
  .canvas-shell { position: relative; overflow: hidden; flex: 1; background-color: var(--bg-0); background-image: radial-gradient(rgba(148, 163, 184, 0.12) 1px, transparent 1px); background-size: 22px 22px; cursor: grab; user-select: none; touch-action: none; }
  .canvas-shell.matrix-mode { overflow: auto; cursor: default; user-select: text; padding: 60px 20px 24px; background-image: none; }
  .canvas-shell.dragging { cursor: grabbing; }
  .canvas-shell svg { width: 100%; height: 100%; display: block; }

  .hud-pill { position: absolute; z-index: 20; display: flex; align-items: center; gap: 4px; height: 34px; background: var(--rs-surface-2); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--line-2); border-radius: var(--r-3); padding: 3px 6px; box-shadow: var(--shadow-pop); }
  .hud-sep { width: 1px; height: 16px; background: var(--line-2); flex-shrink: 0; margin: 0 2px; }
  .hud-top-left { top: 12px; left: 12px; max-width: calc(100% - 360px); height: auto; min-height: 34px; flex-wrap: wrap; }
  .hud-top-right { top: 12px; right: 12px; }
  .hud-bottom-left { bottom: 12px; left: 12px; flex-direction: row; padding: 3px 5px; gap: 2px; }
  .hud-bottom-center { bottom: 12px; left: 50%; transform: translateX(-50%); padding: 3px 6px; font-size: var(--fs-12); color: var(--text-2); gap: 6px; white-space: nowrap; }
  .hud-pop-wrap { position: relative; display: inline-flex; align-items: center; }
  .hud-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 45; min-width: 260px; max-width: 320px; max-height: 280px; overflow-y: auto; background: var(--bg-4); border: 1px solid var(--line-2); border-radius: var(--r-3); padding: 10px 12px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-12); color: var(--text-2); white-space: normal; }
  .hud-pop.is-right { left: auto; right: 0; }
  .hud-pop-row { width: 100%; background: transparent; border: 0; border-radius: var(--r-1); padding: 5px 7px; display: flex; align-items: center; gap: 8px; font-family: var(--font-mono, monospace); font-size: var(--fs-12); color: var(--text-1); cursor: pointer; text-align: left; }
  .hud-pop-row:hover { background: var(--bg-3); color: var(--accent); }
  .hud-swatches { display: inline-flex; align-items: center; gap: 3px; }
  .hud-swatches i { width: 8px; height: 3px; border-radius: 2px; display: inline-block; }
  .hud-minimap { position: absolute; bottom: 12px; right: 12px; z-index: 20; width: 156px; height: 98px; background: rgba(12, 15, 23, 0.94); backdrop-filter: blur(10px); border: 1px solid var(--line-2); border-radius: var(--r-3); box-shadow: var(--shadow-pop); padding: 5px; cursor: crosshair; user-select: none; touch-action: none; }
  .hud-minimap:hover { border-color: var(--accent-line); }
  .hud-minimap svg { width: 100%; height: 100%; display: block; pointer-events: none; }

  .sub-toggles { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .pill-btn { background: transparent; color: var(--text-2); border: 1px solid transparent; border-radius: var(--r-2); height: 26px; padding: 0 9px; font-size: var(--fs-12); font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
  .pill-btn:hover { background: var(--bg-2); color: var(--text-1); }
  .pill-btn.active { background: var(--bg-3); color: var(--text-1); border-color: var(--accent-line); font-weight: 600; }
  .crumb-btn { background: transparent; border: 0; border-radius: var(--r-1); height: 26px; padding: 0 6px; font-size: var(--fs-12); font-weight: 500; color: var(--text-3); cursor: pointer; transition: color var(--dur) var(--ease), background var(--dur) var(--ease); }
  .crumb-btn:hover { color: var(--text-1); background: var(--bg-2); }
  .crumb-sep { color: var(--text-4); font-size: var(--fs-12); user-select: none; padding: 0 1px; }
  .crumb-cur { font-family: var(--font-mono, monospace); font-size: var(--fs-12); font-weight: 600; color: var(--text-1); padding: 0 4px; }

  .seg-group { display: inline-flex; background: var(--bg-0); border: 1px solid var(--line-1); border-radius: var(--r-2); padding: 2px; gap: 2px; }
  .seg-btn { background: transparent; color: var(--text-3); border: 0; border-radius: var(--r-1); height: 22px; padding: 0 8px; font-size: var(--fs-12); font-weight: 500; cursor: pointer; font-family: var(--font-mono, monospace); transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
  .seg-btn:hover { color: var(--text-1); background: var(--bg-2); }
  .seg-btn.active { background: var(--bg-3); color: var(--text-1); font-weight: 600; }
  .tbtn { background: transparent; color: var(--text-2); border: 1px solid transparent; border-radius: var(--r-2); height: 26px; padding: 0 8px; font-size: var(--fs-12); font-weight: 500; cursor: pointer; font-family: var(--font-mono, monospace); display: inline-flex; align-items: center; justify-content: center; gap: 5px; transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
  .tbtn:hover { background: var(--bg-2); color: var(--text-1); }
  .tbtn.active { background: var(--accent-soft); color: var(--text-1); border-color: var(--accent-line); }
  .zoom-pct { background: transparent; border: 0; font-size: var(--fs-12); font-weight: 600; font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; color: var(--text-2); text-align: center; height: 26px; padding: 0 6px; min-width: 44px; border-radius: var(--r-1); cursor: pointer; }
  .zoom-pct:hover { color: var(--text-1); background: var(--bg-2); }
  .keycap { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--r-1); font-size: var(--fs-11); font-family: var(--font-mono, monospace); color: var(--text-3); background: var(--bg-2); border: 1px solid var(--line-2); }

  .edge-tooltip { position: absolute; pointer-events: none; z-index: 40; background: var(--bg-4); border: 1px solid var(--accent-line); color: var(--text-1); border-radius: var(--r-2); padding: 6px 10px; font-size: var(--fs-12); font-family: var(--font-mono, monospace); box-shadow: var(--shadow-pop); display: none; max-width: 400px; white-space: nowrap; }
  .leg-item { display: inline-flex; align-items: center; gap: 6px; }
  .leg-swatch { width: 13px; height: 2.5px; border-radius: 2px; display: inline-block; }

  .tray-chip { padding: 3px 8px; border-radius: var(--r-1); background: var(--bg-2); border: 1px solid var(--line-1); color: var(--text-1); font-family: var(--font-mono, monospace); font-size: var(--fs-12); font-weight: 500; cursor: pointer; transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease); }
  .tray-chip:hover { color: #ffffff; background: var(--accent-soft); border-color: var(--accent-line); }

  .svg-node { cursor: pointer; outline: none; transition: opacity 0.14s ease; }
  .svg-node .port-dot { opacity: 0; transition: opacity 0.14s ease; }
  .svg-node .drill-chev { transition: stroke 0.14s ease; }
  .svg-node:hover .port-dot, .svg-node.selected .port-dot, .svg-node.hover-active .port-dot { opacity: 1; }
  .svg-node:hover .drill-chev, .svg-node.selected .drill-chev { stroke: var(--accent); }
  .svg-node:hover .node-shape, .svg-node:focus .node-shape { stroke: rgba(124, 200, 255, 0.9) !important; stroke-width: 1.8 !important; fill: #172033; }
  .svg-node.selected .node-shape { stroke: var(--accent) !important; stroke-width: 2.2 !important; fill: #182238; }
  .svg-node.dimmed { opacity: 0.36; }
  .svg-edge-group { cursor: pointer; transition: opacity 0.14s ease; }
  .svg-edge-group.edge-detail-hidden { display: none; }
  .svg-edge-group.dimmed { opacity: 0.09; }
  .svg-edge-group .edge-glow, .svg-edge-group .edge-pill { opacity: 0; transition: opacity 0.14s ease; }
  .svg-edge-group.selected .edge-glow, .svg-edge-group.hover-out .edge-glow, .svg-edge-group.hover-in .edge-glow, .svg-edge-group.hover-viol .edge-glow { opacity: 0.25; }
  .svg-edge-group.selected .edge-pill, .svg-edge-group.hover-out .edge-pill, .svg-edge-group.hover-in .edge-pill, .svg-edge-group.hover-viol .edge-pill, .svg-edge-group.show-pill .edge-pill { opacity: 1; }
  .svg-edge-group.selected .svg-edge-vis { stroke-width: 2.4 !important; stroke: var(--accent) !important; }
  .svg-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }

  svg.hover-focus .svg-node { opacity: 0.36; }
  svg.hover-focus .svg-node.hover-active { opacity: 1 !important; }
  svg.hover-focus .svg-edge-group { opacity: 0.08; }
  svg.hover-focus .svg-edge-group.hover-out, svg.hover-focus .svg-edge-group.hover-in, svg.hover-focus .svg-edge-group.hover-viol { display: inline !important; opacity: 1 !important; }
  svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis { stroke: var(--accent) !important; stroke-width: 2.2 !important; }
  svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke: var(--ok) !important; stroke-width: 2.2 !important; }
  svg.hover-focus .svg-edge-group.hover-viol .svg-edge-vis { stroke: var(--err) !important; stroke-width: 2.4 !important; }

  @media (prefers-reduced-motion: no-preference) {
    @keyframes dashFlow { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
    @keyframes canvasIn { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
    .canvas-anim { animation: canvasIn 0.14s ease-out; transform-origin: center center; }
    svg.hover-focus .svg-edge-group.hover-out .svg-edge-vis,
    svg.hover-focus .svg-edge-group.hover-in .svg-edge-vis { stroke-dasharray: 5 5; animation: dashFlow 0.7s linear infinite; }
  }

  .dsm-wrap { display: inline-block; min-width: 100%; }
  .dsm-note { font-size: var(--fs-12); color: var(--text-2); margin-bottom: 12px; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .dsm-table { border-collapse: separate; border-spacing: 2px; font-family: var(--font-mono, monospace); font-size: var(--fs-12); }
  .dsm-table th, .dsm-table td { padding: 0; text-align: center; }
  .dsm-corner { text-align: right; padding: 4px 10px !important; color: var(--text-3); font-size: var(--fs-11); }
  .dsm-col-th { vertical-align: bottom; padding-bottom: 6px !important; min-width: 32px; max-width: 36px; cursor: pointer; }
  .dsm-col-lbl { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; max-height: 130px; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); font-size: var(--fs-11); padding: 2px 4px; border-radius: 3px; }
  .dsm-col-th:hover .dsm-col-lbl, .dsm-col-th.hl .dsm-col-lbl { color: var(--accent); background: var(--accent-soft); }
  .dsm-row-th { text-align: right !important; padding: 4px 10px !important; white-space: nowrap; color: var(--text-2); font-size: var(--fs-12); cursor: pointer; border-radius: 3px; }
  .dsm-row-th:hover, .dsm-row-th.hl { color: var(--accent); background: var(--accent-soft); }
  .dsm-lane-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .dsm-cell { width: 32px; height: 28px; border-radius: var(--r-1); background: var(--bg-2); border: 1px solid var(--line-1); color: var(--text-4); font-size: var(--fs-11); }
  .dsm-cell.diag { background: rgba(148, 163, 184, 0.05); color: var(--text-4); }
  .dsm-cell.hit { cursor: pointer; color: #e0f2fe; font-weight: 600; border-color: var(--accent-line); }
  .dsm-cell.hit:hover { outline: 2px solid var(--accent); z-index: 2; }
  .dsm-cell.viol { background: #2d1416 !important; border-color: var(--err) !important; color: #ff9a9a !important; cursor: pointer; font-weight: 600; }
  .dsm-cell.sel { outline: 2px solid var(--text-1) !important; }

  .drawer { background: var(--bg-1); padding: 0 18px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .drawer-topbar { position: sticky; top: 0; z-index: 6; background: var(--bg-1); display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0 8px; border-bottom: 1px solid var(--line-1); }
  .drawer-kicker { font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-4); }
  .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .drawer-body { display: flex; flex-direction: column; gap: 12px; }
  .drawer-title { font-size: var(--fs-15); font-weight: 600; color: var(--text-1); word-break: break-word; letter-spacing: -0.01em; line-height: 1.3; }
  .drawer-sub { font-size: var(--fs-12); color: var(--text-3); font-family: var(--font-mono, monospace); overflow-wrap: break-word; margin-top: 3px; }
  .drawer .tbtn { background: var(--bg-2); border-color: var(--line-2); color: var(--text-1); }
  .drawer .tbtn:hover { background: var(--bg-3); border-color: var(--accent-line); }
  .sec { border-top: 1px solid var(--line-1); padding-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  .sec-title { font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); display: flex; justify-content: space-between; align-items: center; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: var(--fs-13); min-height: var(--h-row); padding: 4px 6px; border-bottom: 1px solid var(--line-1); border-radius: var(--r-1); transition: background var(--dur) var(--ease); }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--bg-2); }
  .row-link { cursor: pointer; color: var(--text-1); font-weight: 500; }
  .row-link:hover { color: var(--accent); }
  .mono { font-family: var(--font-mono, ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace); font-size: var(--fs-12); font-variant-numeric: tabular-nums; }
  .muted { color: var(--text-3); }

  details.disc { background: var(--bg-2); border: 1px solid var(--line-1); border-left: 2px solid var(--line-3); border-radius: var(--r-3); overflow: hidden; }
  details.disc.tone-fail { border-left-color: var(--err); }
  details.disc.tone-warn { border-left-color: var(--warn); }
  details.disc.tone-pass { border-left-color: var(--ok); }
  details.disc.tone-info { border-left-color: var(--accent); }
  summary.disc-sum { list-style: none; cursor: pointer; padding: 9px 12px; display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: var(--fs-13); user-select: none; }
  summary.disc-sum::-webkit-details-marker { display: none; }
  summary.disc-sum:hover { background: var(--bg-3); }
  .disc-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
  .disc-chev { color: var(--text-3); font-size: var(--fs-11); transition: transform 0.14s ease; flex-shrink: 0; display: inline-block; }
  details.disc[open] > summary.disc-sum .disc-chev { transform: rotate(90deg); color: var(--text-1); }
  .disc-title { font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disc-meta { font-size: var(--fs-11); color: var(--text-3); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .disc-body { padding: 10px 12px 12px; border-top: 1px solid var(--line-1); display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-12); color: var(--text-2); }
  .ev-item { padding: 8px 10px; border-radius: var(--r-2); background: var(--rs-code-bg); border: 1px solid var(--line-1); display: flex; flex-direction: column; gap: 4px; color: var(--text-1); }
  .fix-note { padding: 8px 10px; border-radius: var(--r-2); background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--text-1); font-size: var(--fs-12); }

  .ev-box { background: var(--bg-2); border: 1px solid var(--line-1); border-left: 2px solid var(--accent); border-radius: var(--r-2); padding: 8px 10px; font-size: var(--fs-12); color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
  .ev-box.fail { border-left-color: var(--err); }
  .ev-box.warn { border-left-color: var(--warn); }
  .links-row { display: flex; gap: 8px; flex-wrap: wrap; font-size: var(--fs-12); align-items: center; }
  .ext-link { color: var(--accent); text-decoration: none; font-family: var(--font-mono, monospace); font-size: var(--fs-12); }
  .ext-link:hover { text-decoration: underline; }
  .trace-card { background: var(--bg-2); border: 1px solid var(--line-1); border-radius: var(--r-3); padding: 9px 11px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
  .trace-card:hover, .trace-card.active { border-color: var(--accent-line); background: var(--bg-3); }
  .trace-note { font-size: var(--fs-12); color: var(--text-3); }

  .table-wrap { flex: 1; overflow: auto; background: var(--bg-0); padding: 16px 22px; }
  .table-wrap .tbtn { background: var(--bg-2); border-color: var(--line-2); color: var(--text-1); }
  .table-wrap .tbtn:hover { background: var(--bg-3); border-color: var(--accent-line); }
  .tbtn.tbtn-accent { background: var(--accent-soft); border-color: var(--accent-line); color: #bfe3ff; }
  .tbtn.tbtn-accent:hover { background: rgba(124,200,255,0.22); border-color: var(--accent); color: #ffffff; }
  .finding-note { color: var(--text-2); font-size: var(--fs-13); line-height: 1.5; }
  .ev-list { border-top: 1px solid var(--line-1); border-bottom: 1px solid var(--line-1); display: flex; flex-direction: column; }
  .ev-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 2px; border-bottom: 1px solid var(--line-1); }
  .ev-row:last-child { border-bottom: 0; }
  .ev-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .ev-detail { color: var(--text-1); font-size: var(--fs-12); line-height: 1.4; }
  .ev-loc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--fs-11); color: var(--text-3); }
  .ev-act { flex-shrink: 0; }
  .ev-more { font-size: var(--fs-11); color: var(--text-3); padding: 6px 2px; font-family: var(--font-mono, monospace); }
  .finding-fix { border-left: 2px solid var(--accent-line); padding: 2px 0 2px 10px; font-size: var(--fs-12); color: var(--text-2); line-height: 1.45; }
  .finding-fix strong { color: var(--accent); font-weight: 600; }
  .finding-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
  ${renderFlowsRailCss()}
  ${renderSurfacesCss()}
  ${renderChecksCss()}
  table.data-tbl { width: 100%; border-collapse: collapse; font-size: var(--fs-13); }
  table.data-tbl th { text-align: left; font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); padding: 9px 10px; border-bottom: 1px solid var(--line-2); }
  table.data-tbl td { padding: 9px 10px; border-bottom: 1px solid var(--line-1); vertical-align: top; color: var(--text-1); }

  .badge { display: inline-flex; align-items: center; height: 20px; font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0 7px; border-radius: var(--r-1); font-family: var(--font-mono, monospace); flex-shrink: 0; border: 1px solid transparent; }
  .b-fail { background: var(--err-soft); border-color: rgba(255,154,154,0.32); color: var(--err); }
  .b-warn { background: var(--warn-soft); border-color: rgba(245,194,107,0.34); color: var(--warn); }
  .b-pass { background: var(--ok-soft); border-color: rgba(110,231,176,0.34); color: var(--ok); }
  .b-na { background: rgba(148,163,184,0.09); border-color: var(--line-1); color: var(--text-3); }
  .b-info { background: var(--accent-soft); border-color: var(--accent-line); color: #9ad6ff; }
  .b-purple { background: rgba(199,164,255,0.13); border-color: rgba(199,164,255,0.3); color: #c7a4ff; }
  .b-cyan { background: rgba(79,216,196,0.13); border-color: rgba(79,216,196,0.3); color: #4fd8c4; }

  .pill-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .story-box { background: var(--bg-2); border: 1px solid var(--line-1); border-left: 2px solid var(--accent); border-radius: var(--r-3); padding: 11px 13px; font-size: var(--fs-13); color: var(--text-2); line-height: 1.55; }
  .story-box strong { color: var(--text-1); }
  .api-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 9px; border-radius: var(--r-2); background: var(--bg-2); border: 1px solid var(--line-1); font-size: var(--fs-12); color: var(--text-1); }
  .action-btn { background: var(--accent); color: #06121d; border: 1px solid var(--accent); border-radius: var(--r-2); padding: 6px 12px; font-size: var(--fs-12); font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: filter var(--dur) var(--ease), background var(--dur) var(--ease); }
  .action-btn:hover { filter: brightness(1.08); }
  .action-btn.sec-btn { background: var(--bg-2); color: var(--text-1); border-color: var(--line-2); }
  .action-btn.sec-btn:hover { background: var(--bg-3); border-color: var(--line-3); filter: none; }

  .info-btn { width: 26px; height: 26px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text-3); font-size: var(--fs-12); font-weight: 600; font-family: var(--font-mono, monospace); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--dur) var(--ease); }
  .info-btn:hover, .info-btn.active { background: var(--accent-soft); border-color: var(--accent-line); color: var(--text-1); }
  .info-popover { position: absolute; top: 54px; right: 12px; z-index: 45; width: 370px; max-width: calc(100% - 24px); background: var(--bg-4); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid var(--accent-line); border-radius: var(--r-3); padding: 14px 16px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 10px; font-size: var(--fs-13); color: var(--text-2); line-height: 1.55; }
  .info-pop-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: var(--fs-15); font-weight: 600; color: var(--text-1); }
  .info-pop-kicker { font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); }
  .info-pop-list { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 5px; color: var(--text-2); }
  .why-note { padding: 8px 10px; border-radius: var(--r-2); background: var(--warn-soft); border: 1px solid rgba(245, 194, 107, 0.28); color: var(--warn); font-size: var(--fs-12); }
  .tangle-banner { padding: 10px 12px; border-radius: var(--r-3); background: var(--err-soft); border: 1px solid rgba(255, 138, 138, 0.3); display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-13); color: var(--err); }
  .sev-group-hdr { font-size: var(--fs-11); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; padding: 4px 0 2px; display: flex; align-items: center; justify-content: space-between; }
  .sev-group-hdr.fail { color: var(--err); }
  .sev-group-hdr.warn { color: var(--warn); }

  .split-diff-wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line-1); padding-top: 56px; padding-bottom: 48px; }
  .split-pane { position: relative; background-color: var(--bg-0); background-image: radial-gradient(rgba(148, 163, 184, 0.11) 1px, transparent 1px); background-size: 22px 22px; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .split-pane svg { width: 100%; height: 100%; flex: 1; }
  .split-head { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--line-1); background: var(--bg-1); font-size: var(--fs-12); flex-shrink: 0; }
  @media (max-width: 900px) { .split-diff-wrap { grid-template-columns: 1fr; } }

  .code-frame { display: flex; flex-direction: column; flex-shrink: 0; background: var(--rs-code-bg); border: 1px solid var(--line-2); border-radius: var(--r-3); overflow: hidden; }
  .code-chrome { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--bg-1); border-bottom: 1px solid var(--line-1); min-height: 36px; flex-wrap: wrap; }
  .code-chrome-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .code-fname { font-family: var(--font-mono, monospace); font-size: var(--fs-12); font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .code-range { font-family: var(--font-mono, monospace); font-size: var(--fs-12); color: var(--text-3); }
  .code-chrome-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .code-box { background: var(--rs-code-bg); max-height: 520px; overflow: auto; scrollbar-gutter: stable; font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace; font-size: var(--fs-13); line-height: 1.6; tab-size: 2; font-variant-ligatures: none; padding: 8px 0; }
  .code-box::-webkit-scrollbar { width: 8px; height: 8px; }
  .code-box::-webkit-scrollbar-thumb { background: var(--bg-4); border-radius: 4px; }
  .code-line { display: flex; white-space: pre; min-width: 100%; width: max-content; }
  .code-line.dim-line .code-tx { opacity: 0.48; }
  .code-line.scope-start { border-top: 1px solid var(--line-1); }
  .code-line.scope-end { border-bottom: 1px solid var(--line-1); }
  .code-line.focus-line { background: var(--accent-soft); }
  .code-line.focus-line .code-ln { background: #121c2c; color: var(--text-1); font-weight: 600; box-shadow: inset -2px 0 0 var(--accent); }
  .code-ln { position: sticky; left: 0; z-index: 2; width: 48px; flex-shrink: 0; text-align: right; padding: 0 10px 0 6px; background: var(--rs-code-bg); border-right: 1px solid var(--line-1); color: var(--text-4); font-size: var(--fs-12); user-select: none; }
  .code-tx { padding: 0 14px 0 12px; color: #d6deeb; }
  .code-foot { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; background: var(--bg-1); border-top: 1px solid var(--line-1); font-family: var(--font-mono, monospace); font-size: var(--fs-11); color: var(--text-3); }
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

  .explain-box { background: var(--bg-2); border: 1px solid var(--line-1); border-left: 2px solid var(--accent); border-radius: var(--r-3); padding: 11px 13px; display: flex; flex-direction: column; gap: 8px; }
  .explain-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .explain-head-left, .explain-head-right { display: flex; align-items: center; gap: 6px; }
  .explain-ai-btn { border-color: rgba(199, 164, 255, 0.35) !important; color: #d8c2ff !important; }
  .explain-ai-btn:hover { background: rgba(199, 164, 255, 0.14) !important; border-color: rgba(199, 164, 255, 0.65) !important; color: #ffffff !important; }
  .explain-ai-btn:disabled { opacity: 0.6; cursor: wait; }
  .explain-body { font-size: var(--fs-13); line-height: 1.55; color: var(--text-1); }
  .explain-watch { font-size: var(--fs-12); line-height: 1.5; color: var(--warn); background: var(--warn-soft); border: 1px solid rgba(245, 194, 107, 0.26); border-radius: var(--r-2); padding: 6px 9px; }
  .explain-tag { font-size: var(--fs-11); font-family: var(--font-mono, monospace); color: var(--text-2); background: var(--bg-1); border: 1px solid var(--line-2); border-radius: var(--r-1); padding: 2px 7px; }
  .explain-err { font-size: var(--fs-12); font-family: var(--font-mono, monospace); color: var(--err); background: var(--err-soft); border: 1px solid rgba(255, 154, 154, 0.3); border-radius: var(--r-2); padding: 7px 9px; line-height: 1.45; }
  .explain-cfg { border-top: 1px solid var(--line-1); padding-top: 9px; display: flex; flex-direction: column; gap: 8px; }
  .explain-cfg-row { display: flex; align-items: center; gap: 8px; }
  .explain-lbl { width: 64px; flex-shrink: 0; font-size: var(--fs-11); font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .explain-inp { flex: 1; min-width: 0; background: var(--bg-0); color: var(--text-1); border: 1px solid var(--line-2); border-radius: var(--r-2); padding: 5px 8px; font-family: var(--font-mono, monospace); font-size: var(--fs-12); outline: none; }
  .explain-inp:focus { border-color: var(--accent-line); }
  .explain-cfg-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; }

  .svg-node.blast-0 .node-shape { stroke: #ff8a8a !important; stroke-width: 2.6 !important; fill: rgba(239,68,68,0.22) !important; }
  .svg-node.blast-1 .node-shape { stroke: #f87171 !important; stroke-width: 2.1 !important; fill: rgba(239,68,68,0.14) !important; }
  .svg-node.blast-2 .node-shape { stroke: #f5c26b !important; stroke-width: 1.9 !important; fill: rgba(245,158,11,0.12) !important; }
  .svg-node.blast-3 .node-shape { stroke: #7cc8ff !important; stroke-width: 1.7 !important; fill: rgba(56,189,248,0.1) !important; }
  .svg-node.blast-dim { opacity: 0.24 !important; }
  .blast-banner { background: #1a1118; border: 1px solid rgba(255,138,138,0.32); border-left: 2px solid var(--err); border-radius: var(--r-3); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }

  .diff-ln { display: flex; white-space: pre; min-width: 100%; width: max-content; }
  .diff-ln.diff-hdr { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .diff-ln.diff-add { background: rgba(16,185,129,0.13); }
  .diff-ln.diff-del { background: rgba(239,68,68,0.13); }
  .diff-sig { position: sticky; left: 0; width: 24px; flex-shrink: 0; text-align: center; user-select: none; color: var(--text-3); background: inherit; }
  .diff-ln.diff-add .diff-sig { color: var(--ok); font-weight: 700; }
  .diff-ln.diff-del .diff-sig { color: var(--err); font-weight: 700; }
  .diff-tx { padding: 0 14px 0 6px; color: #d6deeb; }

  .tl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
  .tl-card { background: var(--bg-2); border: 1px solid var(--line-1); border-radius: var(--r-3); padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
  .tl-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .tl-val { font-size: var(--fs-20); font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; }
  .live-badge { display: none; align-items: center; gap: 5px; font-size: var(--fs-11); font-family: var(--font-mono, monospace); color: var(--ok); background: var(--ok-soft); border: 1px solid rgba(95,217,160,0.32); border-radius: 999px; padding: 1px 7px; }
  .live-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }

  .flow-launch-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .flow-launch-pill { border: 1px solid rgba(79,216,196,0.32); background: rgba(79,216,196,0.09); color: #67e8f9; border-radius: var(--r-2); padding: 3px 9px; font-family: var(--font-mono, monospace); font-size: var(--fs-11); font-weight: 600; cursor: pointer; transition: all var(--dur) var(--ease); }
  .flow-launch-pill:hover { background: rgba(79,216,196,0.18); border-color: var(--accent-line); color: #ffffff; }
  .flow-launch-pill.has-warn { border-color: rgba(245,194,107,0.38); background: var(--warn-soft); color: var(--warn); }
  .flow-launch-pill.is-async { border-color: rgba(168,85,247,0.38); background: rgba(168,85,247,0.1); color: #d8b4fe; }
  .stat-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .stat-cell { background: var(--bg-2); border-radius: var(--r-2); padding: 8px 10px; }
  .stat-num { font-family: var(--font-mono, monospace); font-size: var(--fs-15); font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; line-height: 1.2; }
  .stat-lbl { font-size: var(--fs-11); color: var(--text-3); margin-top: 2px; }
  .more-wrap { position: relative; display: inline-block; }
  .more-wrap > summary { list-style: none; cursor: pointer; }
  .more-wrap > summary::-webkit-details-marker { display: none; }
  .more-menu { position: absolute; right: 0; top: calc(100% + 5px); z-index: 50; min-width: 176px; background: var(--bg-4); border: 1px solid var(--line-2); border-radius: var(--r-3); padding: 4px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 2px; }
  .more-menu button, .more-menu a { width: 100%; text-align: left; justify-content: flex-start; padding: 6px 9px; border-radius: var(--r-1); font-size: var(--fs-12); text-decoration: none; color: var(--text-1); background: transparent; border: 0; cursor: pointer; }
  .more-menu button:hover, .more-menu a:hover { background: var(--bg-3); }
  .more-menu button.active { color: var(--accent); font-weight: 600; }
  .doc-note { font-size: var(--fs-12); line-height: 1.5; color: var(--text-2); border-left: 2px solid var(--accent-line); padding: 3px 10px; background: rgba(124,200,255,0.04); border-radius: 0 var(--r-1) var(--r-1) 0; }
  .drawer-tabs { position: sticky; top: 44px; z-index: 5; background: var(--bg-1); display: flex; gap: 2px; border-bottom: 1px solid var(--line-1); margin: 0 0 -4px; }
  .drawer-tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--text-3); padding: 6px 10px; font-size: var(--fs-12); font-weight: 500; cursor: pointer; transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
  .drawer-tab:hover { color: var(--text-1); }
  .drawer-tab.active { color: var(--text-1); font-weight: 600; border-bottom-color: var(--accent); }
  .start-card { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 11px; border-radius: var(--r-3); background: var(--bg-2); border: 1px solid var(--line-1); cursor: pointer; text-align: left; width: 100%; transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
  .start-card:hover { border-color: var(--accent-line); background: var(--bg-3); }
  .start-title { font-family: var(--font-mono, monospace); font-size: var(--fs-12); font-weight: 600; color: var(--text-1); }
  .start-why { font-size: var(--fs-11); color: var(--text-3); margin-top: 2px; }
`;
}
