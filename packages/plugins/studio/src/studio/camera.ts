export function renderCameraClientScript(): string {
  return `
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 5.0;
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const camTarget = { tx: 0, ty: 0, scale: 1 };
  let camLambda = 16;
  let camRaf = 0;
  let camLastTs = 0;
  let panVelX = 0;
  let panVelY = 0;
  let inertiaActive = false;
  let dragActive = false;
  let dragMoved = false;
  let dragPointerId = -1;
  let dragStartX = 0;
  let dragStartY = 0;
  let origTx = 0;
  let origTy = 0;
  let lastMoveX = 0;
  let lastMoveY = 0;
  let lastMoveTs = 0;
  let spacePan = false;
  let minimapDrag = false;

  function screenToSvg(svg, clientX, clientY) {
    const ctm = svg.getScreenCTM ? svg.getScreenCTM() : null;
    if (ctm && ctm.a !== 0 && ctm.d !== 0) {
      const inv = ctm.inverse();
      return {
        x: clientX * inv.a + clientY * inv.c + inv.e,
        y: clientX * inv.b + clientY * inv.d + inv.f,
      };
    }
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const s = Math.min(r.width / Math.max(1, vb.width), r.height / Math.max(1, vb.height));
    const ox = (r.width - vb.width * s) / 2;
    const oy = (r.height - vb.height * s) / 2;
    return {
      x: vb.x + (clientX - r.left - ox) / Math.max(0.0001, s),
      y: vb.y + (clientY - r.top - oy) / Math.max(0.0001, s),
    };
  }

  function svgPixelsPerUnit(svg) {
    const ctm = svg.getScreenCTM ? svg.getScreenCTM() : null;
    if (ctm && ctm.a > 0) return ctm.a;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return Math.min(r.width / Math.max(1, vb.width), r.height / Math.max(1, vb.height));
  }

  function syncBackgroundGrid(svg) {
    const shell = document.getElementById("canvas-shell");
    if (!shell || shell.classList.contains("matrix-mode") || !svg) return;
    const ppu = svgPixelsPerUnit(svg);
    let step = 24 * state.scale * Math.max(0.45, Math.min(1.6, ppu));
    while (step < 14) step *= 2;
    while (step > 42) step /= 2;
    const gx = (state.tx * ppu) % step;
    const gy = (state.ty * ppu) % step;
    shell.style.backgroundSize = step.toFixed(2) + "px " + step.toFixed(2) + "px";
    shell.style.backgroundPosition = gx.toFixed(1) + "px " + gy.toFixed(1) + "px";
  }

  function syncMinimapViewport(svg) {
    const vpRect = document.getElementById("minimap-vp");
    if (!vpRect || !svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const tl = screenToSvg(svg, r.left, r.top);
    const br = screenToSvg(svg, r.right, r.bottom);
    const wx = (tl.x - state.tx) / state.scale;
    const wy = (tl.y - state.ty) / state.scale;
    const ww = (br.x - tl.x) / state.scale;
    const wh = (br.y - tl.y) / state.scale;
    vpRect.setAttribute("x", wx.toFixed(1));
    vpRect.setAttribute("y", wy.toFixed(1));
    vpRect.setAttribute("width", Math.max(12, ww).toFixed(1));
    vpRect.setAttribute("height", Math.max(12, wh).toFixed(1));
  }

  function applyTransform() {
    const vp = document.getElementById("viewport-g");
    if (vp) vp.setAttribute("transform", "translate(" + state.tx.toFixed(2) + "," + state.ty.toFixed(2) + ") scale(" + state.scale.toFixed(4) + ")");
    const zp = document.getElementById("zoom-pct");
    if (zp) zp.textContent = Math.round(state.scale * 100) + "%";
    const svg = document.getElementById("diagram-svg");
    if (svg) {
      syncBackgroundGrid(svg);
      syncMinimapViewport(svg);
    }
  }

  function syncCameraTargetImmediate() {
    if (camRaf) {
      cancelAnimationFrame(camRaf);
      camRaf = 0;
    }
    inertiaActive = false;
    panVelX = 0;
    panVelY = 0;
    camTarget.tx = state.tx;
    camTarget.ty = state.ty;
    camTarget.scale = state.scale;
  }

  function stepCameraFrame(ts) {
    camRaf = 0;
    const dt = camLastTs ? Math.min(0.05, Math.max(0.004, (ts - camLastTs) / 1000)) : 0.016;
    camLastTs = ts;
    let keepGoing = false;

    if (inertiaActive) {
      const decay = Math.exp(-9.5 * dt);
      state.tx += panVelX * dt;
      state.ty += panVelY * dt;
      panVelX *= decay;
      panVelY *= decay;
      camTarget.tx = state.tx;
      camTarget.ty = state.ty;
      if (Math.hypot(panVelX, panVelY) > 12) {
        keepGoing = true;
      } else {
        inertiaActive = false;
        panVelX = 0;
        panVelY = 0;
      }
    } else {
      const alpha = 1 - Math.exp(-camLambda * dt);
      state.tx += (camTarget.tx - state.tx) * alpha;
      state.ty += (camTarget.ty - state.ty) * alpha;
      state.scale += (camTarget.scale - state.scale) * alpha;
      const done =
        Math.abs(camTarget.tx - state.tx) < 0.25 &&
        Math.abs(camTarget.ty - state.ty) < 0.25 &&
        Math.abs(camTarget.scale - state.scale) < 0.0008;
      if (done) {
        state.tx = camTarget.tx;
        state.ty = camTarget.ty;
        state.scale = camTarget.scale;
      } else {
        keepGoing = true;
      }
    }

    applyTransform();
    if (keepGoing) {
      camRaf = requestAnimationFrame(stepCameraFrame);
    } else {
      camLastTs = 0;
    }
  }

  function kickCameraLoop(lambda) {
    camLambda = lambda;
    inertiaActive = false;
    if (prefersReducedMotion) {
      state.tx = camTarget.tx;
      state.ty = camTarget.ty;
      state.scale = camTarget.scale;
      applyTransform();
      return;
    }
    if (!camRaf) {
      camLastTs = 0;
      camRaf = requestAnimationFrame(stepCameraFrame);
    }
  }

  function zoomAroundSvgPoint(px, py, factor, lambda, snapOne) {
    const curScale = camTarget.scale;
    let nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, curScale * factor));
    if (snapOne && ((curScale < 1 && nextScale > 1) || (curScale > 1 && nextScale < 1))) {
      nextScale = 1;
    }
    const ratio = nextScale / curScale;
    camTarget.tx = px - (px - camTarget.tx) * ratio;
    camTarget.ty = py - (py - camTarget.ty) * ratio;
    camTarget.scale = nextScale;
    kickCameraLoop(lambda);
  }

  function zoomByButton(dir) {
    const svg = document.getElementById("diagram-svg");
    if (!svg) return;
    if (dir === "fit") {
      camTarget.tx = 0;
      camTarget.ty = 0;
      camTarget.scale = 1;
      kickCameraLoop(13);
      return;
    }
    const r = svg.getBoundingClientRect();
    const c = screenToSvg(svg, r.left + r.width / 2, r.top + r.height / 2);
    const step = dir === "in" ? 1.32 : 1 / 1.32;
    zoomAroundSvgPoint(c.x, c.y, step, 14, true);
  }

  function centerCameraOnNode(nodeId) {
    const svg = document.getElementById("diagram-svg");
    const diag = activeDiagram();
    if (!svg || !diag) return;
    const node = diag.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const r = svg.getBoundingClientRect();
    const center = screenToSvg(svg, r.left + r.width / 2, r.top + r.height / 2);
    const targetScale = Math.max(state.scale, 1.15);
    camTarget.scale = Math.min(2.2, targetScale);
    camTarget.tx = center.x - node.x * camTarget.scale;
    camTarget.ty = center.y - node.y * camTarget.scale;
    kickCameraLoop(12);
  }

  function panCameraToMinimapEvent(ev) {
    const mmSvg = document.getElementById("minimap-svg");
    const svg = document.getElementById("diagram-svg");
    if (!mmSvg || !svg) return;
    const pt = screenToSvg(mmSvg, ev.clientX, ev.clientY);
    const r = svg.getBoundingClientRect();
    const center = screenToSvg(svg, r.left + r.width / 2, r.top + r.height / 2);
    camTarget.tx = center.x - pt.x * camTarget.scale;
    camTarget.ty = center.y - pt.y * camTarget.scale;
    kickCameraLoop(18);
  }

  function computeWheelZoomFactor(ev) {
    const mult = ev.deltaMode === 1 ? 26 : ev.deltaMode === 2 ? 240 : 1;
    const raw = ev.deltaY * mult;
    if (ev.ctrlKey) {
      const clamped = Math.max(-45, Math.min(45, raw));
      return Math.exp(-clamped * 0.0105);
    }
    const shaped = Math.sign(raw) * Math.log1p(Math.abs(raw) / 14) * 14;
    return Math.exp(-shaped * 0.0048);
  }
`;
}
