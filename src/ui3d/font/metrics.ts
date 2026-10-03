import { ADVANCE, GLYPH_H, LINE_HEIGHT, RUNE_BASE, RUNE_COUNT, glyphSlot, isBlank } from "./glyphs";

/** What text layout needs to know about a typeface — nothing about
 * textures, so layout stays pure and testable. Every face (the web pixel
 * fonts rasterized in faces.ts, and the hand-set fallback font in glyphs.ts)
 * answers these in its own font pixels. */
export interface FontMetrics {
  /** Atlas slot for a character (unknown characters map to a fallback). */
  slotOf(char: string): number;
  /** Pen advance of a slot, font pixels. */
  advanceOf(slot: number): number;
  /** Slots that draw no ink (spaces) — skipped when building instances. */
  isBlank(slot: number): boolean;
  /** Baseline-to-baseline distance. */
  lineHeight: number;
  /** Height of one line's layout box: cap top (plus a pixel of air) down to
   * the lowest descender. Blocks are `lineHeight·(n−1) + boxHeight` tall. */
  boxHeight: number;
  /** Height of a capital letter — sizes are specified against it. */
  capHeight: number;
  /** A typical advance, for turning "N characters wide" into pixels. */
  avgAdvance: number;
  /** Where the materialize runes live in the atlas. */
  runeBase: number;
  runeCount: number;
}

/** The hand-set 5×7 fallback font (glyphs.ts): monospace, always available
 * (no DOM, no font loading) — used by tests, for symbols the web fonts lack,
 * and as the default metrics of pure layout. */
export const PIXEL_METRICS: FontMetrics = {
  slotOf: glyphSlot,
  advanceOf: () => ADVANCE,
  isBlank,
  lineHeight: LINE_HEIGHT,
  boxHeight: GLYPH_H,
  capHeight: 7,
  avgAdvance: ADVANCE,
  runeBase: RUNE_BASE,
  runeCount: RUNE_COUNT,
};
