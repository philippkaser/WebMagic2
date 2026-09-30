import type { Rng } from "../../core/rng";

/** Pure pixel-buffer toolkit shared by every painter.
 *
 * Painters never touch the DOM or three.js: they fill plain typed arrays
 * (color, height, and optionally emissive / roughness) and hand them back.
 * That split is what makes the art unit-testable under `bun test` — the only
 * code that needs a real canvas is textures/canvas.ts. */

/** Edge length of prop and fixture textures. 64×64 is the art style: chunky
 * texels that still catch light through their Sobel normal map. */
export const TEX_SIZE = 64;

/** Edge length of the architecture surfaces (dungeon walls, floors,
 * ceilings). They are mapped from world position at ARCHITECTURE.texMetres
 * (4 m) per repeat, so 128 texels keep the same 32-texels-per-metre chunk
 * as a prop texture while the pattern only repeats every 4 m — big stones,
 * no obvious 2 m grid. */
export const ARCH_SIZE = 128;

/** RGBA bytes, row-major, row 0 = top of the image (canvas convention). */
export type RGBA = Uint8ClampedArray<ArrayBuffer>;

/** What a painter produces. `color` and `emissive` are sRGB; `height` and
 * `roughness` are linear 0..1 fields. Optional layers exist ONLY for kinds
 * that declare them — a surface without an emissive layer gets no
 * emissiveMap at all, so it costs nothing in the shader. */
export interface Painted {
  size: number;
  color: RGBA;
  /** 0 = deep groove, 1 = proud surface. Feeds the Sobel normal map. */
  height: Float32Array;
  /** Self-lit color (glowing cracks, veins, runes). Black = no glow. */
  emissive?: RGBA;
  /** Per-texel roughness (0 = mirror-wet, 1 = chalk-dry). */
  roughness?: Float32Array;
}

/** A painter is a pure function of its seeded RNG — same seed, same bytes. */
export type Painter = (rng: Rng) => Painted;

/** Recommended meshStandardMaterial params for a surface. Kept next to the
 * painter because a texture and the material it was painted for are one
 * design decision: a wet slab's low-roughness puddles only read if the
 * material lets the environment map through. */
export interface SurfaceHints {
  /** With a roughnessMap three.js MULTIPLIES this by the map's G channel, so
   * kinds that ship a roughness map use 1 and let the map speak. */
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  /** Tint multiplied with emissiveMap. Kinds with colored emissive maps use
   * white so the painted colors come through untouched. */
  emissive?: string;
  emissiveIntensity?: number;
}

/** One entry of the surface table: how to paint it + how to light it. */
export interface SurfaceDef {
  paint: Painter;
  hints: SurfaceHints;
  /** Normal-map strength (Sobel slope multiplier). Default 2.2. */
  normalStrength?: number;
  /** Mipmapped minification. Architecture surfaces are seen far away and at
   * grazing angles, where one low-res pixel covers dozens of texels: without
   * mips every mortar line and puddle edge sparkles into noise — exactly the
   * "clutter" a calm dungeon must avoid. Magnification stays Nearest, so up
   * close the texels are as chunky as ever. */
  mipmaps?: boolean;
}

export function blank(
  size = TEX_SIZE,
  layers: { emissive?: boolean; roughness?: boolean } = {},
): Painted {
  const n = size * size;
  const p: Painted = {
    size,
    color: new Uint8ClampedArray(n * 4),
    height: new Float32Array(n),
  };
  if (layers.emissive) {
    // Opaque black: canvases store premultiplied alpha, so alpha 0 would
    // silently erase any RGB written later.
    const e = new Uint8ClampedArray(n * 4);
    for (let i = 3; i < e.length; i += 4) e[i] = 255;
    p.emissive = e;
  }
  if (layers.roughness) p.roughness = new Float32Array(n).fill(1);
  return p;
}

/** Wrap a coordinate onto the torus — every surface texture tiles. */
export function wrap(v: number, size: number): number {
  return ((v % size) + size) % size;
}

