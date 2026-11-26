import { Resvg } from "@resvg/resvg-js";

export type ShowMeTheme = "dark" | "light";
export type ShowMeThemeMode = ShowMeTheme | "auto";

export interface ThemePalette {
  bg: string;
  cardBg: string;
  cardMutedBg: string;
  cardStroke: string;
  caption: string;
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
  codeBg: string;
  border: string;
}

const DARK_PALETTE: ThemePalette = {
  bg: "#0d1117",
  cardBg: "#161b22",
  cardMutedBg: "#0d1117",
  cardStroke: "#30363d",
  caption: "#8b949e",
  textPrimary: "#f0f6fc",
  textSecondary: "#c9d1d9",
  textMuted: "#8b949e",
  edgeContext: "#6e7681",
  added: "#3fb950",
  addedBg: "rgba(63,185,80,0.12)",
  modified: "#d29922",
  modifiedBg: "rgba(210,153,34,0.12)",
  removed: "#f85149",
  removedBg: "rgba(248,81,73,0.12)",
  codeBg: "#161b22",
  border: "#21262d",
};

const LIGHT_PALETTE: ThemePalette = {
  bg: "#ffffff",
  cardBg: "#f6f8fa",
  cardMutedBg: "#ffffff",
  cardStroke: "#d0d7de",
  caption: "#57606a",
  textPrimary: "#1f2328",
  textSecondary: "#424a53",
  textMuted: "#656d76",
  edgeContext: "#8c959f",
  added: "#1a7f37",
  addedBg: "rgba(26,127,55,0.09)",
  modified: "#9a6700",
  modifiedBg: "rgba(154,103,0,0.09)",
  removed: "#cf222e",
  removedBg: "rgba(207,34,46,0.09)",
  codeBg: "#f6f8fa",
  border: "#d8dee4",
};

export const FONT_SANS = "DejaVu Sans, Helvetica, Arial, sans-serif";
export const FONT_MONO = "DejaVu Sans Mono, Menlo, Consolas, monospace";

export function paletteFor(theme: ShowMeTheme): ThemePalette {
  return theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}

export function escXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
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
