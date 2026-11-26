import { Resvg } from "@resvg/resvg-js";
import type { CommitArchDiff } from "../../studio/commitDiff.ts";
import type { DiffDiagramEdge, DiffDiagramNode } from "../../studio/diffOverlay.ts";
import type { DrilldownFile } from "../../studio/drilldown.ts";
import type { PriorityTier, RankedChangedFile, RankedDiagram } from "./ranking.ts";

export type ShowMeTheme = "dark" | "light";

interface ThemePalette {
  bg: string;
  headerBg: string;
  headerBorder: string;
  cardBg: string;
  cardMutedBg: string;
  cardStroke: string;
  laneFill: string;
  laneStroke: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  edgeContext: string;
  added: string;
  addedBg: string;
  modified: string;
  modifiedBg: string;
  removed: string;
  removedBg: string;
  footerBg: string;
  codeBg: string;
}

const DARK_PALETTE: ThemePalette = {
  bg: "#090d16",
  headerBg: "#0f1626",
  headerBorder: "#1f2a44",
  cardBg: "#141c2f",
  cardMutedBg: "#0f1524",
  cardStroke: "#2b3957",
  laneFill: "rgba(148,163,184,0.045)",
  laneStroke: "rgba(148,163,184,0.22)",
  textPrimary: "#f1f5f9",
  textSecondary: "#cbd5e1",
  textMuted: "#94a3b8",
  edgeContext: "#475569",
  added: "#10b981",
  addedBg: "rgba(16,185,129,0.14)",
  modified: "#f59e0b",
  modifiedBg: "rgba(245,158,11,0.14)",
  removed: "#ef4444",
  removedBg: "rgba(239,68,68,0.14)",
  footerBg: "#0d1322",
  codeBg: "#0b1120",
};

const LIGHT_PALETTE: ThemePalette = {
  bg: "#f8fafc",
  headerBg: "#ffffff",
  headerBorder: "#e2e8f0",
  cardBg: "#ffffff",
  cardMutedBg: "#f1f5f9",
  cardStroke: "#cbd5e1",
  laneFill: "rgba(15,23,42,0.028)",
  laneStroke: "rgba(100,116,139,0.32)",
  textPrimary: "#0f172a",
  textSecondary: "#334155",
  textMuted: "#64748b",
  edgeContext: "#94a3b8",
  added: "#059669",
  addedBg: "rgba(5,150,105,0.12)",
  modified: "#d97706",
  modifiedBg: "rgba(217,119,6,0.12)",
  removed: "#dc2626",
  removedBg: "rgba(220,38,38,0.12)",
  footerBg: "#f1f5f9",
  codeBg: "#ffffff",
};

const FONT_SANS = "DejaVu Sans, Helvetica, Arial, sans-serif";
const FONT_MONO = "DejaVu Sans Mono, Menlo, Consolas, monospace";

function escXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function paletteFor(theme: ShowMeTheme): ThemePalette {
  return theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}

function priorityColor(tier: PriorityTier, p: ThemePalette): { fg: string; bg: string; label: string } {
  if (tier === "P0") return { fg: p.removed, bg: p.removedBg, label: "P0 CRITICAL" };
  if (tier === "P1") return { fg: p.modified, bg: p.modifiedBg, label: "P1 HIGH" };
  if (tier === "P2") return { fg: "#38bdf8", bg: "rgba(56,189,248,0.15)", label: "P2 MEDIUM" };
  return { fg: p.textMuted, bg: "rgba(148,163,184,0.14)", label: "P3 LOW" };
}

function verdictStyle(verdict: CommitArchDiff["verdict"], p: ThemePalette): { fg: string; bg: string } {
  if (verdict === "risk") return { fg: p.removed, bg: p.removedBg };
  if (verdict === "caution") return { fg: p.modified, bg: p.modifiedBg };
  return { fg: p.added, bg: p.addedBg };
}

