import type { IacBlockDelta } from "./fileClass.ts";
import type { RankedChangedFile } from "./ranking.ts";
import { escXml, FONT_MONO, FONT_SANS, paletteFor, truncateText, type ShowMeTheme } from "./svgPrimitives.ts";

export function renderIacCardSvg(params: {
  primaryFile: RankedChangedFile;
  iacDelta: IacBlockDelta;
  theme: ShowMeTheme;
}): string {
  const { primaryFile, iacDelta, theme } = params;
  const p = paletteFor(theme);
  const totalW = 840;
  const padX = 20;
  const lines = iacDelta.topHunkLines.slice(0, 10);
  const hasSensitive = iacDelta.sensitiveBlocks.length > 0;
  const isMutating = iacDelta.mutatingSensitiveBlocks.length > 0;

  const stripY = 18;
  const codeTop = hasSensitive ? 84 : 58;
  const lineH = 18;
  const codeH = Math.max(44, lines.length * lineH + 22);
  const totalH = codeTop + codeH + 18;

  const chips: Array<{ text: string; color: string; bg: string }> = [
    {
      text: `resource +${iacDelta.resourcesAdded}`,
      color: iacDelta.resourcesAdded > 0 ? p.modified : p.textMuted,
      bg: iacDelta.resourcesAdded > 0 ? p.modifiedBg : p.cardBg,
    },
    {
      text: `data +${iacDelta.dataAdded}`,
      color: iacDelta.dataAdded > 0 ? p.added : p.textMuted,
      bg: iacDelta.dataAdded > 0 ? p.addedBg : p.cardBg,
    },
    {
      text: `check +${iacDelta.checksAdded}`,
      color: iacDelta.checksAdded > 0 ? p.added : p.textMuted,
      bg: iacDelta.checksAdded > 0 ? p.addedBg : p.cardBg,
    },
    {
      text: `locals +${iacDelta.localsAdded}`,
      color: p.textSecondary,
      bg: p.cardBg,
    },
  ];
  if (iacDelta.modulesAdded > 0) {
    chips.push({ text: `module +${iacDelta.modulesAdded}`, color: p.modified, bg: p.modifiedBg });
  }

  const chipParts: string[] = [];
  let cx = padX;
  for (const ch of chips) {
    const w = Math.max(76, Math.round(ch.text.length * 6.8 + 18));
    chipParts.push(
      `<rect x="${cx}" y="${stripY}" width="${w}" height="24" rx="6" fill="${ch.bg}" stroke="${p.cardStroke}" stroke-width="1" />`,
      `<text x="${cx + w / 2}" y="${stripY + 16}" text-anchor="middle" font-family="${FONT_MONO}" font-size="11" font-weight="600" fill="${ch.color}">${escXml(ch.text)}</text>`,
    );
    cx += w + 8;
  }

  const fileLabel = truncateText(primaryFile.file.path, 40);
  const fileTag = `<text x="${totalW - padX}" y="${stripY + 16}" text-anchor="end" font-family="${FONT_MONO}" font-size="11.5" font-weight="600" fill="${p.textSecondary}">${escXml(fileLabel)}</text>`;

  const sensitiveBanner = hasSensitive
    ? [
        `<rect x="${padX}" y="50" width="${totalW - padX * 2}" height="24" rx="6" fill="${isMutating ? p.removedBg : p.modifiedBg}" stroke="${isMutating ? p.removed : p.modified}" stroke-width="1" />`,
        `<text x="${padX + 10}" y="66" font-family="${FONT_MONO}" font-size="11" font-weight="700" fill="${isMutating ? p.removed : p.modified}">${escXml(truncateText(`${isMutating ? "MUTATING SENSITIVE" : "READ-ONLY SENSITIVE"}: ${iacDelta.sensitiveBlocks.join(", ")}`, 112))}</text>`,
      ].join("")
    : "";

  const codeLinesSvg = lines
    .map((ln, idx) => {
      const color = ln.startsWith("+") ? p.added : ln.startsWith("-") ? p.removed : p.textSecondary;
      const safe = truncateText(ln, 102);
      return `<text x="${padX + 14}" y="${codeTop + 22 + idx * lineH}" xml:space="preserve" font-family="${FONT_MONO}" font-size="11.5" fill="${color}">${escXml(safe)}</text>`;
    })
    .join("");

  const emptyNote =
    lines.length === 0
      ? `<text x="${padX + 14}" y="${codeTop + 26}" font-family="${FONT_SANS}" font-size="12" fill="${p.textMuted}">No HCL block diff lines available.</text>`
      : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    `<rect width="${totalW}" height="${totalH}" rx="10" fill="${p.bg}" />`,
    ...chipParts,
    fileTag,
    sensitiveBanner,
    `<rect x="${padX}" y="${codeTop}" width="${totalW - padX * 2}" height="${codeH}" rx="8" fill="${p.codeBg}" stroke="${p.border}" stroke-width="1" />`,
    codeLinesSvg,
    emptyNote,
    "</svg>",
  ].join("");
}
