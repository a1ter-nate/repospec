export function renderEventsClientScript(): string {
  return `
  let drawerDrag = false;

  appEl.addEventListener("dblclick", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#drawer-resizer")) {
      state.drawerWidth = null;
      try { localStorage.removeItem("repospec:drawer-w"); } catch {}
      render();
      return;
    }
    if (target.closest("[data-node]")) {
      ev.preventDefault();
      return;
    }
    if (target.closest("#canvas-shell") && !target.closest(".matrix-mode") && !target.closest("[data-edge]") && !target.closest("button, .hud-pill, .hud-minimap, .tray")) {
      ev.preventDefault();
      zoomByButton("fit");
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
      rerenderSurfacesBody();
    } else if (target.id === "flow-search-input") {
      state.flowSearch = target.value;
      rerenderFlowRail();
    }
  });

  appEl.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const rz = target.closest("#drawer-resizer");
    if (rz) {
      ev.preventDefault();
      drawerDrag = true;
      rz.setPointerCapture(ev.pointerId);
      document.getElementById("workspace")?.classList.add("resizing");
      return;
    }
    const mm = target.closest("#hud-minimap");
    if (mm) {
      ev.preventDefault();
      minimapDrag = true;
      mm.setPointerCapture(ev.pointerId);
      panCameraToMinimapEvent(ev);
      return;
    }
    if (target.closest("button, a, input, select, .hud-pill, .tray, .matrix-mode")) return;
    if (!spacePan && ev.button !== 1 && (target.closest("[data-node]") || target.closest("[data-edge]"))) return;
    const shell = target.closest("#canvas-shell");
    if (!shell) return;
    syncCameraTargetImmediate();
    dragActive = true;
    dragMoved = false;
    dragPointerId = ev.pointerId;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    lastMoveX = ev.clientX;
    lastMoveY = ev.clientY;
    lastMoveTs = performance.now();
    origTx = state.tx;
    origTy = state.ty;
  });

  appEl.addEventListener("pointermove", (ev) => {
    if (drawerDrag) {
      const w = Math.max(280, Math.min(Math.round(window.innerWidth * 0.72), Math.round(window.innerWidth - ev.clientX)));
      state.drawerWidth = w;
      document.getElementById("workspace")?.style.setProperty("--drawer-w", w + "px");
      return;
    }
    if (minimapDrag) {
      panCameraToMinimapEvent(ev);
      return;
    }
    if (!dragActive) return;
    const svg = document.getElementById("diagram-svg");
    const shell = document.getElementById("canvas-shell");
    if (!svg || !shell) return;
    const dxPx = ev.clientX - dragStartX;
    const dyPx = ev.clientY - dragStartY;
    if (!dragMoved && Math.hypot(dxPx, dyPx) < 3) return;
    if (!dragMoved) {
      dragMoved = true;
      shell.classList.add("dragging");
      if (typeof shell.setPointerCapture === "function" && dragPointerId >= 0) {
        shell.setPointerCapture(dragPointerId);
      }
    }
    const ppu = Math.max(0.0001, svgPixelsPerUnit(svg));
    const now = performance.now();
    const dt = Math.max(0.004, (now - lastMoveTs) / 1000);
    if (dt < 0.08) {
      const vx = ((ev.clientX - lastMoveX) / ppu) / dt;
      const vy = ((ev.clientY - lastMoveY) / ppu) / dt;
      panVelX = panVelX * 0.45 + vx * 0.55;
      panVelY = panVelY * 0.45 + vy * 0.55;
    }
    lastMoveX = ev.clientX;
    lastMoveY = ev.clientY;
    lastMoveTs = now;
    state.tx = origTx + dxPx / ppu;
    state.ty = origTy + dyPx / ppu;
    camTarget.tx = state.tx;
    camTarget.ty = state.ty;
    applyTransform();
  });

  appEl.addEventListener("pointerup", (ev) => {
    if (drawerDrag) {
      drawerDrag = false;
      const rz = document.getElementById("drawer-resizer");
      if (rz && rz.hasPointerCapture(ev.pointerId)) rz.releasePointerCapture(ev.pointerId);
      document.getElementById("workspace")?.classList.remove("resizing");
      if (state.drawerWidth) {
        try { localStorage.setItem("repospec:drawer-w", String(state.drawerWidth)); } catch {}
      }
      return;
    }
    if (minimapDrag) {
      minimapDrag = false;
      const mm = document.getElementById("hud-minimap");
      if (mm && mm.hasPointerCapture(ev.pointerId)) mm.releasePointerCapture(ev.pointerId);
      return;
    }
    if (!dragActive) return;
    const wasDragged = dragMoved;
    dragActive = false;
    dragMoved = false;
    const shell = document.getElementById("canvas-shell");
    if (shell) {
      shell.classList.remove("dragging");
      if (shell.hasPointerCapture(ev.pointerId)) shell.releasePointerCapture(ev.pointerId);
    }
    if (wasDragged && !prefersReducedMotion && performance.now() - lastMoveTs < 65 && Math.hypot(panVelX, panVelY) > 60) {
      inertiaActive = true;
      if (!camRaf) {
        camLastTs = 0;
        camRaf = requestAnimationFrame(stepCameraFrame);
      }
    } else {
      panVelX = 0;
      panVelY = 0;
    }
  });

  appEl.addEventListener("wheel", (ev) => {
    if (INLINE) return;
    const target = ev.target;
    if (!(target instanceof Element) || !target.closest("#canvas-shell") || target.closest(".matrix-mode")) return;
    ev.preventDefault();
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    const mult = ev.deltaMode === 1 ? 26 : ev.deltaMode === 2 ? 240 : 1;
    const dx = ev.deltaX * mult;
    const dy = ev.deltaY * mult;
    const isHorizontalPan = !ev.ctrlKey && !ev.metaKey && ev.deltaMode === 0 && Math.abs(dx) > Math.abs(dy) * 1.15 && !ev.shiftKey;
    if (ev.shiftKey || isHorizontalPan) {
      const ppu = Math.max(0.0001, svgPixelsPerUnit(svg));
      const panDx = ev.shiftKey && Math.abs(dx) < 1 ? dy : dx;
      const panDy = ev.shiftKey && Math.abs(dx) < 1 ? 0 : dy;
      camTarget.tx -= panDx / ppu;
      camTarget.ty -= panDy / ppu;
      kickCameraLoop(22);
      return;
    }
    const pt = screenToSvg(svg, ev.clientX, ev.clientY);
    const factor = computeWheelZoomFactor(ev);
    zoomAroundSvgPoint(pt.x, pt.y, factor, ev.ctrlKey ? 30 : 18, false);
  }, { passive: false });

  document.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") spacePan = false;
  });

  document.addEventListener("keydown", (ev) => {
    const activeTag = document.activeElement?.tagName;
    if (typeof handleFlowsKeydown === "function" && handleFlowsKeydown(ev)) return;
    if (typeof handleSurfacesKeydown === "function" && handleSurfacesKeydown(ev)) return;
    if (typeof handleChecksKeydown === "function" && handleChecksKeydown(ev)) return;
    if (ev.key === "Enter" && document.activeElement?.id === "global-search") {
      const firstHit = document.querySelector("#search-dd [data-search-action]");
      if (firstHit instanceof HTMLElement) {
        ev.preventDefault();
        firstHit.click();
      }
      return;
    }
    if (ev.key === "Escape") {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      state.blastSeedId = null;
      state.activeTraceId = null;
      state.showGuide = false;
      state.legendOpen = false;
      state.unconnectedOpen = false;
      aiConfigOpen = false;
      state.search = "";
      render();
      return;
    }
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (ev.code === "Space") {
      spacePan = true;
      return;
    }
    if (ev.key === "/" || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k")) {
      ev.preventDefault();
      const input = document.getElementById("global-search");
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    if (ev.key === "Enter" && state.selectedNodeId) {
      if (drillIntoNode(state.selectedNodeId)) {
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === "Backspace" && (state.activeFileGraph || state.activeFolder || state.activeLayerDiagId)) {
      ev.preventDefault();
      if (state.activeFileGraph) {
        const prevFile = state.activeFileGraph;
        state.activeFileGraph = null;
        state.selectedNodeId = "file:" + prevFile;
        state.selectedEdgeId = null;
        state.focusMode = false;
        render();
        return;
      }
      if (state.activeFolder) {
        const parts = state.activeFolder.folderPath.split("/").filter(Boolean);
        if (parts.length > 1) state.activeFolder = { ...state.activeFolder, folderPath: parts.slice(0, -1).join("/") };
        else {
          const retId = state.activeFolder.returnDiagId || ("modules:" + state.activeFolder.unitSlug);
          state.activeFolder = null;
          state.activeLayerDiagId = diagById.has(retId) ? retId : null;
        }
      } else {
        state.activeLayerDiagId = null;
      }
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.focusMode = false;
      render();
      return;
    }
    if (ev.key === "0") {
      zoomByButton("fit");
      return;
    }
    if (ev.key === "+" || ev.key === "=") {
      ev.preventDefault();
      zoomByButton("in");
      return;
    }
    if (ev.key === "-") {
      ev.preventDefault();
      zoomByButton("out");
      return;
    }
    if (ev.key.toLowerCase() === "f" && state.selectedNodeId) {
      ev.preventDefault();
      state.focusMode = !state.focusMode;
      render();
      return;
    }
    if (ev.key === "]") {
      ev.preventDefault();
      state.drawerCollapsed = !state.drawerCollapsed;
      try { localStorage.setItem("repospec:drawer-collapsed", state.drawerCollapsed ? "1" : "0"); } catch {}
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

`;
}
