import type {
  AsyncHandoff,
  EntityFieldLifecycle,
  ExtractedStateMachine,
  FlowAnalysisBundle,
  FlowLane,
  FlowStep,
  WorkFlowRecord,
} from "./types.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

const LANE_META: Record<FlowLane, { label: string; sub: string }> = {
  client: { label: "Client", sub: "caller / HTTP" },
  handler: { label: "Handler", sub: "entrypoint" },
  cache: { label: "Cache", sub: "in-mem / redis" },
  datastore: { label: "Datastore", sub: "DB reads/writes" },
  external: { label: "External API", sub: "3rd-party HTTP" },
  async_push: { label: "Async / Push", sub: "queue / FCM" },
};

const LANE_ORDER: readonly FlowLane[] = ["client", "handler", "cache", "datastore", "external", "async_push"];

function opColors(op: FlowStep["op"]): { fill: string; stroke: string; text: string; prefix: string } {
  if (op === "db_read" || op === "cache_read") {
    return { fill: "rgba(56,189,248,0.16)", stroke: "#38bdf8", text: "#7dd3fc", prefix: "R:" };
  }
  if (op === "db_write" || op === "tx_commit") {
    return { fill: "rgba(245,158,11,0.18)", stroke: "#f59e0b", text: "#fcd34d", prefix: op === "tx_commit" ? "TX:" : "W:" };
  }
  if (op === "cache_del") {
    return { fill: "rgba(168,85,247,0.18)", stroke: "#a855f7", text: "#d8b4fe", prefix: "DEL:" };
  }
  if (op === "external_http") {
    return { fill: "rgba(239,68,68,0.18)", stroke: "#ef4444", text: "#fca5a5", prefix: "EXT:" };
  }
  if (op === "notify" || op === "async_enqueue") {
    return { fill: "rgba(244,114,182,0.16)", stroke: "#f472b6", text: "#f9a8d4", prefix: op === "notify" ? "PUSH:" : "ENQ:" };
  }
  if (op === "response_send") {
    return { fill: "rgba(34,197,94,0.20)", stroke: "#22c55e", text: "#86efac", prefix: "200" };
  }
  return { fill: "rgba(148,163,184,0.16)", stroke: "#94a3b8", text: "#cbd5e1", prefix: "" };
}

