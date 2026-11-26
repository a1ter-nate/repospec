import type { ExtractedStateMachine, ExtractedStateTransition } from "./types.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatStateLabel(raw: string): string {
  return raw.replace(/_/g, " ");
}

function buildStateMetrics(machine: ExtractedStateMachine) {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const outEdges = new Map<string, ExtractedStateTransition[]>();
  for (const st of machine.states) {
    inDeg.set(st, 0);
    outDeg.set(st, 0);
    outEdges.set(st, []);
  }
  for (const tr of machine.transitions) {
    if (!inDeg.has(tr.to)) inDeg.set(tr.to, 0);
    if (!outDeg.has(tr.from)) outDeg.set(tr.from, 0);
    inDeg.set(tr.to, (inDeg.get(tr.to) ?? 0) + 1);
    outDeg.set(tr.from, (outDeg.get(tr.from) ?? 0) + 1);
    const list = outEdges.get(tr.from) ?? [];
    list.push(tr);
    outEdges.set(tr.from, list);
  }
  return { inDeg, outDeg, outEdges };
}

function orderStatesBfs(
  states: readonly string[],
  inDeg: Map<string, number>,
  outEdges: Map<string, ExtractedStateTransition[]>,
  excluded: Set<string>,
): string[] {
  const active = states.filter((s) => !excluded.has(s));
  const entries = active.filter((s) => (inDeg.get(s) ?? 0) === 0);
  const roots = entries.length > 0 ? entries : active.slice(0, 1);
  const visited = new Set<string>();
  const ordered: string[] = [];
  const queue = [...roots];
  for (const r of roots) visited.add(r);

  for (let qIdx = 0; qIdx < queue.length; qIdx += 1) {
    const cur = queue[qIdx];
    if (!cur) continue;
    ordered.push(cur);
    const nexts = (outEdges.get(cur) ?? [])
      .map((t) => t.to)
      .filter((t) => !excluded.has(t) && !visited.has(t));
    nexts.sort((a, b) => {
      const aGuarded = (outEdges.get(cur) ?? []).some((t) => t.to === a && Boolean(t.guard)) ? 0 : 1;
      const bGuarded = (outEdges.get(cur) ?? []).some((t) => t.to === b && Boolean(t.guard)) ? 0 : 1;
      return aGuarded - bGuarded || states.indexOf(a) - states.indexOf(b);
    });
    for (const n of nexts) {
      visited.add(n);
      queue.push(n);
    }
  }
  for (const s of active) {
    if (!visited.has(s)) ordered.push(s);
  }
  return ordered;
}

