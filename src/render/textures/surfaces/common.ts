import type { Rng } from "../../../core/rng";
import { glow, put, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm, hash2, worley } from "../noise";
import { mix, scale, type Rgb } from "../palette";

/** Building blocks shared by the biome surface painters: masonry and
 * flagstone bases plus weathering overlays (grime, cracks, drips, puddles)
 * and small pixel stamps (glyphs, sprites). Painters compose these, then add
 * the one or two signature touches that make their biome unmistakable. */

export type Tone = (t: number) => Rgb;

export interface BrickHit {
  mortar: boolean;
  /** Stable per-brick random (0..1). */
  id: number;
  row: number;
  col: number;
  /** Pixels to the nearest mortar line (0 = rim pixel). */
  edge: number;
}

/** Running-bond masonry with a per-row random offset, so courses don't
 * line up into an obvious grid. `bw` must divide the texture width. */
export function brickAt(x: number, y: number, w: number, bw: number, bh: number, seed: number): BrickHit {
  const row = Math.floor(y / bh);
  const offset = Math.floor(hash2(row, 0, seed) * bw);
  const xx = (x + offset) % w;
  const col = Math.floor(xx / bw);
  const u = xx - col * bw;
  const v = y - row * bh;
  const mortar = u === 0 || v === 0;
  return {
    mortar,
    id: hash2(col, row, seed + 3),
    row,
    col,
    edge: Math.min(u - 1, bw - 1 - u, v - 1, bh - 1 - v),
  };
}

export interface BlockStyle {
  bw: number;
  bh: number;
  stone: Tone;
  mortar: Rgb;
  seed: number;
  /** How strongly large-scale noise mottles each block (0..1). */
  mottle?: number;
}

/** Fill a surface with bevelled masonry. Returns nothing — painters layer
 * weathering on top. */
export function paintBlocks(p: Painted, rng: Rng, s: BlockStyle): void {
  const mottle = s.mottle ?? 0.35;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const b = brickAt(x, y, p.w, s.bw, s.bh, s.seed);
      const fine = rng.next();
      if (b.mortar) {
        putRgb(p, x, y, scale(s.mortar, 0.8 + fine * 0.4), 0.08);
        setRough(p, x, y, 1);
        continue;
      }
      const n = fbm(x, y, p.w, p.h, 8, s.seed + 5);
      const rim = b.edge <= 0 ? -0.14 : b.edge === 1 ? -0.05 : 0;
      const t = 0.22 + b.id * 0.5 + (n - 0.5) * mottle * 2 + (fine - 0.5) * 0.14 + rim;
      putRgb(p, x, y, s.stone(t), 0.45 + Math.min(b.edge, 2) * 0.14 + n * 0.2 + fine * 0.06);
      setRough(p, x, y, 0.8 + fine * 0.15);
    }
  }
}

export interface FlagStyle {
  /** Worley cells across the texture. */
  cells: number;
  stone: Tone;
  gap: Rgb;
  seed: number;
  /** Seam width in cell units (≈0.05–0.1). */
  gapWidth?: number;
}

/** Irregular flagstones (Worley cells), each slab its own tone, worn in the
 * middle and chipped at the seams. */
export function paintFlagstones(p: Painted, rng: Rng, s: FlagStyle): void {
  const gw = s.gapWidth ?? 0.07;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const c = worley(x, y, p.w, p.h, s.cells, s.cells, s.seed);
      const edge = c.f2 - c.f1;
      const fine = rng.next();
      const n = fbm(x, y, p.w, p.h, 6, s.seed + 9);
      if (edge < gw + (n - 0.5) * 0.05) {
        putRgb(p, x, y, scale(s.gap, 0.8 + fine * 0.4), 0.05);
        setRough(p, x, y, 1);
        continue;
      }
      const chip = edge < gw * 2 ? -0.1 : 0;
      const t = 0.2 + c.id * 0.45 + (n - 0.5) * 0.5 + (fine - 0.5) * 0.12 + chip;
      putRgb(p, x, y, s.stone(t), 0.5 + Math.min(edge, 0.3) + fine * 0.1);
      setRough(p, x, y, 0.72 + n * 0.2);
    }
  }
}

/** Darken/tint a vertical band (y0→y1 as fractions of height), fading in
 * with noise: soot under the ceiling, grime and damp at the foot of a wall. */
export function grimeBand(p: Painted, y0: number, y1: number, color: Rgb, strength: number, seed: number) {
  const a = Math.floor(y0 * p.h);
  const b = Math.floor(y1 * p.h);
  for (let y = a; y < b; y++) {
    const ramp = (y - a) / Math.max(1, b - a);
    const k = y1 >= 1 ? ramp : 1 - ramp; // bottom bands grow downward, top bands upward
    for (let x = 0; x < p.w; x++) {
      const n = fbm(x, y, p.w, p.h, 8, seed);
      const t = Math.max(0, Math.min(1, k * strength * (0.5 + n)));
      tint(p, x, y, color, t);
    }
  }
}