export function renderWorkFlowSwimlaneSvg(flow: WorkFlowRecord): string {
  const visibleSteps = flow.steps.filter((s) => s.op !== "span").slice(0, 12);
  const usedLanes = new Set<FlowLane>(["handler"]);
  if (flow.triggerKind === "http" || flow.responseStepIndex !== null) usedLanes.add("client");
  for (const s of visibleSteps) usedLanes.add(s.lane);
  const lanes = LANE_ORDER.filter((l) => usedLanes.has(l));

  interface StepColumn {
    steps: FlowStep[];
    parallel: boolean;
  }
  const cols: StepColumn[] = [];
  for (const st of visibleSteps) {
    const prev = cols[cols.length - 1];
    if (st.parallelGroup !== undefined && prev && prev.parallel && prev.steps[0]?.parallelGroup === st.parallelGroup) {
      prev.steps.push(st);
    } else {
      cols.push({ steps: [st], parallel: st.parallelGroup !== undefined });
    }
  }

  const leftPad = 114;
  const colW = 86;
  const colGap = 12;
  const laneH = 62;
  const topPad = 36;
  const width = Math.max(680, leftPad + Math.max(cols.length, 4) * (colW + colGap) + 84);
  const height = topPad + lanes.length * laneH + 26;
  const laneY = new Map<FlowLane, number>();
  lanes.forEach((l, idx) => laneY.set(l, topPad + idx * laneH));

  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><marker id="rs-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#94a3b8"/></marker><marker id="rs-arr-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#ef4444"/></marker></defs>`,
  ];

  const colX = (ci: number): number => leftPad + ci * (colW + colGap);
  const resColIdx = cols.findIndex((c) => c.steps.some((s) => s.op === "response_send"));
  const commitColIdx = cols.findIndex((c) => c.steps.some((s) => s.index === flow.commitStepIndex));

  const hasOrderRace = flow.hazards.some(
    (h) => h.kind === "notify_before_commit" || h.kind === "invalidate_before_write",
  );
  if (hasOrderRace && commitColIdx > 0) {
    const firstRaceStep = flow.hazards.find(
      (h) => h.kind === "notify_before_commit" || h.kind === "invalidate_before_write",
    )?.stepIndexes[0];
    const startCol = Math.max(
      0,
      cols.findIndex((c) => c.steps.some((s) => s.index === firstRaceStep)),
    );
    const rx = colX(startCol) - 6;
    const rw = Math.max(60, colX(commitColIdx) - rx);
    parts.push(
      `<rect x="${rx}" y="${topPad - 10}" width="${rw}" height="${lanes.length * laneH + 8}" rx="6" fill="rgba(239,68,68,0.11)" stroke="#ef4444" stroke-dasharray="4 3"/>`,
      `<text x="${rx + rw / 2}" y="${topPad - 16}" text-anchor="middle" fill="#f87171" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">RACE WINDOW BEFORE COMMIT</text>`,
    );
  } else if (resColIdx >= 0) {
    const wallX = colX(resColIdx) + colW / 2;
    parts.push(
      `<rect x="${leftPad - 6}" y="${topPad - 8}" width="${Math.max(40, wallX - leftPad + 4)}" height="${lanes.length * laneH + 6}" rx="6" fill="rgba(245,158,11,0.05)"/>`,
      `<rect x="${wallX + 6}" y="${topPad - 8}" width="${Math.max(58, width - wallX - 14)}" height="${lanes.length * laneH + 6}" rx="6" fill="rgba(34,197,94,0.06)" stroke="#334155" stroke-dasharray="3 3"/>`,
      `<text x="${leftPad}" y="${topPad - 15}" fill="#fbbf24" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">BLOCKING CRITICAL PATH (${flow.serialAwaitCount} serial awaits)</text>`,
      `<text x="${Math.min(width - 42, wallX + 36)}" y="${topPad - 15}" fill="#4ade80" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">ASYNC</text>`,
    );
  }

  for (const lane of lanes) {
    const y = laneY.get(lane) ?? topPad;
    const meta = LANE_META[lane];
    parts.push(
      `<line x1="0" y1="${y + laneH}" x2="${width}" y2="${y + laneH}" stroke="rgba(148,163,184,0.18)" stroke-width="1"/>`,
      `<text x="6" y="${y + 27}" fill="#cbd5e1" font-size="10.5" font-weight="700" font-family="ui-monospace,monospace">${esc(meta.label)}</text>`,
      `<text x="6" y="${y + 40}" fill="#64748b" font-size="9" font-family="ui-monospace,monospace">${esc(meta.sub)}</text>`,
    );
  }

  const handlerY = (laneY.get("handler") ?? topPad) + 28;
  const spineEnd = cols.length > 0 ? colX(cols.length - 1) + colW : leftPad + 120;
  parts.push(
    `<rect x="${leftPad}" y="${handlerY - 5}" width="${Math.max(60, spineEnd - leftPad)}" height="10" rx="3" fill="rgba(148,163,184,0.14)" stroke="rgba(148,163,184,0.3)"/>`,
  );

  if (commitColIdx >= 0) {
    const cx = colX(commitColIdx);
    parts.push(
      `<line x1="${cx - 4}" y1="${topPad - 8}" x2="${cx - 4}" y2="${topPad + lanes.length * laneH}" stroke="#f59e0b" stroke-width="1.8"/>`,
    );
  }
  if (resColIdx >= 0) {
    const rx = colX(resColIdx) + colW / 2;
    parts.push(
      `<line x1="${rx}" y1="${topPad - 8}" x2="${rx}" y2="${topPad + lanes.length * laneH}" stroke="#22c55e" stroke-width="1.8" stroke-dasharray="5 3"/>`,
    );
  }

  const hazardStepSet = new Set<number>(flow.hazards.flatMap((h) => h.stepIndexes));

  cols.forEach((col, ci) => {
    const x = colX(ci);
    const midX = x + colW / 2;
    if (col.parallel && col.steps.length > 1) {
      const ys = col.steps.map((s) => laneY.get(s.lane) ?? topPad);
      const minY = Math.min(...ys) + 8;
      const maxY = Math.max(...ys) + laneH - 8;
      parts.push(
        `<rect x="${x - 4}" y="${minY}" width="${colW + 8}" height="${Math.max(36, maxY - minY)}" rx="6" fill="none" stroke="#22c55e" stroke-dasharray="3 2"/>`,
      );
    }

    col.steps.forEach((st, si) => {
      const ly = laneY.get(st.lane) ?? topPad;
      const barY = ly + (col.steps.length > 1 ? 8 + si * 24 : 15);
      const barH = col.steps.length > 1 ? 22 : 30;
      const colors = opColors(st.op);
      const isHazard = hazardStepSet.has(st.index);
      const stroke = isHazard ? "#ef4444" : colors.stroke;
      const shortFn = trunc(st.fn.split(".").pop() ?? st.fn, 11);
      const label = colors.prefix ? `${colors.prefix} ${shortFn}` : shortFn;
      const latTxt = st.latencyMsP95 !== undefined ? `${st.latencyMsP95}ms` : `:${st.line}`;

      if (st.lane !== "handler") {
        const y1 = barY > handlerY ? handlerY + 5 : handlerY - 5;
        const y2 = barY > handlerY ? barY - 2 : barY + barH + 2;
        parts.push(
          `<line x1="${midX}" y1="${y1}" x2="${midX}" y2="${y2}" stroke="${isHazard ? "#ef4444" : "#64748b"}" stroke-width="1.3"${st.afterResponse ? ' stroke-dasharray="3 2"' : ""} marker-end="url(#${isHazard ? "rs-arr-r" : "rs-arr"})"/>`,
        );
      }

      parts.push(
        `<g class="rs-step-node" data-open-file="${esc(st.file)}" data-open-file-line="${st.line}" style="cursor:pointer">`,
        `<title>${esc(`${st.fn} (${st.file}:${st.line}) [${st.op}]`)}</title>`,
        `<rect x="${x}" y="${barY}" width="${colW}" height="${barH}" rx="5" fill="${colors.fill}" stroke="${stroke}" stroke-width="${isHazard ? "1.8" : "1.2"}"/>`,
        `<text x="${midX}" y="${barY + (barH > 24 ? 13 : 14)}" text-anchor="middle" fill="${colors.text}" font-size="9" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(label, 13))}</text>`,
        barH > 24
          ? `<text x="${midX}" y="${barY + 24}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${esc(latTxt)}</text>`
          : "",
        `</g>`,
      );
    });
  });

  parts.push(`</svg>`);
  return parts.join("");
}

