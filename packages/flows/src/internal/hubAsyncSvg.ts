import type { AsyncHandoff, EntityFieldLifecycle } from "./types.ts";

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

function shortFolder(relFile: string): string {
  const parts = relFile.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(Math.max(0, parts.length - 3), parts.length - 1).join("/");
}

interface HubFileNode {
  readonly id: string;
  readonly file: string;
  readonly baseName: string;
  readonly folder: string;
  readonly firstLine: number;
  readonly fieldIdxs: number[];
  readonly editCount: number;
  readonly hasMultiRisk: boolean;
  readonly hasDerived: boolean;
  readonly isWholeDocSink?: boolean;
}

export function renderDataHubSvg(entityName: string, fields: readonly EntityFieldLifecycle[]): string {
  const shown = fields.slice(0, 16);
  const writerByFile = new Map<string, HubFileNode>();
  const readerByFile = new Map<string, HubFileNode>();
  const wholeDocFieldIdxs: number[] = [];

  shown.forEach((f, fIdx) => {
    const seenW = new Set<string>();
    for (const w of f.writers) {
      let node = writerByFile.get(w.file);
      if (!node) {
        node = {
          id: `wf:${w.file}`,
          file: w.file,
          baseName: w.file.split("/").pop() ?? w.file,
          folder: shortFolder(w.file),
          firstLine: w.line,
          fieldIdxs: [],
          editCount: 0,
          hasMultiRisk: false,
          hasDerived: false,
        };
        writerByFile.set(w.file, node);
      }
      const nextEdits = node.editCount + 1;
      const nextMulti = node.hasMultiRisk || f.multiWriterRisk;
      const nextLine = Math.min(node.firstLine, w.line);
      if (!seenW.has(w.file)) {
        seenW.add(w.file);
        node.fieldIdxs.push(fIdx);
      }
      writerByFile.set(w.file, {
        ...node,
        editCount: nextEdits,
        hasMultiRisk: nextMulti,
        firstLine: nextLine,
      });
    }

    if (f.readers.length === 0) {
      wholeDocFieldIdxs.push(fIdx);
    } else {
      const seenR = new Set<string>();
      for (const r of f.readers) {
        let node = readerByFile.get(r.file);
        if (!node) {
          node = {
            id: `rf:${r.file}`,
            file: r.file,
            baseName: r.file.split("/").pop() ?? r.file,
            folder: shortFolder(r.file),
            firstLine: r.line,
            fieldIdxs: [],
            editCount: 0,
            hasMultiRisk: false,
            hasDerived: false,
          };
          readerByFile.set(r.file, node);
        }
        if (!seenR.has(r.file)) {
          seenR.add(r.file);
          node.fieldIdxs.push(fIdx);
        }
        readerByFile.set(r.file, {
          ...node,
          editCount: node.editCount + 1,
          hasDerived: node.hasDerived || r.derived,
          firstLine: Math.min(node.firstLine, r.line),
        });
      }
    }
  });

  const avgIdx = (n: HubFileNode): number =>
    n.fieldIdxs.length === 0 ? 0 : n.fieldIdxs.reduce((s, v) => s + v, 0) / n.fieldIdxs.length;

  const writerFiles = Array.from(writerByFile.values())
    .sort((a, b) => avgIdx(a) - avgIdx(b) || b.fieldIdxs.length - a.fieldIdxs.length || a.baseName.localeCompare(b.baseName))
    .slice(0, 22);

  const readerFiles = Array.from(readerByFile.values())
    .sort((a, b) => avgIdx(a) - avgIdx(b) || b.fieldIdxs.length - a.fieldIdxs.length || a.baseName.localeCompare(b.baseName))
    .slice(0, 18);

  if (wholeDocFieldIdxs.length > 0) {
    readerFiles.push({
      id: "rf:__whole_doc__",
      file: "",
      baseName: "whole-doc reads",
      folder: "no field-specific reader",
      firstLine: 1,
      fieldIdxs: wholeDocFieldIdxs,
      editCount: wholeDocFieldIdxs.length,
      hasMultiRisk: false,
      hasDerived: false,
      isWholeDocSink: true,
    });
  }

  const rowH = 44;
  const cardH = 34;
  const topPad = 38;
  const maxRows = Math.max(1, shown.length, writerFiles.length, readerFiles.length);
  const contentH = maxRows * rowH;
  const width = 860;
  const height = Math.max(190, topPad + contentH + 20);

  const colOffset = (count: number): number =>
    topPad + Math.round(((maxRows - Math.max(1, count)) * rowH) / 2);
  const leftOff = colOffset(writerFiles.length);
  const midOff = colOffset(shown.length);
  const rightOff = colOffset(readerFiles.length);

  const leftX = 12;
  const leftW = 224;
  const midX = 324;
  const midW = 212;
  const rightX = 624;
  const rightW = 224;

  const fieldY = (i: number): number => midOff + i * rowH;
  const writerY = (i: number): number => leftOff + i * rowH;
  const readerY = (i: number): number => rightOff + i * rowH;

  const realReaderCount = readerFiles.filter((r) => !r.isWholeDocSink).length;
  const writerHeaderColor = writerFiles.length >= 3 ? "#f59e0b" : writerFiles.length === 1 ? "#5fd9a0" : "#94a3b8";
  const hubShapeBadge =
    writerFiles.length === 1
      ? " · clean 1-writer bow-tie"
      : writerFiles.length >= 3
        ? ` · ${writerFiles.length} writers (scattered)`
        : "";
  const parts: string[] = [
    `<svg class="rs-flow-svg rs-hub-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><marker id="dh-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#94a3b8"/></marker><marker id="dh-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#f59e0b"/></marker><marker id="dh-read" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#38bdf8"/></marker></defs>`,
    `<text x="${leftX + leftW / 2}" y="20" text-anchor="middle" fill="${writerHeaderColor}" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">WHO CHANGES IT (${writerFiles.length} FILE${writerFiles.length === 1 ? "" : "S"})</text>`,
    `<text x="${midX + midW / 2}" y="20" text-anchor="middle" fill="#e2e8f0" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">MODEL: ${esc(entityName)}${esc(hubShapeBadge)}</text>`,
    `<text x="${rightX + rightW / 2}" y="20" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">WHO READS IT (${realReaderCount} FILE${realReaderCount === 1 ? "" : "S"})</text>`,
    `<rect x="${midX - 10}" y="${midOff - 8}" width="${midW + 20}" height="${Math.max(64, shown.length * rowH + 6)}" rx="9" fill="rgba(148,163,184,0.05)" stroke="#334155"/>`,
  ];

  const edgeParts: string[] = [];
  writerFiles.forEach((wf, wi) => {
    const sy = writerY(wi) + cardH / 2;
    for (const fIdx of wf.fieldIdxs) {
      const f = shown[fIdx];
      if (!f) continue;
      const ty = fieldY(fIdx) + cardH / 2;
      const sx = leftX + leftW;
      const tx = midX - 2;
      const cx1 = sx + 38;
      const cx2 = tx - 38;
      const stroke = f.multiWriterRisk ? "#f59e0b" : "#5fd9a0";
      const marker = f.multiWriterRisk ? "dh-warn" : "dh-arr";
      edgeParts.push(
        `<path class="rs-hub-edge" data-hub-src="${esc(wf.id)}" data-hub-fld="${fIdx}" d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}" fill="none" stroke="${stroke}" stroke-width="${f.multiWriterRisk ? "1.6" : "1.2"}" stroke-opacity="${f.multiWriterRisk ? "0.72" : "0.52"}" marker-end="url(#${marker})"/>`,
      );
    }
  });

  readerFiles.forEach((rf, ri) => {
    const ty = readerY(ri) + cardH / 2;
    for (const fIdx of rf.fieldIdxs) {
      const f = shown[fIdx];
      if (!f) continue;
      const sy = fieldY(fIdx) + cardH / 2;
      const sx = midX + midW;
      const tx = rightX - 2;
      const cx1 = sx + 38;
      const cx2 = tx - 38;
      const isSink = Boolean(rf.isWholeDocSink);
      const stroke = isSink ? "#475569" : "#38bdf8";
      edgeParts.push(
        `<path class="rs-hub-edge" data-hub-dst="${esc(rf.id)}" data-hub-fld="${fIdx}" d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}" fill="none" stroke="${stroke}" stroke-width="${isSink ? "1" : "1.5"}" stroke-opacity="${isSink ? "0.3" : "0.68"}"${isSink ? ' stroke-dasharray="3 3"' : ' marker-end="url(#dh-read)"'}/>`,
      );
    }
  });

  parts.push(`<g class="rs-hub-edges">${edgeParts.join("")}</g>`);

  writerFiles.forEach((wf, wi) => {
    const y = writerY(wi);
    const stroke = wf.hasMultiRisk ? "#f59e0b" : "#22c55e";
    const fill = wf.hasMultiRisk ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.10)";
    const sub = `${trunc(wf.folder, 20)} · ${wf.fieldIdxs.length}f`;
    parts.push(
      `<g class="rs-hub-node rs-hub-file" data-hub-file-id="${esc(wf.id)}" data-flow-jump-file="${esc(wf.file)}" data-flow-jump-line="${wf.firstLine}" style="cursor:pointer">`,
      `<title>${esc(`${wf.file}:${wf.firstLine} — edits ${wf.fieldIdxs.length} field(s) (${wf.editCount} site(s)) — click to open code`)}</title>`,
      `<rect x="${leftX}" y="${y}" width="${leftW}" height="${cardH}" rx="6" fill="${fill}" stroke="${stroke}"/>`,
      `<text x="${leftX + 10}" y="${y + 15}" fill="#e8ecf4" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(wf.baseName, 26))}</text>`,
      `<text x="${leftX + 10}" y="${y + 27}" fill="#94a3b8" font-size="8.2" font-family="ui-monospace,monospace">${esc(sub)}</text>`,
      `</g>`,
    );
  });

  shown.forEach((f, fIdx) => {
    const y = fieldY(fIdx);
    const stroke = f.multiWriterRisk ? "#f59e0b" : f.derivedOnRead ? "#38bdf8" : "#22c55e";
    const fill = f.multiWriterRisk ? "rgba(245,158,11,0.14)" : f.derivedOnRead ? "rgba(56,189,248,0.14)" : "rgba(34,197,94,0.12)";
    const writerCount = new Set(f.writers.map((w) => w.file)).size;
    const fieldKey = `${entityName}::${f.field}`;
    const firstFile = f.writers[0]?.file ?? f.readers[0]?.file ?? ".";
    const firstLine = f.writers[0]?.line ?? f.readers[0]?.line ?? 1;
    const sub = f.derivedOnRead
      ? `${writerCount} files · computed on read`
      : `${writerCount} file${writerCount === 1 ? "" : "s"} · ${f.writers.length} edit${f.writers.length === 1 ? "" : "s"}`;
    parts.push(
      `<g class="rs-hub-node rs-hub-field" data-hub-fld-idx="${fIdx}" data-hub-field="${esc(fieldKey)}" data-first-file="${esc(firstFile)}" data-first-line="${firstLine}" style="cursor:pointer">`,
      `<title>${esc(`${entityName}.${f.field} — edited in ${writerCount} file(s), ${f.readers.length} direct reader(s) — click to inspect`)}</title>`,
      `<rect x="${midX}" y="${y}" width="${midW}" height="${cardH}" rx="6" fill="${fill}" stroke="${stroke}"${f.derivedOnRead ? ' stroke-dasharray="3 2"' : ""}/>`,
      `<text x="${midX + midW / 2}" y="${y + 15}" text-anchor="middle" fill="#f8fafc" font-size="9.8" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(f.field, 25))}</text>`,
      `<text x="${midX + midW / 2}" y="${y + 27}" text-anchor="middle" fill="#94a3b8" font-size="8.2" font-family="ui-monospace,monospace">${esc(sub)}</text>`,
      `</g>`,
    );
  });

  readerFiles.forEach((rf, ri) => {
    const y = readerY(ri);
    const isSink = Boolean(rf.isWholeDocSink);
    const stroke = isSink ? "#475569" : "#38bdf8";
    const fill = isSink ? "rgba(148,163,184,0.07)" : "rgba(56,189,248,0.12)";
    const sub = isSink ? `${rf.fieldIdxs.length} fields · whole doc` : `${trunc(rf.folder, 20)} · ${rf.fieldIdxs.length}f`;
    const jumpAttrs = isSink ? "" : ` data-flow-jump-file="${esc(rf.file)}" data-flow-jump-line="${rf.firstLine}" style="cursor:pointer"`;
    parts.push(
      `<g class="rs-hub-node rs-hub-reader" data-hub-reader-id="${esc(rf.id)}"${jumpAttrs}>`,
      `<title>${esc(isSink ? "Fields read as part of full Firestore documents without a dedicated field projection" : `${rf.file}:${rf.firstLine} — reads/derives ${rf.fieldIdxs.length} field(s) — click to open code`)}</title>`,
      `<rect x="${rightX}" y="${y}" width="${rightW}" height="${cardH}" rx="6" fill="${fill}" stroke="${stroke}"${isSink ? ' stroke-dasharray="3 2"' : ""}/>`,
      `<text x="${rightX + 10}" y="${y + 15}" fill="${isSink ? "#94a3b8" : "#e8ecf4"}" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(rf.baseName, 26))}</text>`,
      `<text x="${rightX + 10}" y="${y + 27}" fill="#94a3b8" font-size="8.2" font-family="ui-monospace,monospace">${esc(sub)}</text>`,
      `</g>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("");
}

export function renderAsyncHandoffsSvg(handoffs: readonly AsyncHandoff[]): string {
  const shown = handoffs.slice(0, 24);
  const rowH = 44;
  const width = 760;
  const height = Math.max(130, 36 + shown.length * rowH + 14);
  const parts: string[] = [
    `<svg class="rs-flow-svg" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">`,
    `<defs><marker id="ah-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#c084fc"/></marker></defs>`,
    `<text x="118" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">WHAT FIRES IT</text>`,
    `<text x="380" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">BACKGROUND CHANNEL</text>`,
    `<text x="642" y="18" text-anchor="middle" fill="#94a3b8" font-size="9.5" font-weight="700" font-family="ui-monospace,monospace">WHAT HANDLES IT</text>`,
  ];

  shown.forEach((h, idx) => {
    const y = 30 + idx * rowH;
    const color = h.delivery === "best-effort" ? "#f59e0b" : "#38bdf8";
    const prodFile = h.producer.file.split("/").pop() ?? h.producer.file;
    const consFile = h.consumer ? (h.consumer.file.split("/").pop() ?? h.consumer.file) : "";
    const deliveryTxt =
      h.transport === "fcm"
        ? "push · best-effort"
        : h.transport === "cron"
          ? "cron · scheduled"
          : `${h.transport} · ${h.delivery}`;
    const unmatchedTitle =
      h.transport === "fcm"
        ? "mobile app (push)"
        : h.transport === "cron"
          ? "HTTP job (dynamic URL)"
          : "external listener";
    const unmatchedSub =
      h.transport === "fcm"
        ? "handled outside backend"
        : h.transport === "cron"
          ? "URL defined via Terraform var"
          : "outside this repository";
    parts.push(
      `<g class="rs-async-row" data-async-idx="${idx}" style="cursor:pointer">`,
      `<title>${esc(`${h.producer.fn} -> ${h.channel} -> ${h.consumer?.fn ?? unmatchedTitle} — click to inspect code`)}</title>`,
      `<rect x="10" y="${y}" width="216" height="32" rx="5" fill="rgba(56,189,248,0.12)" stroke="#38bdf8"/>`,
      `<text x="118" y="${y + 14}" text-anchor="middle" fill="#e2e8f0" font-size="9.2" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(h.producer.fn, 28))}</text>`,
      `<text x="118" y="${y + 25}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${esc(trunc(prodFile, 24))}:${h.producer.line}</text>`,
      `<line x1="226" y1="${y + 16}" x2="278" y2="${y + 16}" stroke="#c084fc" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#ah-arr)"/>`,
      `<rect x="280" y="${y}" width="200" height="32" rx="16" fill="rgba(192,132,252,0.12)" stroke="${color}"/>`,
      `<text x="380" y="${y + 14}" text-anchor="middle" fill="#e9d5ff" font-size="9" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(h.channel, 28))}</text>`,
      `<text x="380" y="${y + 25}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${esc(deliveryTxt)}</text>`,
      `<line x1="480" y1="${y + 16}" x2="532" y2="${y + 16}" stroke="#c084fc" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#ah-arr)"/>`,
      `<rect x="534" y="${y}" width="216" height="32" rx="5" fill="${h.consumer ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.08)"}" stroke="${h.consumer ? "#22c55e" : "#475569"}"${h.consumer ? "" : ' stroke-dasharray="3 2"'}/>`,
      `<text x="642" y="${y + 14}" text-anchor="middle" fill="${h.consumer ? "#86efac" : "#94a3b8"}" font-size="9.2" font-weight="700" font-family="ui-monospace,monospace">${esc(trunc(h.consumer ? h.consumer.fn : unmatchedTitle, 28))}</text>`,
      `<text x="642" y="${y + 25}" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="ui-monospace,monospace">${h.consumer ? `${esc(trunc(consFile, 24))}:${h.consumer.line}` : unmatchedSub}</text>`,
      `</g>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("");
}
