/** The grimoire look of the in-world UI — soot-black stone, tarnished brass
 * trim, parchment text, arcane cyan for magic (after the artpass design
 * system). Every ui3d layer reads its colours from here, so the whole UI
 * can be re-toned in one place. */

export const ink = {
  /** Deepest black — outlines, text shadows. */
  ink: "#07060a",
  void: "#0d0a12",
  /** Panel stone, from dark to light. */
  stone: "#1a1520",
  stoneMid: "#2a2231",
  stoneLight: "#40354a",
  brass: "#c8a23c",
  brassLight: "#f3d98a",
  brassDark: "#6a4f1c",
  /** Body text and its dimmer sibling for secondary lines. */
  parchment: "#eadfc4",
  parchmentDim: "#b3a587",
  /** Captions, hints, empty slots. */
  faded: "#7a7064",
  /** Magic: buttons, the way onward, highlights. */
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

/** A frame's three tones: the trim band, its lit edge, its shadowed edge. */
export interface FrameColors {
  trim: string;
  light: string;
  dark: string;
}

export const FRAMES = {
  brass: { trim: ink.brass, light: ink.brassLight, dark: ink.brassDark },
  arcane: { trim: ink.arcaneDim, light: ink.arcane, dark: "#0f3f36" },
  iron: { trim: "#4a4152", light: "#7d7288", dark: "#241e2a" },
  blood: { trim: "#8a2424", light: "#ff6a5a", dark: "#3a0c0c" },
  gold: { trim: "#c9951f", light: ink.gold, dark: "#5a3d0a" },
  violet: { trim: "#6c34a0", light: ink.violet, dark: "#2a1242" },
} satisfies Record<string, FrameColors>;

export type FrameKind = keyof typeof FRAMES;

/** Frame tones for any colour (callers that only know an accent). */
export function frameFor(kind: FrameKind | string): FrameColors {
  if (kind in FRAMES) return FRAMES[kind as FrameKind];
  return { trim: kind, light: shade(kind, 0.45), dark: shade(kind, -0.55) };
}

/** Mix a hex colour toward white (t > 0) or black (t < 0); returns hex. */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const ch = (c: number) => Math.round(c + (target - c) * k);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** An accent colour for a named look (slab tints, glows): magic is arcane
 * cyan, gold home and treasure, blood danger, violet enchantment, iron a
 * cool steel; brass reads as arcane. Any other string is a colour. */
const HOLO: Record<string, string> = {
  brass: ink.arcane,
  arcane: ink.arcane,
  iron: "#8fb4e6",
  blood: "#ff5a48",
  gold: ink.gold,
  violet: "#c08cff",
};

export function holoColor(kind: FrameKind | string): string {
  return HOLO[kind] ?? kind;
}