/** Write one texel's color + height (the classic painter primitive). */
export function put(p: Painted, x: number, y: number, r: number, g: number, b: number, h: number): void {
  const i = (y * p.size + x) * 4;
  p.color[i] = r;
  p.color[i + 1] = g;
  p.color[i + 2] = b;
  p.color[i + 3] = 255;
  p.height[y * p.size + x] = h;
}

/** Scale an already-painted texel's color (e.g. darken it where it's wet). */
export function shade(p: Painted, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * p.size + x) * 4;
  p.color[i] *= r;
  p.color[i + 1] *= g;
  p.color[i + 2] *= b;
}

/** Add light to a texel's emissive layer. Max-blended per channel, so
 * overlapping glows (a crack crossing a crack) never darken each other. */
export function glow(p: Painted, x: number, y: number, r: number, g: number, b: number): void {
  const e = p.emissive;
  if (!e) return;
  const i = (wrap(y, p.size) * p.size + wrap(x, p.size)) * 4;
  if (r > e[i]) e[i] = r;
  if (g > e[i + 1]) e[i + 1] = g;
  if (b > e[i + 2]) e[i + 2] = b;
}

export function setRoughness(p: Painted, x: number, y: number, v: number): void {
  if (p.roughness) p.roughness[y * p.size + x] = Math.min(1, Math.max(0, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Split `total` texels into runs of min..max (course heights, block widths).
 * The runs always sum to exactly `total`, so the result tiles. With a narrow
 * range an occasional run may fall below `min` — fine for masonry; painters
 * that need exact sizes pick their own pattern. */
export function splitSpan(rng: Rng, total: number, min: number, max: number): number[] {
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    if (left <= max) {
      out.push(left);
      break;
    }
    let w = rng.int(min, max);
    // Never strand a runt: leave exactly `min` if possible, else halve.
    if (left - w < min) w = left >= 2 * min ? left - min : Math.ceil(left / 2);
    out.push(w);
    left -= w;
  }
  return out;
}

/** Seamlessly tiling value noise: a `cells`×`cells` lattice of random values
 * on a torus, smoothstep-interpolated. Returns size*size values in 0..1.
 * Used for large, soft features (damp patches, ash drifts, heat) that must
 * not show a seam where the texture repeats. */
export function tileNoise(rng: Rng, cells: number, size = TEX_SIZE): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const out = new Float32Array(size * size);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = s(fy - y0);
    const r0 = y0 * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = s(fx - x0);
      const x1 = (x0 + 1) % cells;
      const top = lerp(lattice[r0 + x0], lattice[r0 + x1], tx);
      const bot = lerp(lattice[r1 + x0], lattice[r1 + x1], tx);
      out[y * size + x] = lerp(top, bot, ty);
    }
  }
  return out;
}

/** Masonry layout: courses of blocks with offset joints, tiling on the torus.
 *  - `id`: unique block id per texel (for per-block tone).
 *  - `edge`: 0 on a joint texel, else distance (texels) to the nearest
 *    joint, capped at 4 — bevels and wet seams key off it.
 *  - `across`: 0..1 position across the course (top→bottom, or left→right
 *    when `vertical`) — lets a painter round a column or dome a block.
 * `vertical` turns courses into columns (basalt jointing). */
export interface BlockField {
  id: Int32Array;
  edge: Uint8Array;
  across: Float32Array;
}

export function blockField(
  rng: Rng,
  size: number,
  course: [number, number],
  block: [number, number],
  vertical = false,
): BlockField {
  const id = new Int32Array(size * size);
  const edge = new Uint8Array(size * size);
  const across = new Float32Array(size * size);
  const courses = splitSpan(rng, size, course[0], course[1]);
  let c0 = 0;
  courses.forEach((ch, ci) => {
    const blocks = splitSpan(rng, size, block[0], block[1]);
    const shift = rng.int(0, size - 1);
    // Start offset of each block along the course (before the shift).
    const starts: number[] = [];
    let acc = 0;
    for (const w of blocks) {
      starts.push(acc);
      acc += w;
    }
    for (let a = 0; a < ch; a++) {
      const dA = Math.min(a, ch - a);
      for (let b = 0; b < size; b++) {
        const local = wrap(b - shift, size);
        let bi = 0;
        while (bi + 1 < starts.length && starts[bi + 1] <= local) bi++;
        const pos = local - starts[bi];
        const dB = Math.min(pos, blocks[bi] - pos);
        const x = vertical ? c0 + a : b;
        const y = vertical ? b : c0 + a;
        const i = y * size + x;
        id[i] = ci * 64 + bi;
        edge[i] = Math.min(4, dA, dB);
        across[i] = ch > 1 ? a / (ch - 1) : 0.5;
      }
    }
    c0 += ch;
  });
  return { id, edge, across };
}

