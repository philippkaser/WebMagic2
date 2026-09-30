import { RARITIES } from "../items/rarity";
import type { Rarity } from "../items/types";

/** Design tokens for the DOM chrome — the "grimoire" look: soot-black stone,
 * tarnished brass trim, parchment text, arcane cyan for magic, and the item
 * rarity colors. Components read these; styles.css mirrors them as CSS
 * custom properties (see `cssVars`) so both sides stay in sync. */
export const color = {
  ink: "#07060a",
  void: "#0d0a12",
  stone: "#1a1520",
  stoneMid: "#2a2231",
  stoneLight: "#40354a",
  brass: "#c8a23c",
  brassLight: "#f3d98a",
  brassDark: "#6a4f1c",
  parchment: "#eadfc4",
  parchmentDim: "#b3a587",
  faded: "#7a7064",
  arcane: "#46ffd0",
  arcaneDim: "#1d8f76",
  blood: "#d23c3c",
  bloodDark: "#5c1212",
  mana: "#5b9bff",
  manaDark: "#1c2f66",
  violet: "#b45cff",
  ally: "#6fe08a",
  gold: "#ffd44f",
} as const;

export const font = {
  /** Pixel blackletter — titles, floor numbers, the big moments. */
  title: "'Jacquard 12', 'Tiny5', serif",
  /** Crisp pixel sans — all readable body text. */
  body: "'Tiny5', 'Silkscreen', monospace",
  /** Tiny all-caps pixel labels and numbers. */
  label: "'Silkscreen', 'Tiny5', monospace",
} as const;

export function rarityColor(rarity: Rarity): string {
  return RARITIES[rarity].color;
}

/** Every token as a CSS custom property (`--wm-arcane` …) for styles.css. */
export const cssVars: Record<string, string> = Object.fromEntries([
  ...Object.entries(color).map(([k, v]) => [`--wm-${kebab(k)}`, v]),
  ...Object.entries(RARITIES).map(([k, v]) => [`--wm-rarity-${k}`, v.color]),
  ["--wm-font-title", font.title],
  ["--wm-font-body", font.body],
  ["--wm-font-label", font.label],
]);

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Pick the chrome scale for the window: integer-ish steps so pixel fonts and
 * 1-bit icons stay crisp (1× at 720p, 1.5× at 1080p, 2× at 1440p+). */
export function uiScaleFor(width: number, height: number): number {
  const s = Math.min(width / 1280, height / 720);
  if (s >= 1.95) return 2;
  if (s >= 1.4) return 1.5;
  if (s >= 0.95) return 1;
  return 0.75;
}
