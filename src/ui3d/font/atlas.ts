import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from "three";
import { GLYPH_COUNT, GLYPH_H, GLYPH_W, glyphBitmap } from "./glyphs";

/** The glyph atlas: every font glyph and rune in one small RGBA texture.
 *
 * Each glyph gets a cell padded by ATLAS_PAD pixels so light can bleed
 * around it, and the three colour channels carry three layers of the same
 * glyph — the shader composes them, so text costs one texture fetch per
 * pixel and needs no post-processing (the UI canvas has no bloom):
 *   R  the crisp glyph (1 bit, stored as 0/255)
 *   G  a soft halo (gaussian falloff around the ink) — the glow
 *   B  the ink dilated by one pixel — a dark outline that keeps text legible
 *      over bright torchlight and pale bone walls alike
 * Built from glyphs.ts in plain TypedArray math: no canvas, no assets, and
 * the same bytes on every machine. */

export const ATLAS_PAD = 3;
export const CELL_W = GLYPH_W + ATLAS_PAD * 2;
export const CELL_H = GLYPH_H + ATLAS_PAD * 2;
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = Math.ceil(GLYPH_COUNT / ATLAS_COLS);
export const ATLAS_W = ATLAS_COLS * CELL_W;
export const ATLAS_H = ATLAS_ROWS * CELL_H;

const HALO_RADIUS = 3;
const HALO_SIGMA = 1.25;

/** Turn a 1-bit ink map (one byte per atlas texel, row 0 = top) into the
 * atlas's RGBA layers: R the ink, G a gaussian halo, B the ink dilated by a
 * pixel (the outline). Works for any cell grid as long as each cell pads its
 * glyph by ≥ HALO_RADIUS + 1 texels, so no halo bleeds into a neighbour. */
export function inkToAtlas(ink: Uint8Array, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  let full = 0;
  for (let dy = -HALO_RADIUS; dy <= HALO_RADIUS; dy++)
    for (let dx = -HALO_RADIUS; dx <= HALO_RADIUS; dx++)
      full += Math.exp(-(dx * dx + dy * dy) / (2 * HALO_SIGMA * HALO_SIGMA));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let halo = 0;
      let outline = 0;
      for (let dy = -HALO_RADIUS; dy <= HALO_RADIUS; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -HALO_RADIUS; dx <= HALO_RADIUS; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || ink[yy * width + xx] === 0) continue;
          halo += Math.exp(-(dx * dx + dy * dy) / (2 * HALO_SIGMA * HALO_SIGMA));
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) outline = 1;
        }
      }
      // A sparse glyph never approaches `full`; lift it so thin strokes
      // still glow, then clamp.
      const h = Math.min(1, (halo / full) * 3.2);
      const i = (y * width + x) * 4;
      data[i] = ink[y * width + x] ? 255 : 0;
      data[i + 1] = Math.round(h * 255);
      data[i + 2] = outline * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Raw bytes of the hand-set fallback font's atlas, row 0 = top of the
 * first cell row (the shader indexes texels with texelFetch, so no flipping
 * or filtering is involved). */
export function buildAtlasData(): Uint8Array {
  const ink = new Uint8Array(ATLAS_W * ATLAS_H);
  for (let slot = 0; slot < GLYPH_COUNT; slot++) {
    const bmp = glyphBitmap(slot);
    const ox = (slot % ATLAS_COLS) * CELL_W + ATLAS_PAD;
    const oy = Math.floor(slot / ATLAS_COLS) * CELL_H + ATLAS_PAD;
    for (let y = 0; y < GLYPH_H; y++)
      for (let x = 0; x < GLYPH_W; x++) if (bmp[y]![x]) ink[(oy + y) * ATLAS_W + ox + x] = 1;
  }
  return inkToAtlas(ink, ATLAS_W, ATLAS_H);
}

/** An atlas texture over raw RGBA bytes: nearest, no mips — texelFetch'd. */
export function atlasTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

let atlas: DataTexture | null = null;

/** The shared atlas texture (built on first use). */
export function glyphAtlas(): DataTexture {
  if (atlas) return atlas;
  atlas = atlasTexture(buildAtlasData(), ATLAS_W, ATLAS_H);
  return atlas;
}