/** Irregular ashlar: courses of offset stones like `blockField`, but some
 * stones are split into two shorter ones, so no course line runs unbroken
 * for long and the pattern reads as hand-laid rather than as a brick grid.
 *  - `id`: unique per stone (feed it to blockTone for per-stone tone).
 *  - `edge`: 0 on a joint, else distance (texels) to the stone's nearest
 *    edge, capped at 6 — bevels, wear and seep key off it.
 *  - `u`, `v`: 0..1 position inside the stone (left→right, top→bottom), for
 *    doming, dishing and wear that follows the stone's shape.
 * `vertical` turns courses into columns (columnar basalt). Tiles on the
 * torus like every other field. */
export interface AshlarField {
  id: Int32Array;
  edge: Uint8Array;
  u: Float32Array;
  v: Float32Array;
}

export function ashlarField(
  rng: Rng,
  size: number,
  course: [number, number],
  block: [number, number],
  splitChance: number,
  vertical = false,
): AshlarField {
  const n = size * size;
  const id = new Int32Array(n);
  const edge = new Uint8Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const courses = splitSpan(rng, size, course[0], course[1]);
  let c0 = 0;
  courses.forEach((ch, ci) => {
    const blocks = splitSpan(rng, size, block[0], block[1]);
    const shift = rng.int(0, size - 1);
    const starts: number[] = [];
    // Row (within the course) where each block splits in two, or 0 = whole.
    const splits: number[] = [];
    let acc = 0;
    for (const w of blocks) {
      starts.push(acc);
      acc += w;
      // Only tall courses split — halving a short one leaves slivers that
      // read as a double joint line, not as two stones.
      const canSplit = ch >= Math.max(22, course[0] * 1.3);
      splits.push(canSplit && rng.chance(splitChance) ? rng.int(Math.floor(ch * 0.4), Math.ceil(ch * 0.6)) : 0);
    }
    for (let a = 0; a < ch; a++) {
      for (let b = 0; b < size; b++) {
        const local = wrap(b - shift, size);
        let bi = 0;
        while (bi + 1 < starts.length && starts[bi + 1] <= local) bi++;
        const pos = local - starts[bi];
        const w = blocks[bi];
        const split = splits[bi];
        const lower = split > 0 && a >= split;
        const top = lower ? split : 0;
        const h = split > 0 ? (lower ? ch - split : split) : ch;
        const dy = a - top;
        const x = vertical ? c0 + a : b;
        const y = vertical ? b : c0 + a;
        const i = y * size + x;
        id[i] = ci * 4096 + bi * 2 + (lower ? 1 : 0);
        edge[i] = Math.min(6, dy, h - dy, pos, w - pos);
        // In column mode "across the course" is x, so swap the axes back.
        const across = h > 1 ? dy / (h - 1) : 0.5;
        const along = w > 1 ? pos / (w - 1) : 0.5;
        u[i] = vertical ? across : along;
        v[i] = vertical ? along : across;
      }
    }
    c0 += ch;
  });
  return { id, edge, u, v };
}

/** Several tileNoise octaves summed and renormalised to 0..1 — soft,
 * low-frequency variation (damp, grime, ash drifts) with a little finer
 * break-up so it never looks like a blurred blob. `layers` are
 * [lattice cells, weight] pairs. */