export function renderDataHubSvg(entityName: string, fields: readonly EntityFieldLifecycle[]): string {
  const shown = fields.slice(0, 6);
  const rowH = 44;
  const width = 696;
  const height = Math.max(180, 44 + shown.length * rowH + 20);
  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><marker id="dh-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#94a3b8"/></marker><marker id="dh-err" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#ef4444"/></marker></defs>`,
    `<text x="92" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">WRITERS (MUTATORS)</text>`,
    `<text x="348" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">ENTITY HUB: ${esc(entityName)}</text>`,
    `<text x="604" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">READERS / DERIVATIONS</text>`,
    `<rect x="248" y="28" width="200" height="${Math.max(80, shown.length * rowH + 10)}" rx="8" fill="rgba(148,163,184,0.06)" stroke="#334155"/>`,
  ];

  shown.forEach((f, idx) => {
    const y = 36 + idx * rowH;
    const stroke = f.multiWriterRisk ? "#ef4444" : f.derivedOnRead ? "#38bdf8" : "#22c55e";
    const fill = f.multiWriterRisk ? "rgba(239,68,68,0.14)" : f.derivedOnRead ? "rgba(56,189,248,0.14)" : "rgba(34,197,94,0.12)";
    const writerFiles = new Set(f.writers.map((w) => w.file)).size;
    const writerLabel =
      f.writers.length === 0
        ? "no static writer"
        : writerFiles === 1
          ? trunc(f.writers[0]?.fn ?? "writer", 20)
          : `${writerFiles} files (${f.writers.length} sites)`;
    const readerLabel =
      f.readers.length === 0
        ? "direct doc reads"
        : trunc(f.readers.map((r) => r.fn).slice(0, 2).join(", "), 22);
    const firstW = f.writers[0];
    const firstR = f.readers[0];

    parts.push(
      `<g data-open-file="${esc(firstW?.file ?? ".")}" data-open-file-line="${firstW?.line ?? 1}" style="cursor:pointer">`,
      `<rect x="10" y="${y}" width="170" height="34" rx="5" fill="${fill}" stroke="${stroke}"/>`,
      `<text x="95" y="${y + 15}" text-anchor="middle" fill="#e2e8f0" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">${esc(writerLabel)}</text>`,
      `<text x="95" y="${y + 27}" text-anchor="middle" fill="#94a3b8" font-size="8.2" font-family="ui-monospace,monospace">${f.multiWriterRisk ? "multi-writer risk" : "writer"}</text>`,
      `</g>`,
      `<path d="M180,${y + 17} C214,${y + 17} 222,${y + 17} 256,${y + 17}" fill="none" stroke="${stroke}" stroke-width="${f.multiWriterRisk ? "2" : "1.4"}" marker-end="url(#${f.multiWriterRisk ? "dh-err" : "dh-arr"})"/>`,
      `<rect x="258" y="${y}" width="180" height="34" rx="5" fill="${fill}" stroke="${stroke}"${f.derivedOnRead ? ' stroke-dasharray="3 2"' : ""}/>`,
      `<text x="348" y="${y + 15}" text-anchor="middle" fill="#f8fafc" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(f.field, 24))}</text>`,
      `<text x="348" y="${y + 27}" text-anchor="middle" fill="#94a3b8" font-size="8.2" font-family="ui-monospace,monospace">${f.derivedOnRead ? "read-time derived" : `${f.writers.length}W · ${f.readers.length}R`}</text>`,
      `<path d="M438,${y + 17} C472,${y + 17} 480,${y + 17} 514,${y + 17}" fill="none" stroke="#94a3b8" stroke-width="1.4" marker-end="url(#dh-arr)"/>`,
      `<g data-open-file="${esc(firstR?.file ?? firstW?.file ?? ".")}" data-open-file-line="${firstR?.line ?? 1}" style="cursor:pointer">`,
      `<rect x="516" y="${y}" width="170" height="34" rx="5" fill="rgba(148,163,184,0.1)" stroke="#475569"/>`,
      `<text x="601" y="${y + 15}" text-anchor="middle" fill="#cbd5e1" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">${esc(readerLabel)}</text>`,
      `<text x="601" y="${y + 27}" text-anchor="middle" fill="#94a3b8" font-size="8.2" font-family="ui-monospace,monospace">${f.derivedOnRead ? "pure projection" : "consumer"}</text>`,
      `</g>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("");
}

export function renderStateMachineSvg(machine: ExtractedStateMachine): string {
  const outCount = new Map<string, number>();
  for (const tr of machine.transitions) {
    outCount.set(tr.from, (outCount.get(tr.from) ?? 0) + 1);
  }
  const states = [...machine.states]
    .sort((a, b) => Number((outCount.get(a) ?? 0) === 0) - Number((outCount.get(b) ?? 0) === 0))
    .slice(0, 12);
  const perRow = Math.min(6, Math.max(3, Math.ceil(states.length / 2)));
  const boxW = 96;
  const gapX = 16;
  const rowH = 74;
  const rows = Math.ceil(states.length / perRow);
  const width = Math.max(660, 24 + perRow * (boxW + gapX));
  const height = Math.max(120, 34 + rows * rowH);

  const pos = new Map<string, { x: number; y: number }>();
  states.forEach((st, idx) => {
    const r = Math.floor(idx / perRow);
    const c = r % 2 === 0 ? idx % perRow : perRow - 1 - (idx % perRow);
    pos.set(st, { x: 14 + c * (boxW + gapX), y: 26 + r * rowH });
  });

  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><marker id="sm-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#94a3b8"/></marker><marker id="sm-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#f59e0b"/></marker></defs>`,
  ];

  for (const tr of machine.transitions.slice(0, 24)) {
    const p1 = pos.get(tr.from);
    const p2 = pos.get(tr.to);
    if (!p1 || !p2) continue;
    const x1 = p1.x + boxW / 2;
    const y1 = p1.y + 15;
    const x2 = p2.x + boxW / 2;
    const y2 = p2.y + 15;
    const guarded = Boolean(tr.guard);
    const stroke = guarded ? "#f59e0b" : "#64748b";
    const midX = (x1 + x2) / 2;
    const midY = Math.min(y1, y2) - (Math.abs(x2 - x1) > boxW + gapX + 10 ? 18 : 0);
    const d =
      Math.abs(y1 - y2) < 4 && Math.abs(x2 - x1) <= boxW + gapX + 10
        ? `M${x1 < x2 ? p1.x + boxW : p1.x},${y1} L${x1 < x2 ? p2.x : p2.x + boxW},${y2}`
        : `M${x1},${y1 + 15} Q${midX},${midY} ${x2},${y2}`;
    parts.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${guarded ? "1.7" : "1.1"}"${guarded ? "" : ' stroke-dasharray="3 2"'} marker-end="url(#${guarded ? "sm-g" : "sm-arr"})"/>`,
    );
    if (tr.guard) {
      parts.push(
        `<text x="${midX}" y="${Math.max(12, y1 - 12)}" text-anchor="middle" fill="#fbbf24" font-size="8" font-family="ui-monospace,monospace"><title>${esc(tr.guard)}</title>${esc(trunc(tr.guard, 18))}</text>`,
      );
    }
  }

  for (const st of states) {
    const p = pos.get(st);
    if (!p) continue;
    const isTerminal = (outCount.get(st) ?? 0) === 0;
    const stroke = isTerminal ? "#ef4444" : "#38bdf8";
    const fill = isTerminal ? "rgba(239,68,68,0.14)" : "rgba(56,189,248,0.12)";
    parts.push(
      `<g data-open-file="${esc(machine.file)}" data-open-file-line="${machine.line}" style="cursor:pointer">`,
      `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="30" rx="6" fill="${fill}" stroke="${stroke}"/>`,
      `<text x="${p.x + boxW / 2}" y="${p.y + 19}" text-anchor="middle" fill="#f8fafc" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(st, 13))}</text>`,
      `</g>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

export function renderAsyncHandoffsSvg(handoffs: readonly AsyncHandoff[]): string {
  const shown = handoffs.slice(0, 8);
  const rowH = 44;
  const width = 696;
  const height = Math.max(130, 36 + shown.length * rowH + 14);
  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><marker id="ah-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#f472b6"/></marker></defs>`,
    `<text x="108" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">PRODUCER</text>`,
    `<text x="348" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">ASYNC CHANNEL / DELIVERY</text>`,
    `<text x="588" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">CONSUMER</text>`,
  ];

  shown.forEach((h, idx) => {
    const y = 30 + idx * rowH;
    const color = h.delivery === "best-effort" ? "#f59e0b" : "#38bdf8";
    parts.push(
      `<g data-open-file="${esc(h.producer.file)}" data-open-file-line="${h.producer.line}" style="cursor:pointer">`,
      `<rect x="10" y="${y}" width="196" height="32" rx="5" fill="rgba(56,189,248,0.12)" stroke="#38bdf8"/>`,
      `<text x="108" y="${y + 14}" text-anchor="middle" fill="#e2e8f0" font-size="9.2" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(h.producer.fn, 26))}</text>`,
      `<text x="108" y="${y + 25}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${esc(h.producer.language)} :${h.producer.line}</text>`,
      `</g>`,
      `<line x1="206" y1="${y + 16}" x2="256" y2="${y + 16}" stroke="#f472b6" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#ah-arr)"/>`,
      `<rect x="258" y="${y}" width="180" height="32" rx="16" fill="rgba(244,114,182,0.12)" stroke="${color}"/>`,
      `<text x="348" y="${y + 14}" text-anchor="middle" fill="#f9a8d4" font-size="9" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(h.channel, 24))}</text>`,
      `<text x="348" y="${y + 25}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${esc(h.transport)} · ${esc(h.delivery)}</text>`,
      `<line x1="438" y1="${y + 16}" x2="488" y2="${y + 16}" stroke="#f472b6" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#ah-arr)"/>`,
      `<g data-open-file="${esc(h.consumer?.file ?? h.producer.file)}" data-open-file-line="${h.consumer?.line ?? 1}" style="cursor:pointer">`,
      `<rect x="490" y="${y}" width="196" height="32" rx="5" fill="${h.consumer ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.08)"}" stroke="${h.consumer ? "#22c55e" : "#475569"}"${h.consumer ? "" : ' stroke-dasharray="3 2"'}/>`,
      `<text x="588" y="${y + 14}" text-anchor="middle" fill="${h.consumer ? "#86efac" : "#94a3b8"}" font-size="9.2" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(h.consumer ? h.consumer.fn : "external / unmatched", 26))}</text>`,
      `<text x="588" y="${y + 25}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${h.consumer ? `${esc(h.consumer.language)} :${h.consumer.line}` : "cross-repo or mobile"}</text>`,
      `</g>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("");
}

export function renderFlowsHtmlReport(bundle: FlowAnalysisBundle, title: string): string {
  const topFlows = bundle.workFlows.slice(0, 12);
  const byEntity = new Map<string, EntityFieldLifecycle[]>();
  for (const lf of bundle.entityLifecycles) {
    const arr = byEntity.get(lf.entity) ?? [];
    arr.push(lf);
    byEntity.set(lf.entity, arr);
  }
  const entities = Array.from(byEntity.entries()).slice(0, 6);

  const flowCards = topFlows
    .map(
      (wf) =>
        `<section class="card"><div class="head"><strong>${esc(wf.name)}</strong><span class="mono">${esc(wf.file)}:${wf.line} · ${wf.serialAwaitCount} serial awaits · ${wf.hazards.length} DDIA flags</span></div>${renderWorkFlowSwimlaneSvg(wf)}</section>`,
    )
    .join("");
  const hubCards = entities
    .map(
      ([ent, flds]) =>
        `<section class="card"><div class="head"><strong>${esc(ent)}</strong><span class="mono">${flds.length} tracked fields</span></div>${renderDataHubSvg(ent, flds)}</section>`,
    )
    .join("");
  const smCards = bundle.stateMachines
    .slice(0, 8)
    .map(
      (sm) =>
        `<section class="card"><div class="head"><strong>${esc(sm.name)}</strong><span class="mono">${esc(sm.file)}:${sm.line} · ${sm.states.length} states · ${sm.transitions.length} transitions</span></div>${renderStateMachineSvg(sm)}</section>`,
    )
    .join("");
  const asyncHtml =
    bundle.asyncHandoffs.length > 0
      ? `<section class="card"><div class="head"><strong>Cross-Boundary Async Handoffs</strong><span class="mono">${bundle.asyncHandoffs.length} channels</span></div>${renderAsyncHandoffsSvg(bundle.asyncHandoffs)}</section>`
      : `<section class="card"><p class="mono">No async handoffs extracted.</p></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title><style>body{margin:0;padding:16px;background:#0b1220;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;font-size:13px}.card{background:#111a2c;border:1px solid #1e293b;border-radius:10px;padding:14px 16px;margin-bottom:14px}.head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}.mono{font-family:ui-monospace,monospace;font-size:11px;color:#94a3b8}h2{font-size:14px;margin:18px 0 8px;color:#cbd5e1}</style></head><body><h2>Work Flows (${bundle.workFlows.length})</h2>${flowCards}<h2>Data Lifecycle Hubs (${entities.length})</h2>${hubCards}<h2>State Machines (${bundle.stateMachines.length})</h2>${smCards}<h2>Async Handoffs (${bundle.asyncHandoffs.length})</h2>${asyncHtml}</body></html>`;
}
