import type { DiffDiagramEdge, DiffDiagramNode } from "@repospec/plugin-studio";
import type { DrilldownFile } from "@repospec/plugin-studio";
import type { RankedChangedFile, RankedDiagram } from "./ranking.ts";
import { escXml, FONT_MONO, FONT_SANS, paletteFor, truncateText, type ShowMeTheme, type ThemePalette } from "./svgPrimitives.ts";

function edgePathD(e: DiffDiagramEdge): string {
  if (!e || e.points.length < 2) return "";
  const p0 = e.points[0];
  if (!p0) return "";
  if (e.points.length === 4) {
    const [, p1, p2, p3] = e.points;
    if (p1 && p2 && p3) {
      return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
    }
  }
  if (e.points.length === 3) {
    const [, p1, p2] = e.points;
    if (p1 && p2) return `M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`;
  }
  const segs: string[] = [`M ${p0.x} ${p0.y}`];
  for (let i = 1; i < e.points.length; i += 1) {
    const pt = e.points[i];
    if (pt) segs.push(`L ${pt.x} ${pt.y}`);
  }
  return segs.join(" ");
}

function cleanDeltaToken(n: DiffDiagramNode): string {
  if (n.diffStatus === "added") return "NEW";
  if (n.diffStatus === "removed") return "REMOVED";
  if (n.diffStatus === "modified" && n.deltaLabel) {
    return n.deltaLabel.replace("/", " ").replace("-", "−");
  }
  return "";
}

function cleanSublabel(raw?: string): string {
  if (!raw) return "";
  if (raw.startsWith("contains ")) return raw;
  const parts = raw
    .split("·")
    .map((s) => s.replaceAll("⊞", "").trim())
    .filter((s) => s.length > 0 && s !== "PURE");
  return parts.slice(0, 2).join(" · ");
}

function renderNode(n: DiffDiagramNode, p: ThemePalette): string {
  const x = n.x - n.w / 2;
  const y = n.y - n.h / 2;
  const isUnchanged = n.diffStatus === "unchanged";

  if (isUnchanged) {
    const maxChars = Math.max(10, Math.floor((n.w - 20) / 7.1));
    return [
      `<g>`,
      `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="8" fill="${p.cardMutedBg}" stroke="${p.cardStroke}" stroke-width="1" />`,
      `<text x="${x + 12}" y="${y + Math.round(n.h / 2) + 4.5}" font-family="${FONT_SANS}" font-size="12" font-weight="500" fill="${p.textMuted}">${escXml(truncateText(n.label, maxChars))}</text>`,
      "</g>",
    ].join("");
  }

  const isAdded = n.diffStatus === "added";
  const isRemoved = n.diffStatus === "removed";
  const accent = isAdded ? p.added : isRemoved ? p.removed : p.modified;
  const tint = isAdded ? p.addedBg : isRemoved ? p.removedBg : p.modifiedBg;
  const dash = isRemoved ? ' stroke-dasharray="5 3"' : "";
  const token = cleanDeltaToken(n);
  const tokenW = token ? Math.max(38, Math.round(token.length * 6.4 + 12)) : 0;
  const titleMax = Math.max(9, Math.floor((n.w - tokenW - 22) / 7.8));
  const sub = cleanSublabel(n.sublabel);
  const subMax = Math.max(12, Math.floor((n.w - 22) / 6.3));

  const parts: string[] = [
    "<g>",
    `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="9" fill="${p.cardBg}" stroke="${accent}" stroke-width="1.8"${dash} />`,
    `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="9" fill="${tint}" />`,
    `<rect x="${x + 1}" y="${y + 7}" width="3.5" height="${n.h - 14}" rx="1.75" fill="${accent}" />`,
    `<text x="${x + 13}" y="${y + 22}" font-family="${FONT_SANS}" font-size="13.5" font-weight="700" fill="${p.textPrimary}">${escXml(truncateText(n.label, titleMax))}</text>`,
  ];
  if (token) {
    parts.push(
      `<text x="${x + n.w - 10}" y="${y + 21.5}" text-anchor="end" font-family="${FONT_MONO}" font-size="10.5" font-weight="700" fill="${accent}">${escXml(token)}</text>`,
    );
  }
  if (sub) {
    parts.push(
      `<text x="${x + 13}" y="${y + 39}" font-family="${FONT_MONO}" font-size="10.5" fill="${p.textMuted}">${escXml(truncateText(sub, subMax))}</text>`,
    );
  }
  parts.push("</g>");
  return parts.join("");
}

