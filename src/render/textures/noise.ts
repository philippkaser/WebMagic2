/** CPU noise for painters. Everything tiles: lattice coordinates wrap at the
 * given period, so a texture repeats seamlessly across a wall run. */

export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (v: number, p: number) => ((v % p) + p) % p;

/** Smooth value noise, periodic in (px, py) lattice cells. */
export function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, px);
  const x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise over a w×h texture: `cells` lattice cells across the
 * width at the base octave (height gets the same density). */
export function fbm(
  x: number,
  y: number,
  w: number,
  h: number,
  cells: number,
  seed: number,
  octaves = 4,
): number {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  let cx = cells;
  let cy = Math.max(1, Math.round((cells * h) / w));
  for (let o = 0; o < octaves; o++) {
    v += amp * vnoise((x / w) * cx, (y / h) * cy, cx, cy, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    cx *= 2;
    cy *= 2;
  }
  return v / norm;
}

/** Ridged noise: thin bright lines where fbm crosses 0.5 — veins, cracks. */
export function ridge(x: number, y: number, w: number, h: number, cells: number, seed: number): number {
  return 1 - Math.abs(fbm(x, y, w, h, cells, seed, 3) * 2 - 1);
}

export interface Cell {
  /** Distance to nearest feature point, in cell units. */
  f1: number;
  /** Distance to second nearest — (f2 - f1) small means "near an edge". */
  f2: number;
  /** Stable id of the nearest cell (0..1). */
  id: number;
  /** Stable id of the second nearest cell — edge (id, id2) pairs let a
   * painter choose which seams crack or glow. */
  id2: number;
}

/** Tileable Worley noise with cx×cy cells over the texture. */
export function worley(x: number, y: number, w: number, h: number, cx: number, cy: number, seed: number): Cell {
  const u = (x / w) * cx;
  const v = (y / h) * cy;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  let id2 = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = wrap(iu + dx, cx);
      const gy = wrap(iv + dy, cy);
      const px = iu + dx + 0.15 + hash2(gx, gy, seed) * 0.7;
      const py = iv + dy + 0.15 + hash2(gx, gy, seed + 7) * 0.7;
      const d = Math.hypot(px - u, py - v);
      const cid = hash2(gx, gy, seed + 13);
      if (d < f1) {
        f2 = f1;
        id2 = id;
        f1 = d;
        id = cid;
      } else if (d < f2) {
        f2 = d;
        id2 = cid;
      }
    }
  }
  return { f1, f2, id, id2 };
}
