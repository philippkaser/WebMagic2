import { gridVisible, isOpen, type OccupancyGrid, unstick } from "./gridRay";

/** Coloured bounce light, baked once per floor: a cheap 2D light-propagation
 * pass over the tile grid (classic light propagation volumes, flattened —
 * the walls are full height, so the floor plan is the whole story).
 *
 *  1. Direct: each static light's irradiance at every open cell of a grid
 *     `res`× finer than the tiles, kept on its side of the walls by the same
 *     DDA the shadows use (gridRay.ts).
 *  2. Bounce: that light, times the stone's albedo, diffused over the open
 *     cells — a 3×3 average over open neighbours, repeated, every step
 *     accumulated. Light that hits a wall stays in the room (the average
 *     skips rock, so rock reflects instead of soaking it up); a doorway
 *     lets only its width through, so the spill round a corner is real but
 *     faint, and it fades with every cell it bends.
 *  3. The result is grown one cell into the rock, so a linear-filtered
 *     lookup at a wall's foot reads the room, not black.
 *
 * Pure (no three.js): lightGrid.ts uploads the field and the dungeon's
 * surfaces add it to their ambient irradiance. */

export interface BounceLight {
  /** World position, metres. */
  x: number;
  y: number;
  z: number;
  /** Linear rgb (0..1). */
  color: [number, number, number];
  /** three.js point-light intensity (candela-ish) and cutoff distance. */
  intensity: number;
  range: number;
}

export interface BounceOptions {
  /** Field cells per tile. */
  res?: number;
  /** Metres per tile. */
  tile?: number;
  /** Share of light the stone throws back. */
  albedo?: number;
  /** Diffusion steps (spread ≈ √(2k/3) cells). */
  iterations?: number;
}

export interface BakedBounce {
  /** Cells per side (size × res). */
  width: number;
  /** width² × rgb, linear irradiance. */
  rgb: Float32Array;
}

/** three's punctual window: (1 − (d/range)⁴)², clamped. */
function window(d: number, range: number): number {
  if (range <= 0) return 1;
  const x = d / range;
  const w = Math.max(0, 1 - x * x * x * x);
  return w * w;
}

export function bakeBounce(g: OccupancyGrid, lights: readonly BounceLight[], opts: BounceOptions = {}): BakedBounce {
  const res = opts.res ?? 2;
  const tile = opts.tile ?? 2;
  const albedo = opts.albedo ?? 0.3;
  const iterations = opts.iterations ?? 20;
  const n = g.size * res;
  const cellM = tile / res;
  const open = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) open[j * n + i] = isOpen(g, Math.floor(i / res), Math.floor(j / res)) ? 1 : 0;

  // 1. Direct light per open cell (omnidirectional: floor and walls alike).
  const direct = new Float32Array(n * n * 3);
  for (const l of lights) {
    // Light → cell units of the tile grid, out of any rock it hangs in.
    const [lx, ly] = unstick(g, l.x / tile + g.size / 2, l.z / tile + g.size / 2);
    const reach = Math.ceil(l.range / cellM);
    const ci = Math.floor(lx * res);
    const cj = Math.floor(ly * res);
    for (let j = Math.max(0, cj - reach); j <= Math.min(n - 1, cj + reach); j++) {
      for (let i = Math.max(0, ci - reach); i <= Math.min(n - 1, ci + reach); i++) {
        const k = j * n + i;
        if (!open[k]) continue;
        const px = (i + 0.5) / res;
        const py = (j + 0.5) / res;
        const dx = (px - lx) * tile;
        const dz = (py - ly) * tile;
        // To the air of the cell half-way up to the light (floor and walls).
        const h = l.y * 0.5;
        const d = Math.sqrt(dx * dx + dz * dz + h * h);
        if (d >= l.range) continue;
        if (!gridVisible(g, px, py, lx, ly, 64)) continue;
        const e = (l.intensity * window(d, l.range)) / Math.max(d * d, 1);
        direct[k * 3] += e * l.color[0];
        direct[k * 3 + 1] += e * l.color[1];
        direct[k * 3 + 2] += e * l.color[2];
      }
    }
  }

  // 2. Diffuse the reflected light over the open cells, accumulating.
  let cur = new Float32Array(n * n * 3);
  for (let k = 0; k < n * n * 3; k++) cur[k] = direct[k] * albedo;
  let next = new Float32Array(n * n * 3);
  const acc = new Float32Array(n * n * 3);
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (!open[k]) {
          next[k * 3] = next[k * 3 + 1] = next[k * 3 + 2] = 0;
          continue;
        }
        let r = 0;
        let gg = 0;
        let b = 0;
        let w = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const y = j + dj;
          if (y < 0 || y >= n) continue;
          for (let di = -1; di <= 1; di++) {
            const x = i + di;
            if (x < 0 || x >= n) continue;
            const q = y * n + x;
            if (!open[q]) continue;
            r += cur[q * 3];
            gg += cur[q * 3 + 1];
            b += cur[q * 3 + 2];
            w++;
          }
        }
        next[k * 3] = r / w;
        next[k * 3 + 1] = gg / w;
        next[k * 3 + 2] = b / w;
      }
    }
    for (let k = 0; k < n * n * 3; k++) acc[k] += next[k] / iterations;
    const t = cur;
    cur = next;
    next = t;
  }

  // 3. Grow one cell into the rock (4-neighbour average of open cells).
  const out = acc.slice();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (open[k]) continue;
      let w = 0;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= n || y >= n || !open[y * n + x]) continue;
        const q = y * n + x;
        out[k * 3] += acc[q * 3];
        out[k * 3 + 1] += acc[q * 3 + 1];
        out[k * 3 + 2] += acc[q * 3 + 2];
        w++;
      }
      if (w > 0) {
        out[k * 3] /= w;
        out[k * 3 + 1] /= w;
        out[k * 3 + 2] /= w;
      }
    }
  }
  return { width: n, rgb: out };
}

/** sRGB hex → linear rgb (0..1), the way three reads a light's colour. */
export function linearRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
}