export function renderDiffDiagramSvg(params: {
  ranked: RankedDiagram;
  theme: ShowMeTheme;
}): string {
  const { ranked, theme } = params;
  const p = paletteFor(theme);
  const overlay = ranked.overlay;
  const totalW = Math.max(420, Math.round(overlay.width));
  const totalH = Math.max(96, Math.round(overlay.height));

  const laneCaptions = (overlay.lanes ?? [])
    .map((l) => {
      const label = truncateText(l.label.toUpperCase(), Math.max(10, Math.floor(l.w / 6.8)));
      const folded = ranked.foldedByLane[l.id] ?? 0;
      const chip =
        folded > 0
          ? `<rect x="${l.x}" y="${l.y + l.h - 14}" width="${l.w}" height="22" rx="6" fill="none" stroke="${p.cardStroke}" stroke-width="1" stroke-dasharray="3 3" /><text x="${l.x + l.w / 2}" y="${l.y + l.h + 1}" text-anchor="middle" font-family="${FONT_MONO}" font-size="10.5" fill="${p.textMuted}">+${folded} unchanged</text>`
          : "";
      return `<text x="${l.x + 2}" y="${l.y + 12}" font-family="${FONT_SANS}" font-size="10.5" font-weight="700" fill="${p.caption}" letter-spacing="0.7">${escXml(label)}</text>${chip}`;
    })
    .join("");

  const edgesSvg = [...overlay.edges]
    .map((e) => {
      if (!e) return "";
      const d = edgePathD(e);
      if (!d) return "";
      const isAdd = e.diffStatus === "added";
      const isRem = e.diffStatus === "removed";
      const isViolation = Boolean(e.violation);
      const color = isViolation || isRem ? p.removed : isAdd ? p.added : p.edgeContext;
      const width = isAdd || isRem || isViolation ? 2.2 : 1.1;
      const opacity = isAdd || isRem || isViolation ? 0.96 : 0.36;
      const dash = isRem ? ' stroke-dasharray="5 3"' : "";
      const marker = isViolation || isRem ? "url(#ar-rem)" : isAdd ? "url(#ar-add)" : "url(#ar-ctx)";
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}"${dash} marker-end="${marker}" />`;
    })
    .join("");

  const nodesSvg = [...overlay.nodes].map((n) => (n ? renderNode(n, p) : "")).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    "<defs>",
    `<marker id="ar-ctx" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.edgeContext}" /></marker>`,
    `<marker id="ar-add" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.added}" /></marker>`,
    `<marker id="ar-rem" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.removed}" /></marker>`,
    "</defs>",
    `<rect width="${totalW}" height="${totalH}" rx="10" fill="${p.bg}" />`,
    laneCaptions,
    edgesSvg,
    nodesSvg,
    "</svg>",
  ].join("");
}

function parseHunkLineRanges(hunk?: string): Array<[number, number]> {
  if (!hunk) return [];
  const ranges: Array<[number, number]> = [];
  for (const line of hunk.split("\n")) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = Number.parseInt(m[1] ?? "0", 10);
    const len = Number.parseInt(m[2] ?? "1", 10);
    if (start > 0) ranges.push([start, start + Math.max(1, len) - 1]);
  }
  return ranges;
}

function isRangeTouched(startLine: number, endLine: number, ranges: Array<[number, number]>): boolean {
  for (const [rs, re] of ranges) {
    if (startLine <= re && endLine >= rs) return true;
  }
  return false;
}