function edgePathD(e: DiffDiagramEdge): string {
  if (e.points.length < 2) return "";
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

function renderNodeCard(n: DiffDiagramNode, p: ThemePalette): string {
  const x = n.x - n.w / 2;
  const y = n.y - n.h / 2;
  const isAdded = n.diffStatus === "added";
  const isMod = n.diffStatus === "modified";
  const isRem = n.diffStatus === "removed";
  const isUnchanged = n.diffStatus === "unchanged";

  const stroke = isAdded ? p.added : isMod ? p.modified : isRem ? p.removed : p.cardStroke;
  const fill = isAdded ? p.addedBg : isMod ? p.modifiedBg : isRem ? p.removedBg : p.cardMutedBg;
  const strokeWidth = isUnchanged ? 1 : 2;
  const dash = isRem ? ' stroke-dasharray="5 3"' : "";
  const opacity = isUnchanged ? ' opacity="0.62"' : "";
  const badgeText = isAdded ? "ADDED" : isRem ? "REMOVED" : isMod ? (n.deltaLabel ?? "MODIFIED") : "";
  const badgeColor = isAdded ? p.added : isRem ? p.removed : p.modified;
  const titleMax = Math.max(12, Math.floor((n.w - 22) / 7.2));
  const subMax = Math.max(12, Math.floor((n.w - 22) / 6.2));

  const parts: string[] = [
    `<g${opacity}>`,
    `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="10" fill="${p.cardBg}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} />`,
    `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="10" fill="${fill}" />`,
    `<text x="${x + 12}" y="${y + 22}" font-family="${FONT_SANS}" font-size="12.5" font-weight="600" fill="${p.textPrimary}">${escXml(truncateText(n.label, titleMax))}</text>`,
  ];
  if (n.sublabel) {
    parts.push(
      `<text x="${x + 12}" y="${y + 39}" font-family="${FONT_MONO}" font-size="10.2" fill="${p.textMuted}">${escXml(truncateText(n.sublabel, subMax))}</text>`,
    );
  }
  if (badgeText) {
    const bw = Math.min(n.w - 16, Math.max(46, badgeText.length * 6.5 + 14));
    const bx = x + n.w - bw - 8;
    const by = y - 10;
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="18" rx="9" fill="${p.bg}" stroke="${badgeColor}" stroke-width="1.2" />`,
      `<text x="${bx + bw / 2}" y="${by + 12.5}" text-anchor="middle" font-family="${FONT_MONO}" font-size="9.5" font-weight="700" fill="${badgeColor}">${escXml(badgeText)}</text>`,
    );
  }
  parts.push("</g>");
  return parts.join("");
}

function renderReasonPills(reasons: string[], startX: number, y: number, maxWidth: number, p: ThemePalette): string {
  const out: string[] = [];
  let cx = startX;
  for (const r of reasons) {
    const label = truncateText(r, 24);
    const w = Math.max(54, Math.round(label.length * 6.4 + 18));
    if (cx + w > maxWidth) break;
    out.push(
      `<rect x="${cx}" y="${y}" width="${w}" height="22" rx="6" fill="${p.cardBg}" stroke="${p.headerBorder}" stroke-width="1" />`,
      `<text x="${cx + w / 2}" y="${y + 14.5}" text-anchor="middle" font-family="${FONT_MONO}" font-size="10.5" fill="${p.textSecondary}">${escXml(label)}</text>`,
    );
    cx += w + 8;
  }
  return out.join("");
}

export function renderDiffDiagramSvg(params: {
  ranked: RankedDiagram;
  commitDiff: CommitArchDiff;
  repoName: string;
  theme: ShowMeTheme;
}): string {
  const { ranked, commitDiff, repoName, theme } = params;
  const p = paletteFor(theme);
  const overlay = ranked.overlay;
  const headerH = 92;
  const footerH = 38;
  const canvasW = Math.max(820, Math.round(overlay.width + 48));
  const canvasH = Math.max(240, Math.round(overlay.height + 24));
  const totalW = canvasW;
  const totalH = headerH + canvasH + footerH;
  const offsetX = Math.max(24, Math.round((canvasW - overlay.width) / 2));
  const offsetY = headerH + 12;

  const pri = priorityColor(ranked.priority, p);
  const ver = verdictStyle(commitDiff.verdict, p);
  const focusLabel = ranked.focused ? `Focused 1-hop (${ranked.hiddenNodes} unchanged hidden)` : "Full architectural view";

  const lanesSvg = (overlay.lanes ?? [])
    .map(
      (l) =>
        `<g><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="12" fill="${p.laneFill}" stroke="${p.laneStroke}" stroke-width="1" stroke-dasharray="4 4" /><text x="${l.x + 12}" y="${l.y + 20}" font-family="${FONT_SANS}" font-size="11" font-weight="700" fill="${p.textMuted}" letter-spacing="0.8">${escXml(l.label.toUpperCase())}</text></g>`,
    )
    .join("");

  const edgesSvg = overlay.edges
    .map((e) => {
      const d = edgePathD(e);
      if (!d) return "";
      const isAdd = e.diffStatus === "added";
      const isRem = e.diffStatus === "removed";
      const color = isAdd ? p.added : isRem ? p.removed : p.edgeContext;
      const width = isAdd || isRem ? 2.2 : 1.15;
      const opacity = isAdd || isRem ? 0.95 : 0.42;
      const dash = isRem ? ' stroke-dasharray="5 4"' : "";
      const marker = isAdd ? "url(#arrow-add)" : isRem ? "url(#arrow-rem)" : "url(#arrow-ctx)";
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}"${dash} marker-end="${marker}" />`;
    })
    .join("");

  const nodesSvg = overlay.nodes.map((n) => renderNodeCard(n, p)).join("");

  const titleText = `${ranked.bundle.label}  ·  ${repoName}`;
  const metaText = `${commitDiff.baseSha}..${commitDiff.headSha}  ·  rank=${ranked.breakdown.preset}  ·  score ${ranked.score}  ·  ${focusLabel}`;
  const pillsSvg = renderReasonPills(ranked.breakdown.reasons, 20, 58, totalW - 150, p);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    "<defs>",
    `<marker id="arrow-ctx" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.edgeContext}" /></marker>`,
    `<marker id="arrow-add" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.added}" /></marker>`,
    `<marker id="arrow-rem" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.removed}" /></marker>`,
    "</defs>",
    `<rect width="${totalW}" height="${totalH}" fill="${p.bg}" />`,
    `<rect x="0" y="0" width="${totalW}" height="${headerH}" fill="${p.headerBg}" />`,
    `<line x1="0" y1="${headerH}" x2="${totalW}" y2="${headerH}" stroke="${p.headerBorder}" stroke-width="1" />`,
    `<rect x="20" y="16" width="96" height="24" rx="12" fill="${pri.bg}" stroke="${pri.fg}" stroke-width="1.2" />`,
    `<text x="68" y="32" text-anchor="middle" font-family="${FONT_MONO}" font-size="11" font-weight="700" fill="${pri.fg}">${pri.label}</text>`,
    `<text x="128" y="33" font-family="${FONT_SANS}" font-size="17" font-weight="700" fill="${p.textPrimary}">${escXml(truncateText(titleText, 56))}</text>`,
    `<rect x="${totalW - 118}" y="16" width="98" height="24" rx="12" fill="${ver.bg}" stroke="${ver.fg}" stroke-width="1.2" />`,
    `<text x="${totalW - 69}" y="32" text-anchor="middle" font-family="${FONT_MONO}" font-size="11" font-weight="700" fill="${ver.fg}">${commitDiff.verdict.toUpperCase()}</text>`,
    `<text x="20" y="51" font-family="${FONT_MONO}" font-size="11" fill="${p.textMuted}">${escXml(truncateText(metaText, 110))}</text>`,
    pillsSvg,
    `<g transform="translate(${offsetX}, ${offsetY})">${lanesSvg}${edgesSvg}${nodesSvg}</g>`,
    `<rect x="0" y="${totalH - footerH}" width="${totalW}" height="${footerH}" fill="${p.footerBg}" />`,
    `<line x1="0" y1="${totalH - footerH}" x2="${totalW}" y2="${totalH - footerH}" stroke="${p.headerBorder}" stroke-width="1" />`,
    `<circle cx="26" cy="${totalH - 19}" r="4.5" fill="${p.added}" /><text x="37" y="${totalH - 15}" font-family="${FONT_SANS}" font-size="11" fill="${p.textSecondary}">Added</text>`,
    `<circle cx="96" cy="${totalH - 19}" r="4.5" fill="${p.modified}" /><text x="107" y="${totalH - 15}" font-family="${FONT_SANS}" font-size="11" fill="${p.textSecondary}">Modified</text>`,
    `<circle cx="182" cy="${totalH - 19}" r="4.5" fill="${p.removed}" /><text x="193" y="${totalH - 15}" font-family="${FONT_SANS}" font-size="11" fill="${p.textSecondary}">Removed</text>`,
    `<circle cx="272" cy="${totalH - 19}" r="4.5" fill="${p.cardStroke}" /><text x="283" y="${totalH - 15}" font-family="${FONT_SANS}" font-size="11" fill="${p.textMuted}">1-hop Context</text>`,
    `<text x="${totalW - 20}" y="${totalH - 15}" text-anchor="end" font-family="${FONT_MONO}" font-size="10.5" fill="${p.textMuted}">RepoSpec /show-me · static structural diff</text>`,
    "</svg>",
  ].join("");
}