export function layeredNoise(rng: Rng, size: number, layers: [number, number][]): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  for (const [cells, weight] of layers) {
    const n = tileNoise(rng, cells, size);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * weight;
    total += weight;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Smooth 0..1 ramp between two edges (GLSL smoothstep). */
export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Deterministic per-block tone in -1..1 without consuming painter RNG. */
export function blockTone(id: number, salt = 0): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Toroidal Voronoi: nearest + second-nearest seed per texel. `aspect`
 * stretches vertical distance (wall texels are twice as tall in the world as
 * they are wide, so aspect 2 keeps wall facets looking round, not tall). */
export interface VoronoiField {
  points: { x: number; y: number }[];
  cell: Uint16Array;
  cell2: Uint16Array;
  d1: Float32Array;
  d2: Float32Array;
}

export function voronoi(rng: Rng, count: number, size = TEX_SIZE, aspect = 1): VoronoiField {
  const points = Array.from({ length: count }, () => ({
    x: rng.next() * size,
    y: rng.next() * size,
  }));
  const n = size * size;
  const cell = new Uint16Array(n);
  const cell2 = new Uint16Array(n);
  const d1 = new Float32Array(n);
  const d2 = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = Infinity;
      let second = Infinity;
      let bi = 0;
      let si = 0;
      for (let k = 0; k < count; k++) {
        let dx = Math.abs(x + 0.5 - points[k].x);
        let dy = Math.abs(y + 0.5 - points[k].y);
        if (dx > size / 2) dx = size - dx;
        if (dy > size / 2) dy = size - dy;
        const d = Math.hypot(dx, dy * aspect);
        if (d < best) {
          second = best;
          si = bi;
          best = d;
          bi = k;
        } else if (d < second) {
          second = d;
          si = k;
        }
      }
      const i = y * size + x;
      cell[i] = bi;
      cell2[i] = si;
      d1[i] = best;
      d2[i] = second;
    }
  }
  return { points, cell, cell2, d1, d2 };
}

/** Signed toroidal offset from `from` to `to` (shortest way round). */
export function torusDelta(to: number, from: number, size: number): number {
  let d = to - from;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

/** Warm the texels 4-adjacent to a glowing mask and give them a dim emissive
 * halo — a crack reads as a crack of LIGHT only if the rock beside it is lit
 * too. `tint` scales their color; `rgb` is the halo's emissive. */
export function haloAround(
  p: Painted,
  mask: Uint8Array,
  tint: [number, number, number],
  rgb: [number, number, number],
): void {
  const S = p.size;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (mask[y * S + x]) continue;
      if (
        mask[y * S + wrap(x + 1, S)] ||
        mask[y * S + wrap(x - 1, S)] ||
        mask[wrap(y + 1, S) * S + x] ||
        mask[wrap(y - 1, S) * S + x]
      ) {
        shade(p, x, y, tint[0], tint[1], tint[2]);
        glow(p, x, y, rgb[0], rgb[1], rgb[2]);
      }
    }
  }
}

/** The 8 walk headings, clockwise from +x (row-down is +y). */
const DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
] as const;

/** A crack/vein: a jagged walk that holds an overall heading, jittering
 * ±45° per step and only slowly drifting — fractures run somewhere, they
 * don't curl like worms. Calls `plot(x, y, t)` per texel (wrapped), with
 * t = 0..1 along the walk. `heading` 0..7 (see DIRS; 6 = up the texture). */
export function walk(
  rng: Rng,
  size: number,
  length: number,
  plot: (x: number, y: number, t: number) => void,
  start?: { x?: number; y?: number; heading?: number },
): void {
  let x = start?.x ?? rng.int(0, size - 1);
  let y = start?.y ?? rng.int(0, size - 1);
  let heading = start?.heading ?? rng.int(0, 7);
  for (let s = 0; s < length; s++) {
    plot(wrap(x, size), wrap(y, size), length > 1 ? s / (length - 1) : 0);
    const r = rng.next();
    const jitter = r < 0.3 ? 1 : r < 0.6 ? 7 : 0;
    const dir = (heading + jitter) % 8;
    x += DIRS[dir][0];
    y += DIRS[dir][1];
    if (rng.next() < 0.07) heading = (heading + (rng.chance(0.5) ? 1 : 7)) % 8;
  }
}