function renderFanOutStatechart(
  machine: ExtractedStateMachine,
  root: string,
  terminals: readonly string[],
  outEdges: Map<string, ExtractedStateTransition[]>,
): string {
  const rowH = 54;
  const padTop = 24;
  const padBot = 24;
  const height = Math.max(160, padTop + terminals.length * rowH + padBot);
  const width = 680;
  const boxW = 148;
  const boxH = 38;
  const rootX = 36;
  const rootY = Math.round(height / 2 - boxH / 2);
  const tgtX = 468;

  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<marker id="sm-fwd" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1.5 L8.5,5 L0,8.5 z" fill="#38bdf8"/></marker>`,
    `<marker id="sm-grd" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1.5 L8.5,5 L0,8.5 z" fill="#f59e0b"/></marker>`,
    `</defs>`,
  ];

  const rootTrs = outEdges.get(root) ?? [];
  terminals.forEach((st, idx) => {
    const ty = padTop + idx * rowH + 6;
    const tr = rootTrs.find((t) => t.to === st);
    const sx = rootX + boxW;
    const sy = rootY + boxH / 2;
    const ex = tgtX;
    const ey = ty + boxH / 2;
    const cx1 = sx + 96;
    const cx2 = ex - 96;
    const guarded = Boolean(tr?.guard);
    const stroke = guarded ? "#f59e0b" : "#38bdf8";
    const lbl = tr?.guard ? `[${trunc(tr.guard, 22)}]` : trunc(tr?.event ?? st, 22);
    const t = 0.66;
    const u = 1 - t;
    const midX = Math.round(u * u * u * sx + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * (ex - 4));
    const midY = Math.round(u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ey + t * t * t * ey);
    const pillW = Math.max(66, lbl.length * 6.2 + 16);

    parts.push(
      `<path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ey} ${ex - 4},${ey}" fill="none" stroke="${stroke}" stroke-width="1.6" marker-end="url(#${guarded ? "sm-grd" : "sm-fwd"})"/>`,
      `<rect x="${midX - pillW / 2}" y="${midY - 10}" width="${pillW}" height="18" rx="9" fill="#0b1120" stroke="${guarded ? "rgba(245,158,11,0.55)" : "rgba(56,189,248,0.35)"}"/>`,
      `<text x="${midX}" y="${midY + 2.5}" text-anchor="middle" fill="${guarded ? "#fcd34d" : "#93c5fd"}" font-size="9.5" font-family="ui-monospace,monospace">${esc(lbl)}</text>`,
    );

    const isOk = /captur|done|complet|active|approv|success/i.test(st);
    const tStroke = isOk ? "#22c55e" : "#f43f5e";
    const tFill = isOk ? "rgba(34,197,94,0.12)" : "rgba(244,63,94,0.11)";
    parts.push(
      `<g class="rs-sm-node" data-sm-state="${esc(`${machine.id}::${st}`)}" style="cursor:pointer">`,
      `<title>${esc(`${machine.name}: ${st} (terminal) — click to inspect`)}</title>`,
      `<rect x="${tgtX}" y="${ty}" width="${boxW}" height="${boxH}" rx="8" fill="${tFill}" stroke="${tStroke}" stroke-width="1.4"/>`,
      `<circle cx="${tgtX + 16}" cy="${ty + boxH / 2}" r="5.5" fill="none" stroke="${tStroke}" stroke-width="1.2"/>`,
      `<circle cx="${tgtX + 16}" cy="${ty + boxH / 2}" r="2.6" fill="${tStroke}"/>`,
      `<text x="${tgtX + 30}" y="${ty + 23}" fill="#f8fafc" font-size="11" font-weight="600" font-family="ui-monospace,monospace">${esc(trunc(formatStateLabel(st), 15))}</text>`,
      `</g>`,
    );
  });

  parts.push(
    `<g class="rs-sm-node" data-sm-state="${esc(`${machine.id}::${root}`)}" style="cursor:pointer">`,
    `<title>${esc(`${machine.name}: ${root} (entry state) — click to inspect`)}</title>`,
    `<rect x="${rootX}" y="${rootY}" width="${boxW}" height="${boxH}" rx="8" fill="rgba(16,185,129,0.14)" stroke="#10b981" stroke-width="1.6"/>`,
    `<text x="${rootX + 12}" y="${rootY + 14}" fill="#6ee7b7" font-size="8" font-weight="700" font-family="ui-monospace,monospace">START</text>`,
    `<text x="${rootX + 12}" y="${rootY + 29}" fill="#f8fafc" font-size="11.5" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(formatStateLabel(root), 15))}</text>`,
    `</g>`,
    `</svg>`,
  );
  return parts.join("");
}