export function renderSymbolCardSvg(params: {
  rankedFile: RankedChangedFile;
  drillFile: DrilldownFile;
  theme: ShowMeTheme;
}): string {
  const { rankedFile, drillFile, theme } = params;
  const p = paletteFor(theme);
  const isAddedFile = rankedFile.file.status === "added";
  const ranges = isAddedFile ? [] : parseHunkLineRanges(rankedFile.file.hunk);
  const symbols = (drillFile.m ?? []).slice(0, 18);
  const internalEdges = drillFile.k ?? [];
  const externalEdges = (drillFile.o ?? []).slice(0, 12);

  const pubIdx: number[] = [];
  const privIdx: number[] = [];
  for (let i = 0; i < symbols.length; i += 1) {
    const sym = symbols[i];
    if (!sym) continue;
    if (sym[1] === "pub") pubIdx.push(i);
    else privIdx.push(i);
  }
  const extNames = Array.from(new Set(externalEdges.map((e) => e[1]))).slice(0, 8);

  const columns: Array<{ key: "pub" | "priv" | "ext"; title: string; count: number }> = [];
  if (pubIdx.length > 0) columns.push({ key: "pub", title: `PUBLIC EXPORTS (${pubIdx.length})`, count: pubIdx.length });
  if (privIdx.length > 0) columns.push({ key: "priv", title: `INTERNAL (${privIdx.length})`, count: privIdx.length });
  if (extNames.length > 0) columns.push({ key: "ext", title: `EXTERNAL CALLS (${extNames.length})`, count: extNames.length });

  const totalW = 840;
  const padX = 20;
  const padTop = 36;
  const rowH = 38;
  const cardH = 30;
  const hasCallersChip = rankedFile.file.blastRadius > 0;
  const chipW = hasCallersChip ? 104 : 0;
  const chipGap = hasCallersChip ? 24 : 0;
  const colCount = Math.max(1, columns.length);
  const gutter = colCount >= 3 ? 36 : 48;
  const usableW = totalW - padX * 2 - chipW - chipGap - gutter * (colCount - 1);
  const colW = Math.max(150, Math.min(240, Math.floor(usableW / colCount)));

  const colX = new Map<"pub" | "priv" | "ext", number>();
  columns.forEach((col, idx) => {
    colX.set(col.key, padX + chipW + chipGap + idx * (colW + gutter));
  });

  const maxRows = Math.max(1, ...columns.map((c) => c.count));
  const bodyBottom = padTop + maxRows * rowH;
  const needsUnderPass = columns.length === 3 && externalEdges.some(([from]) => pubIdx.includes(from));
  const channelY = bodyBottom + 14;
  const totalH = Math.round(bodyBottom + (needsUnderPass ? 34 : 18));

  const nodePos = new Map<number, { x: number; y: number; col: "pub" | "priv" }>();
  const extPos = new Map<string, { x: number; y: number }>();

  const pubX = colX.get("pub");
  if (pubX !== undefined) {
    pubIdx.forEach((idx, row) => nodePos.set(idx, { x: pubX, y: padTop + row * rowH, col: "pub" }));
  }
  const privX = colX.get("priv");
  if (privX !== undefined) {
    privIdx.forEach((idx, row) => nodePos.set(idx, { x: privX, y: padTop + row * rowH, col: "priv" }));
  }
  const extX = colX.get("ext");
  if (extX !== undefined) {
    extNames.forEach((name, row) => extPos.set(name, { x: extX, y: padTop + row * rowH }));
  }

  const parts: string[] = [];

  if (hasCallersChip && pubX !== undefined) {
    const cy = padTop + Math.max(0, Math.round(((pubIdx.length - 1) * rowH) / 2));
    const callerLabel = `${rankedFile.file.blastRadius} caller${rankedFile.file.blastRadius === 1 ? "" : "s"}`;
    parts.push(
      `<rect x="${padX}" y="${cy}" width="${chipW}" height="${cardH}" rx="15" fill="${p.cardBg}" stroke="${p.cardStroke}" stroke-width="1.2" />`,
      `<text x="${padX + chipW / 2}" y="${cy + 19}" text-anchor="middle" font-family="${FONT_MONO}" font-size="11" font-weight="600" fill="${p.textSecondary}">${escXml(callerLabel)}</text>`,
      `<line x1="${padX + chipW}" y1="${cy + cardH / 2}" x2="${pubX - 4}" y2="${cy + cardH / 2}" stroke="${p.edgeContext}" stroke-width="1.3" marker-end="url(#sym-ctx)" />`,
    );
  }

  for (const col of columns) {
    const cx = colX.get(col.key) ?? padX;
    parts.push(
      `<text x="${cx + 2}" y="22" font-family="${FONT_SANS}" font-size="10.5" font-weight="700" fill="${p.caption}" letter-spacing="0.7">${escXml(col.title)}</text>`,
    );
  }

  for (const [from, to] of internalEdges) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) continue;
    const edgeColor = isAddedFile ? p.added : p.modified;
    const marker = isAddedFile ? "url(#sym-add)" : "url(#sym-mod)";
    if (a.col === b.col) {
      const y1 = a.y + cardH / 2;
      const y2 = b.y + cardH / 2;
      const arcX = a.x - 16;
      parts.push(
        `<path d="M ${a.x} ${y1} C ${arcX} ${y1}, ${arcX} ${y2}, ${b.x} ${y2}" fill="none" stroke="${edgeColor}" stroke-width="1.4" stroke-opacity="0.78" marker-end="${marker}" />`,
      );
      continue;
    }
    const x1 = a.x + colW;
    const y1 = a.y + cardH / 2;
    const x2 = b.x;
    const y2 = b.y + cardH / 2;
    const mx = (x1 + x2) / 2;
    parts.push(
      `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${edgeColor}" stroke-width="1.5" stroke-opacity="0.82" marker-end="${marker}" />`,
    );
  }

  for (const [from, extName] of externalEdges) {
    const a = nodePos.get(from);
    const b = extPos.get(extName);
    if (!a || !b) continue;
    const crossesMiddle = a.col === "pub" && columns.length === 3;
    if (crossesMiddle) {
      const sx = a.x + colW / 2;
      const sy = a.y + cardH;
      const tx = b.x + colW / 2;
      const ty = b.y + cardH;
      parts.push(
        `<path d="M ${sx} ${sy} C ${sx} ${channelY}, ${tx} ${channelY}, ${tx} ${ty}" fill="none" stroke="${p.edgeContext}" stroke-width="1.2" stroke-opacity="0.55" stroke-dasharray="4 3" marker-end="url(#sym-ctx)" />`,
      );
    } else {
      const x1 = a.x + colW;
      const y1 = a.y + cardH / 2;
      const x2 = b.x;
      const y2 = b.y + cardH / 2;
      const mx = (x1 + x2) / 2;
      parts.push(
        `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${p.edgeContext}" stroke-width="1.2" stroke-opacity="0.6" stroke-dasharray="4 3" marker-end="url(#sym-ctx)" />`,
      );
    }
  }

  for (let i = 0; i < symbols.length; i += 1) {
    const sym = symbols[i];
    const pos = nodePos.get(i);
    if (!sym || !pos) continue;
    const touched = !isAddedFile && isRangeTouched(sym[3], sym[4], ranges);
    const accent = isAddedFile ? p.added : touched ? p.modified : p.cardStroke;
    const fill = isAddedFile ? p.addedBg : touched ? p.modifiedBg : p.cardBg;
    const maxChars = Math.max(10, Math.floor((colW - 52) / 6.7));
    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${colW}" height="${cardH}" rx="7" fill="${p.cardBg}" stroke="${accent}" stroke-width="${isAddedFile || touched ? 1.5 : 1}" />`,
      `<rect x="${pos.x}" y="${pos.y}" width="${colW}" height="${cardH}" rx="7" fill="${fill}" />`,
      isAddedFile || touched
        ? `<rect x="${pos.x + 1}" y="${pos.y + 5}" width="3" height="${cardH - 10}" rx="1.5" fill="${accent}" />`
        : "",
      `<text x="${pos.x + 11}" y="${pos.y + 19}" font-family="${FONT_MONO}" font-size="11.5" font-weight="600" fill="${p.textPrimary}">${escXml(truncateText(sym[0], maxChars))}</text>`,
      `<text x="${pos.x + colW - 8}" y="${pos.y + 19}" text-anchor="end" font-family="${FONT_MONO}" font-size="10" fill="${p.textMuted}">L${sym[3]}</text>`,
    );
  }

  for (const name of extNames) {
    const pos = extPos.get(name);
    if (!pos) continue;
    const maxChars = Math.max(10, Math.floor((colW - 18) / 6.6));
    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${colW}" height="${cardH}" rx="7" fill="${p.cardMutedBg}" stroke="${p.cardStroke}" stroke-width="1" stroke-dasharray="3 3" />`,
      `<text x="${pos.x + 10}" y="${pos.y + 19}" font-family="${FONT_MONO}" font-size="11" fill="${p.textSecondary}">${escXml(truncateText(name, maxChars))}</text>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    "<defs>",
    `<marker id="sym-ctx" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.edgeContext}" /></marker>`,
    `<marker id="sym-add" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.added}" /></marker>`,
    `<marker id="sym-mod" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.modified}" /></marker>`,
    "</defs>",
    `<rect width="${totalW}" height="${totalH}" rx="10" fill="${p.bg}" />`,
    ...parts,
    "</svg>",
  ].join("");
}