/** Random-walk hairline cracks; depth carved into the height field. */
export function cracks(p: Painted, rng: Rng, count: number, color: Rgb, len = 18, glowColor?: Rgb) {
  for (let c = 0; c < count; c++) {
    let x = rng.int(0, p.w - 1);
    let y = rng.int(0, p.h - 1);
    let dir = rng.range(0, Math.PI * 2);
    const n = rng.int(len / 2, len);
    for (let i = 0; i < n; i++) {
      const xi = ((Math.round(x) % p.w) + p.w) % p.w;
      const yi = Math.round(y);
      if (yi < 0 || yi >= p.h) break;
      putRgb(p, xi, yi, color, 0.02);
      setRough(p, xi, yi, 1);
      if (glowColor) glow(p, xi, yi, glowColor, 1 - (i / n) * 0.6);
      dir += rng.range(-0.7, 0.7);
      x += Math.cos(dir);
      y += Math.sin(dir);
    }
  }
}

/** Vertical streaks running down from a point — water, rust, soot. */
export function drips(p: Painted, rng: Rng, count: number, color: Rgb, strength: number, wet = false) {
  for (let d = 0; d < count; d++) {
    const x0 = rng.int(0, p.w - 1);
    const y0 = rng.int(0, Math.floor(p.h * 0.5));
    const len = rng.int(p.h * 0.2, p.h * 0.7);
    let x = x0;
    for (let i = 0; i < len && y0 + i < p.h; i++) {
      const y = y0 + i;
      if (rng.chance(0.06)) x = (x + (rng.chance(0.5) ? 1 : p.w - 1)) % p.w;
      const fade = 1 - i / len;
      tint(p, x, y, color, strength * fade);
      if (wet) setRough(p, x, y, 0.25);
    }
  }
}

/** Low-lying pools: where fbm peaks, the floor darkens and turns mirror-wet. */
export function puddles(p: Painted, seed: number, threshold: number, water: Rgb, cells = 3) {
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const n = fbm(x, y, p.w, p.h, cells, seed, 3);
      if (n < threshold) continue;
      const depth = Math.min(1, (n - threshold) * 12);
      tint(p, x, y, water, 0.35 + depth * 0.45);
      setRough(p, x, y, 0.22 - depth * 0.17);
      p.height[y * p.w + x] = 0.3; // flat water surface
    }
  }
}

/** A random rune glyph on a gw×gh pixel grid: 2–4 strokes between nodes. */
export function glyph(rng: Rng, gw = 5, gh = 7): boolean[] {
  const bits = new Array<boolean>(gw * gh).fill(false);
  const nodes: [number, number][] = [];
  for (const nx of [0, (gw - 1) / 2, gw - 1]) for (const ny of [0, (gh - 1) / 2, gh - 1]) nodes.push([nx, ny]);
  const strokes = rng.int(2, 4);
  for (let s = 0; s < strokes; s++) {
    const [ax, ay] = rng.pick(nodes);
    const [bx, by] = rng.pick(nodes);
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / steps);
      const y = Math.round(ay + ((by - ay) * i) / steps);
      bits[y * gw + x] = true;
    }
  }
  return bits;
}

/** Carve a glyph into the surface; optionally make its grooves glow. */
export function carveGlyph(
  p: Painted,
  bits: boolean[],
  gw: number,
  x0: number,
  y0: number,
  groove: Rgb,
  glowColor?: Rgb,
) {
  const gh = bits.length / gw;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!bits[y * gw + x]) continue;
      const px = (x0 + x) % p.w;
      const py = y0 + y;
      if (py < 0 || py >= p.h) continue;
      putRgb(p, px, py, groove, 0.05);
      if (glowColor) glow(p, px, py, glowColor);
    }
  }
}

/** Stamp an ascii sprite; each char maps to [color, height] (space = skip). */
export function stamp(
  p: Painted,
  sprite: string[],
  x0: number,
  y0: number,
  palette: Record<string, [Rgb, number]>,
) {
  sprite.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const entry = palette[line[x]];
      if (!entry) continue;
      const px = x0 + x;
      const py = y0 + y;
      if (px < 0 || py < 0 || px >= p.w || py >= p.h) continue;
      putRgb(p, px, py, entry[0], entry[1]);
    }
  });
}

/** Pixel-noise helper for painters that roll their own base. */
export function speckle(p: Painted, rng: Rng, chance: number, color: Rgb, h: number) {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) if (rng.chance(chance)) putRgb(p, x, y, color, h);
}

/** Dark hole in the wall (missing brick, niche) with a lit rim below. */
export function hole(p: Painted, x0: number, y0: number, w: number, h: number, dark: Rgb, lip: Rgb) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const px = ((x % p.w) + p.w) % p.w;
      if (y < 0 || y >= p.h) continue;
      const depth = (y - y0) / h;
      put(p, px, y, ...mix(dark, scale(dark, 1.6), depth), 0);
      setRough(p, px, y, 1);
    }
    if (y === y0 + h - 1 && y + 1 < p.h)
      for (let x = x0; x < x0 + w; x++) putRgb(p, ((x % p.w) + p.w) % p.w, y + 1, lip, 0.7);
  }
}