export function renderStateMachineSvg(machine: ExtractedStateMachine): string {
  const { inDeg, outDeg, outEdges } = buildStateMetrics(machine);
  const terminals = machine.states.filter((s) => (outDeg.get(s) ?? 0) === 0);
  const activeCount = machine.states.length - terminals.length;

  if (activeCount === 1 && terminals.length >= 2) {
    const root = machine.states.find((s) => (outDeg.get(s) ?? 0) > 0) ?? machine.states[0];
    if (root) return renderFanOutStatechart(machine, root, terminals, outEdges);
  }

  const universalSinks = new Set(
    terminals.filter((s) => (inDeg.get(s) ?? 0) >= Math.max(3, Math.floor(activeCount * 0.6))),
  );
  const ordered = orderStatesBfs(machine.states, inDeg, outEdges, universalSinks);
  const sideStates = ordered.filter(
    (s) =>
      /return|error|fail|pause|hold|cancel/i.test(s) &&
      ordered.length > 5 &&
      (inDeg.get(s) ?? 0) >= 2 &&
      (outDeg.get(s) ?? 0) <= 2,
  );
  const sideSet = new Set(sideStates);
  const spineStates = ordered.filter((s) => !sideSet.has(s)).slice(0, 10);

  const boxW = 112;
  const boxH = 42;
  const gapX = 36;
  const padX = 24;
  const spineY = 66;
  const width = Math.max(760, padX * 2 + spineStates.length * boxW + Math.max(0, spineStates.length - 1) * gapX);

  const pos = new Map<string, { x: number; y: number; col: number; row: number }>();
  spineStates.forEach((st, ci) => {
    pos.set(st, { x: padX + ci * (boxW + gapX), y: spineY, col: ci, row: 0 });
  });

  const sideY = spineY + 98;
  sideStates.forEach((st, si) => {
    const incomingCols = machine.transitions
      .filter((t) => t.to === st && pos.has(t.from))
      .map((t) => pos.get(t.from)?.col ?? 0);
    const avgCol =
      incomingCols.length > 0
        ? Math.round(incomingCols.reduce((a, b) => a + b, 0) / incomingCols.length)
        : Math.min(spineStates.length - 1, si + 2);
    const sx = padX + avgCol * (boxW + gapX);
    pos.set(st, { x: sx, y: sideY, col: avgCol, row: 1 });
  });

  const hasBus = universalSinks.size > 0;
  const hasSide = sideStates.length > 0;
  const busY = (hasSide ? sideY + boxH + 46 : spineY + boxH + 66);
  const height = hasBus ? busY + 56 : hasSide ? sideY + boxH + 34 : spineY + boxH + 60;

  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<marker id="sm-fwd" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1.5 L8.5,5 L0,8.5 z" fill="#38bdf8"/></marker>`,
    `<marker id="sm-grd" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1.5 L8.5,5 L0,8.5 z" fill="#f59e0b"/></marker>`,
    `<marker id="sm-bck" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1.5 L8.5,5 L0,8.5 z" fill="#64748b"/></marker>`,
    `<marker id="sm-snk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0,1.5 L8.5,5 L0,8.5 z" fill="#f43f5e"/></marker>`,
    `</defs>`,
  ];

  const nonSinkTransitions = machine.transitions.filter((t) => !universalSinks.has(t.to) && !universalSinks.has(t.from));
  let backArcIdx = 0;

  for (const tr of nonSinkTransitions) {
    const p1 = pos.get(tr.from);
    const p2 = pos.get(tr.to);
    if (!p1 || !p2) continue;
    const guarded = Boolean(tr.guard);

    if (p1.row === 0 && p2.row === 0 && p2.col === p1.col + 1) {
      const sx = p1.x + boxW;
      const sy = p1.y + boxH / 2 - 4;
      const ex = p2.x - 3;
      const ey = sy;
      const stroke = guarded ? "#f59e0b" : "#38bdf8";
      parts.push(
        `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="${guarded ? "2" : "1.7"}" marker-end="url(#${guarded ? "sm-grd" : "sm-fwd"})"/>`,
      );
      if (tr.guard) {
        const mx = Math.round((sx + ex) / 2);
        const segs = tr.guard.split("+").map((s) => s.trim()).filter(Boolean);
        const pillText = segs.length > 1 ? `${trunc(segs[0] ?? tr.guard, 10)} +${segs.length - 1}` : trunc(tr.guard, 14);
        const pw = Math.max(52, pillText.length * 5.8 + 14);
        const py = p1.y - 26;
        parts.push(
          `<line x1="${mx}" y1="${py + 16}" x2="${mx}" y2="${sy - 2}" stroke="rgba(245,158,11,0.45)" stroke-width="1" stroke-dasharray="2 2"/>`,
          `<g><title>Guard: ${esc(tr.guard)}</title><rect x="${mx - pw / 2}" y="${py}" width="${pw}" height="16" rx="8" fill="#1c1507" stroke="rgba(245,158,11,0.68)"/><text x="${mx}" y="${py + 11}" text-anchor="middle" fill="#fcd34d" font-size="8.5" font-weight="600" font-family="ui-monospace,monospace">${esc(pillText)}</text></g>`,
        );
      }
      continue;
    }

    if (p1.row === 0 && p2.row === 0 && p2.col === p1.col - 1) {
      const sx = p1.x;
      const sy = p1.y + boxH / 2 + 7;
      const ex = p2.x + boxW + 3;
      parts.push(
        `<path d="M${sx},${sy} Q${(sx + ex) / 2},${sy + 14} ${ex},${sy}" fill="none" stroke="rgba(148,163,184,0.52)" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#sm-bck)"/>`,
      );
      continue;
    }

    if (p1.row === 0 && p2.row === 1) {
      const sx = p1.x + boxW / 2;
      const sy = p1.y + boxH;
      const ex = p2.x + boxW / 2 + (p1.col - p2.col) * 14;
      const ey = p2.y - 3;
      parts.push(
        `<path d="M${sx},${sy} C${sx},${sy + 26} ${ex},${ey - 26} ${ex},${ey}" fill="none" stroke="rgba(245,158,11,0.5)" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#sm-bck)"/>`,
      );
      continue;
    }

    if (p1.row === 1 && p2.row === 0) {
      const sx = p1.x;
      const sy = p1.y + boxH / 2;
      const ex = p2.x + boxW / 2;
      const ey = p2.y + boxH + 4;
      parts.push(
        `<path d="M${sx},${sy} C${ex},${sy} ${ex},${ey + 22} ${ex},${ey}" fill="none" stroke="#38bdf8" stroke-width="1.5" marker-end="url(#sm-fwd)"/>`,
      );
      continue;
    }

    if (p1.row === 0 && p2.row === 0) {
      const span = Math.abs(p1.col - p2.col);
      const goTop = hasSide || p2.col > p1.col;
      const sx = p1.x + boxW / 2;
      const ex = p2.x + boxW / 2;
      const sy = goTop ? p1.y : p1.y + boxH;
      const ey = goTop ? p2.y - 3 : p2.y + boxH + 3;
      const lift = (goTop ? -1 : 1) * (24 + Math.min(34, span * 8 + (backArcIdx % 3) * 8));
      backArcIdx += 1;
      parts.push(
        `<path d="M${sx},${sy} Q${(sx + ex) / 2},${sy + lift} ${ex},${ey}" fill="none" stroke="rgba(148,163,184,0.42)" stroke-width="1.15" stroke-dasharray="3 3" marker-end="url(#sm-bck)"/>`,
      );
    }
  }

  for (const st of [...spineStates, ...sideStates]) {
    const p = pos.get(st);
    if (!p) continue;
    const isStart = (inDeg.get(st) ?? 0) === 0;
    const isTerm = (outDeg.get(st) ?? 0) === 0;
    const isSide = sideSet.has(st);
    const stroke = isStart ? "#10b981" : isTerm ? "#f43f5e" : isSide ? "#f59e0b" : "#38bdf8";
    const fill = isStart
      ? "rgba(16,185,129,0.14)"
      : isTerm
        ? "rgba(244,63,94,0.12)"
        : isSide
          ? "rgba(245,158,11,0.11)"
          : "#11192c";
    const sub = isStart
      ? "START"
      : `${outDeg.get(st) ?? 0} out · ${inDeg.get(st) ?? 0} in`;
    const subColor = isStart ? "#6ee7b7" : "#8793ab";
    parts.push(
      `<g class="rs-sm-node" data-sm-state="${esc(`${machine.id}::${st}`)}" style="cursor:pointer">`,
      `<title>${esc(`${machine.name}: ${st} (${outDeg.get(st) ?? 0} outgoing, ${inDeg.get(st) ?? 0} incoming) — click to inspect`)}</title>`,
      `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${isStart ? "1.6" : "1.3"}"/>`,
      `<text x="${p.x + boxW / 2}" y="${p.y + 18}" text-anchor="middle" fill="#f8fafc" font-size="10.5" font-weight="600" font-family="ui-monospace,monospace">${esc(trunc(formatStateLabel(st), 14))}</text>`,
      `<text x="${p.x + boxW / 2}" y="${p.y + 32}" text-anchor="middle" fill="${subColor}" font-size="8.2" font-family="ui-monospace,monospace">${esc(sub)}</text>`,
      `</g>`,
    );
  }

  if (hasBus) {
    const sinks = Array.from(universalSinks);
    const busX1 = padX + 20;
    const busX2 = width - padX - 180;
    parts.push(
      `<line x1="${busX1}" y1="${busY + 19}" x2="${busX2}" y2="${busY + 19}" stroke="rgba(244,63,94,0.45)" stroke-width="1.4" stroke-dasharray="4 4" marker-end="url(#sm-snk)"/>`,
      `<rect x="${busX1}" y="${busY + 7}" width="218" height="22" rx="11" fill="#180d14" stroke="rgba(244,63,94,0.38)"/>`,
      `<text x="${busX1 + 109}" y="${busY + 21}" text-anchor="middle" fill="#fda4af" font-size="9" font-family="ui-monospace,monospace">any active state (${activeCount}/${activeCount}) →</text>`,
    );
    sinks.forEach((sink, si) => {
      const sx = width - padX - 160 - si * 140;
      parts.push(
        `<g class="rs-sm-node" data-sm-state="${esc(`${machine.id}::${sink}`)}" style="cursor:pointer">`,
        `<title>${esc(`${machine.name}: ${sink} (universal terminal state, ${inDeg.get(sink) ?? 0} incoming transitions)`)}</title>`,
        `<rect x="${sx}" y="${busY}" width="154" height="38" rx="8" fill="rgba(244,63,94,0.14)" stroke="#f43f5e" stroke-width="1.5"/>`,
        `<circle cx="${sx + 16}" cy="${busY + 19}" r="5.5" fill="none" stroke="#f43f5e" stroke-width="1.2"/>`,
        `<circle cx="${sx + 16}" cy="${busY + 19}" r="2.6" fill="#f43f5e"/>`,
        `<text x="${sx + 30}" y="${busY + 16}" fill="#f8fafc" font-size="11" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(formatStateLabel(sink), 14))}</text>`,
        `<text x="${sx + 30}" y="${busY + 29}" fill="#fda4af" font-size="8.2" font-family="ui-monospace,monospace">terminal · ${inDeg.get(sink) ?? 0} in</text>`,
        `</g>`,
      );
    });
  }

  parts.push(`</svg>`);
  return parts.join("");
}