function parseHunkChangedLineRanges(hunk?: string): Array<[number, number]> {
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

function isLineRangeTouched(startLine: number, endLine: number, ranges: Array<[number, number]>): boolean {
  for (const [rs, re] of ranges) {
    if (startLine <= re && endLine >= rs) return true;
  }
  return false;
}

export function renderTopFileCardSvg(params: {
  rankedFile: RankedChangedFile;
  drillFile?: DrilldownFile;
  commitDiff: CommitArchDiff;
  theme: ShowMeTheme;
}): string {
  const { rankedFile, drillFile, commitDiff, theme } = params;
  const p = paletteFor(theme);
  const pri = priorityColor(rankedFile.priority, p);
  const ranges = parseHunkChangedLineRanges(rankedFile.file.hunk);
  const symbols = (drillFile?.m ?? []).slice(0, 24);
  const internalEdges = drillFile?.k ?? [];
  const externalEdges = (drillFile?.o ?? []).slice(0, 14);

  const pubIdx: number[] = [];
  const privIdx: number[] = [];
  for (let i = 0; i < symbols.length; i += 1) {
    const sym = symbols[i];
    if (!sym) continue;
    if (sym[1] === "pub") pubIdx.push(i);
    else privIdx.push(i);
  }
  const extNames = Array.from(new Set(externalEdges.map((e) => e[1]))).slice(0, 10);

  const maxRows = Math.max(1, pubIdx.length, privIdx.length, extNames.length);
  const rowH = 40;
  const colW = 240;
  const headerH = 92;
  const graphTop = headerH + 34;
  const graphH = Math.max(150, maxRows * rowH + 24);

  const hunkLines = (rankedFile.file.hunk ?? "")
    .split("\n")
    .filter((l) => l.startsWith("@@") || l.startsWith("+") || l.startsWith("-"))
    .slice(0, 14);
  const hunkSectionH = hunkLines.length > 0 ? hunkLines.length * 17 + 44 : 0;
  const footerH = 36;
  const totalW = 900;
  const totalH = headerH + graphH + hunkSectionH + footerH + 28;

  const colX = [28, 330, 632];
  const nodePos = new Map<number, { x: number; y: number }>();
  const extPos = new Map<string, { x: number; y: number }>();
  const svgParts: string[] = [];

  pubIdx.forEach((idx, row) => nodePos.set(idx, { x: colX[0] ?? 28, y: graphTop + row * rowH }));
  privIdx.forEach((idx, row) => nodePos.set(idx, { x: colX[1] ?? 330, y: graphTop + row * rowH }));
  extNames.forEach((name, row) => extPos.set(name, { x: colX[2] ?? 632, y: graphTop + row * rowH }));

  for (const [from, to] of internalEdges) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) continue;
    const x1 = a.x + colW;
    const y1 = a.y + 15;
    const x2 = b.x;
    const y2 = b.y + 15;
    const mx = (x1 + x2) / 2;
    svgParts.push(
      `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${p.modified}" stroke-width="1.4" stroke-opacity="0.72" marker-end="url(#f-arrow)" />`,
    );
  }
  for (const [from, extName] of externalEdges) {
    const a = nodePos.get(from);
    const b = extPos.get(extName);
    if (!a || !b) continue;
    const x1 = a.x + colW;
    const y1 = a.y + 15;
    const x2 = b.x;
    const y2 = b.y + 15;
    const mx = (x1 + x2) / 2;
    svgParts.push(
      `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${p.edgeContext}" stroke-width="1.2" stroke-opacity="0.65" stroke-dasharray="4 3" marker-end="url(#f-arrow)" />`,
    );
  }

  for (let i = 0; i < symbols.length; i += 1) {
    const sym = symbols[i];
    const pos = nodePos.get(i);
    if (!sym || !pos) continue;
    const touched = isLineRangeTouched(sym[3], sym[4], ranges);
    const stroke = touched ? p.modified : sym[1] === "pub" ? p.added : p.cardStroke;
    const fill = touched ? p.modifiedBg : p.cardBg;
    svgParts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${colW}" height="30" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${touched ? 1.8 : 1.1}" />`,
      `<text x="${pos.x + 10}" y="${pos.y + 19}" font-family="${FONT_MONO}" font-size="11" font-weight="600" fill="${p.textPrimary}">${escXml(truncateText(sym[0], 24))}</text>`,
      `<text x="${pos.x + colW - 8}" y="${pos.y + 19}" text-anchor="end" font-family="${FONT_MONO}" font-size="9.5" fill="${touched ? p.modified : p.textMuted}">L${sym[3]}${touched ? " · diff" : ""}</text>`,
    );
  }

  for (const name of extNames) {
    const pos = extPos.get(name);
    if (!pos) continue;
    svgParts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${colW}" height="30" rx="8" fill="${p.cardMutedBg}" stroke="${p.cardStroke}" stroke-width="1" stroke-dasharray="3 3" />`,
      `<text x="${pos.x + 10}" y="${pos.y + 19}" font-family="${FONT_MONO}" font-size="10.5" fill="${p.textSecondary}">${escXml(truncateText(name, 28))}</text>`,
    );
  }

  if (symbols.length === 0) {
    svgParts.push(
      `<text x="28" y="${graphTop + 26}" font-family="${FONT_SANS}" font-size="12.5" fill="${p.textMuted}">No internal symbol call graph extracted for this file; showing diff excerpt below.</text>`,
    );
  }

  const hunkParts: string[] = [];
  if (hunkLines.length > 0) {
    const hy = headerH + graphH + 20;
    hunkParts.push(
      `<rect x="24" y="${hy}" width="${totalW - 48}" height="${hunkSectionH - 10}" rx="10" fill="${p.codeBg}" stroke="${p.headerBorder}" stroke-width="1" />`,
      `<text x="38" y="${hy + 20}" font-family="${FONT_SANS}" font-size="11" font-weight="700" fill="${p.textMuted}">KEY DIFF EXCERPT (+${rankedFile.file.insertions}/-${rankedFile.file.deletions})</text>`,
    );
    hunkLines.forEach((ln, idx) => {
      const color = ln.startsWith("+") ? p.added : ln.startsWith("-") ? p.removed : p.textMuted;
      hunkParts.push(
        `<text x="38" y="${hy + 40 + idx * 17}" font-family="${FONT_MONO}" font-size="10.5" fill="${color}">${escXml(truncateText(ln, 114))}</text>`,
      );
    });
  }

  const pillsSvg = renderReasonPills(rankedFile.reasons, 20, 58, totalW - 40, p);
  const subtitle = `${commitDiff.baseSha}..${commitDiff.headSha}  ·  ${rankedFile.file.status.toUpperCase()}  ·  +${rankedFile.file.insertions}/-${rankedFile.file.deletions}  ·  score ${rankedFile.score}  ·  ${Math.round(rankedFile.coveragePct)}% cov  ·  churn ${rankedFile.churn}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    "<defs>",
    `<marker id="f-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${p.modified}" /></marker>`,
    "</defs>",
    `<rect width="${totalW}" height="${totalH}" fill="${p.bg}" />`,
    `<rect x="0" y="0" width="${totalW}" height="${headerH}" fill="${p.headerBg}" />`,
    `<line x1="0" y1="${headerH}" x2="${totalW}" y2="${headerH}" stroke="${p.headerBorder}" stroke-width="1" />`,
    `<rect x="20" y="16" width="96" height="24" rx="12" fill="${pri.bg}" stroke="${pri.fg}" stroke-width="1.2" />`,
    `<text x="68" y="32" text-anchor="middle" font-family="${FONT_MONO}" font-size="11" font-weight="700" fill="${pri.fg}">${pri.label}</text>`,
    `<text x="128" y="33" font-family="${FONT_MONO}" font-size="15.5" font-weight="700" fill="${p.textPrimary}">#1 Focus File: ${escXml(truncateText(rankedFile.file.path, 58))}</text>`,
    `<text x="20" y="51" font-family="${FONT_MONO}" font-size="11" fill="${p.textMuted}">${escXml(truncateText(subtitle, 118))}</text>`,
    pillsSvg,
    `<text x="${colX[0]}" y="${headerH + 22}" font-family="${FONT_SANS}" font-size="11" font-weight="700" fill="${p.added}" letter-spacing="0.7">PUBLIC EXPORTS (${pubIdx.length})</text>`,
    `<text x="${colX[1]}" y="${headerH + 22}" font-family="${FONT_SANS}" font-size="11" font-weight="700" fill="${p.textMuted}" letter-spacing="0.7">INTERNAL HELPERS (${privIdx.length})</text>`,
    `<text x="${colX[2]}" y="${headerH + 22}" font-family="${FONT_SANS}" font-size="11" font-weight="700" fill="${p.textMuted}" letter-spacing="0.7">EXTERNAL CALLS (${extNames.length})</text>`,
    ...svgParts,
    ...hunkParts,
    `<rect x="0" y="${totalH - footerH}" width="${totalW}" height="${footerH}" fill="${p.footerBg}" />`,
    `<line x1="0" y1="${totalH - footerH}" x2="${totalW}" y2="${totalH - footerH}" stroke="${p.headerBorder}" stroke-width="1" />`,
    `<text x="24" y="${totalH - 14}" font-family="${FONT_SANS}" font-size="11" fill="${p.textMuted}">Amber-highlighted symbols overlap lines modified in this diff.</text>`,
    `<text x="${totalW - 20}" y="${totalH - 14}" text-anchor="end" font-family="${FONT_MONO}" font-size="10.5" fill="${p.textMuted}">RepoSpec /show-me · symbol call graph</text>`,
    "</svg>",
  ].join("");
}

export function rasterizeSvgToPng(svg: string, zoom = 2): Uint8Array {
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "DejaVu Sans",
    },
    fitTo: {
      mode: "zoom",
      value: zoom,
    },
  });
  return resvg.render().asPng();
}
