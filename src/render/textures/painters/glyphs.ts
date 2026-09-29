import { Rng, hashSeed } from "../../../core/rng";
import { blank, put, glow, type Painted, type RGBA } from "../paint";

/** Procedural runes. No alphabet, no font: a rune is a few strokes between
 * the nodes of a tiny lattice (a main stave plus branches, like carved
 * futhark), rasterized at pixel scale. Seeded, so the same lore fragment
 * always shows the same glyph on every client, and different fragments
 * never look alike. */

/** A w×h mask (1 = stroke). `stroke` > 1 thickens lines right/down. */
export function glyphMask(rng: Rng, w: number, h: number, stroke = 1): Uint8Array {
  const mask = new Uint8Array(w * h);
  const cols = 3;
  const rows = h >= 9 ? 4 : 3;
  const iw = w - stroke; // leave room for the thickening
  const ih = h - stroke;
  const nx = (c: number) => Math.round((c * iw) / (cols - 1));
  const ny = (r: number) => Math.round((r * ih) / (rows - 1));

  const plot = (x: number, y: number) => {
    for (let oy = 0; oy < stroke; oy++) {
      for (let ox = 0; ox < stroke; ox++) {
        const px = x + ox;
        const py = y + oy;
        if (px >= 0 && px < w && py >= 0 && py < h) mask[py * w + px] = 1;
      }
    }
  };
  // Bresenham between two lattice nodes.
  const line = (c0: number, r0: number, c1: number, r1: number) => {
    let x0 = nx(c0);
    let y0 = ny(r0);
    const x1 = nx(c1);
    const y1 = ny(r1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  // Main stave(s): what makes it read as a rune rather than a scribble.
  const style = rng.next();
  if (style < 0.62) line(1, 0, 1, rows - 1);
  else if (style < 0.84) {
    line(0, 0, 0, rows - 1);
    line(2, 0, 2, rows - 1);
  } else line(rng.int(0, 2), 0, rng.int(0, 2), rows - 1);

  // Branches between neighbouring nodes (never degenerate, never repeated).
  const used = new Set<string>();
  const branches = rng.int(2, rows >= 4 ? 4 : 3);
  for (let b = 0, tries = 0; b < branches && tries < 24; tries++) {
    const c0 = rng.int(0, cols - 1);
    const r0 = rng.int(0, rows - 1);
    const c1 = c0 + rng.int(-1, 1);
    const r1 = r0 + rng.int(-1, 1);
    if (c1 < 0 || c1 >= cols || r1 < 0 || r1 >= rows) continue;
    if (c1 === c0 && r1 === r0) continue;
    if (c1 === c0 && Math.abs(r1 - r0) === 1 && style < 0.62 && c0 === 1) continue; // on the stave
    const key = [c0, r0, c1, r1].join() < [c1, r1, c0, r0].join()
      ? [c0, r0, c1, r1].join()
      : [c1, r1, c0, r0].join();
    if (used.has(key)) continue;
    used.add(key);
    line(c0, r0, c1, r1);
    b++;
  }
  return mask;
}

/** 1-texel dilation of a mask (for soft glow halos). */
function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue;
      if (
        (x > 0 && mask[y * w + x - 1]) ||
        (x < w - 1 && mask[y * w + x + 1]) ||
        (y > 0 && mask[(y - 1) * w + x]) ||
        (y < h - 1 && mask[(y + 1) * w + x])
      ) {
        out[y * w + x] = 1;
      }
    }
  }
  return out;
}

/** Carve a glyph into an already-painted surface: the stroke darkens and
 * sinks (so the Sobel normal map rims it with light), and — when the surface
 * has an emissive layer — glows `rgb` from the bottom of the groove. */
export function carveGlyph(
  p: Painted,
  mask: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  rgb: [number, number, number] | null,
  depth = 0.15,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const px = (x0 + x) % p.size;
      const py = (y0 + y) % p.size;
      const i = (py * p.size + px) * 4;
      put(p, px, py, p.color[i] * 0.45, p.color[i + 1] * 0.45, p.color[i + 2] * 0.45, depth);
      if (rgb) glow(p, px, py, rgb[0], rgb[1], rgb[2]);
    }
  }
}

/** Texture size of a lore tablet face — small enough to stay chunky on a
 * ~0.6 m tablet, big enough for a glyph plus a line of "script". */
export const RUNE_TABLET_SIZE = 32;

/** The face of a lore tablet for `seed` (a lore fragment id): bevelled stone,
 * one large carved glyph, and a line of small script glyphs beneath it.
 * The emissive layer is GRAYSCALE — the model tints it with its `color`, so
 * one painted tablet works for any rune color. */
export function paintRuneTablet(seed: string): Painted {
  const S = RUNE_TABLET_SIZE;
  const rng = new Rng(hashSeed(`rune:${seed}`));
  const p = blank(S, { emissive: true });
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = rng.next();
      const rim = Math.min(x, y, S - 1 - x, S - 1 - y);
      let v = 78 + n * 22;
      let h = 0.55 + n * 0.12;
      if (rim === 0) {
        h = 0.72;
        v *= 0.7;
      } else if (rim === 1) {
        // Bevel lit from the upper left, shadowed lower right.
        h = 0.82;
        v *= x < S / 2 && y < S / 2 ? 1.25 : 0.85;
      } else if (n > 0.95) {
        v *= 0.6; // pits in the stone
        h -= 0.1;
      }
      put(p, x, y, v * 0.98, v * 0.96, v, h);
    }
  }
  // The main glyph, centred in the upper field. Its halo is dim so bloom
  // gathers it into a soft glow without smearing the strokes.
  const gw = 12;
  const gh = 15;
  const main = glyphMask(rng, gw, gh, 2);
  const gx = (S - gw) >> 1;
  const gy = 4;
  const halo = dilate(main, gw, gh);
  for (let i = 0; i < halo.length; i++) {
    if (halo[i]) glow(p, gx + (i % gw), gy + Math.floor(i / gw), 40, 40, 40);
  }
  carveGlyph(p, main, gw, gh, gx, gy, [255, 255, 255]);
  // A line of script: four small glyphs, dimmer than the main rune.
  for (let k = 0; k < 4; k++) {
    const m = glyphMask(rng, 3, 5, 1);
    carveGlyph(p, m, 3, 5, 7 + k * 5, 22, [130, 130, 130], 0.3);
  }
  return p;
}

/** A strip of `count` rune glyphs, each in a `cell`×`cell` square, as an
 * opaque grayscale mask (white stroke on black). Used as alphaMap +
 * emissiveMap for the portal's sealing runes, so one texture + one material
 * serve every plate. */
export function paintGlyphAtlas(count: number, cell: number): { rgba: RGBA; width: number; height: number } {
  const rng = new Rng(hashSeed("portal-seal"));
  const width = count * cell;
  const height = cell;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const pad = Math.max(1, Math.round(cell * 0.15));
  const gw = cell - pad * 2;
  const gh = cell - pad * 2;
  for (let k = 0; k < count; k++) {
    const m = glyphMask(rng, gw, gh, cell >= 16 ? 2 : 1);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!m[y * gw + x]) continue;
        const i = ((pad + y) * width + k * cell + pad + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
      }
    }
  }
  return { rgba, width, height };
}
