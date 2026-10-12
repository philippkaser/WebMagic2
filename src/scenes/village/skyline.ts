import { hash2 } from "../../render/textures/pixelKit";

/** The land round the valley, as the backdrop draws it (village/Sky): it
 * rides with the eye, so it's measured from the eye — the great range a
 * heightfield in metres round it (ridges running in toward you, two titans
 * either side of the moon, a saddle under it), the near hills a crest in
 * angles. Both are as big as the angles they fill, however far you walk.
 *
 * Bearings: 0 = +x, increasing toward +z; NORTH (−z, behind the gate as
 * you come up the lane) is −π/2. The moon rises in the north, in the
 * saddle between the two great peaks. */

export const NORTH = -Math.PI / 2;
const DEG = Math.PI / 180;

/** Where the moon stands: elevation of its centre, and its angular radius. */
export const MOON_ELEVATION = 21 * DEG;
export const MOON_ANGULAR_RADIUS = 6.5 * DEG;

/** Signed angle from `a` to `b`, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Smooth periodic value noise around the circle: `cells` knots. */
function ringNoise(bearing: number, cells: number, seed: number): number {
  const t = ((bearing / (Math.PI * 2)) % 1 + 1) % 1 * cells;
  const i = Math.floor(t);
  const f = t - i;
  const a = hash2(i % cells, 0, seed);
  const b = hash2((i + 1) % cells, 0, seed);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

/** The near hills' crest elevation (radians) at a bearing: low and
 * forested — a fringe of pine tips along a rolling line, standing in front
 * of the great range all round the valley. */
export function hillsCrest(bearing: number): number {
  const roll = 1.2 * DEG * ringNoise(bearing, 13, 31) + 0.6 * DEG * ringNoise(bearing, 37, 32);
  return 0.6 * DEG + roll + pineFringe(bearing);
}

/** A row of pine tips: sawtooth spikes of varying height, about one every
 * half a degree (each a few pixels across at the world's resolution). */
function pineFringe(bearing: number): number {
  const per = 0.55 * DEG;
  const t = bearing / per;
  const i = Math.floor(t);
  const f = t - i;
  const h = hash2(((i % 100000) + 100000) % 100000, 1, 41);
  const tip = (0.25 + 0.55 * h) * DEG;
  // Some gaps between the trees.
  if (h < 0.12) return 0;
  return Math.max(0, tip * (1 - Math.abs(f * 2 - 1) * 1.15));
}

// ── The great range, in 3D ──────────────────────────────────────────────────

/** The range is a heightfield in the backdrop's own space (metres round the
 * eye, which rides at its origin): a ring of land from RANGE_INNER to
 * RANGE_OUTER, its ridges and valleys running in toward you like real
 * aretes, two titans either side of the moon and a saddle beneath it. Its
 * floor lies below the horizon, under the valley's forest. */
export const RANGE_INNER = 44;
export const RANGE_OUTER = 94;
export const RANGE_FLOOR = -7;

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Ridged multifractal: sharp crests, each octave strongest where the last
 * was high — peaks get detail, valleys stay smooth. 0…~1. */
function ridgedField(x: number, y: number): number {
  // Warp the domain so the ridges wander.
  const wx = x + (vnoise(x * 0.35, y * 0.35, 71) - 0.5) * 2.4;
  const wy = y + (vnoise(x * 0.35 + 9.1, y * 0.35, 72) - 0.5) * 2.4;
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  let weight = 1;
  for (let o = 0; o < 5; o++) {
    let n = 1 - Math.abs(vnoise(wx * freq, wy * freq, 80 + o) * 2 - 1);
    n *= n;
    n *= weight;
    weight = Math.min(1, n * 1.8);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm / 0.62;
}

const gauss = (d: number, w: number) => Math.exp(-(d * d) / (w * w));

/** Height (m, relative to the eye) of the range at (x, z) in backdrop space. */
export function rangeHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const off = angleDiff(NORTH, Math.atan2(z, x));
  const north = Math.pow(Math.max(0, Math.cos(off)), 1.4);
  // Rises from its inner edge, highest in the middle-far band.
  const band = smoothstep(RANGE_INNER, RANGE_INNER + 20, r) * (1 - 0.3 * smoothstep(84, RANGE_OUTER, r));
  // The massif: low hills round the valley, mountains in the north, two
  // titans either side of the moon (far back), a saddle under it.
  const titans =
    20 * gauss(off + 21 * DEG, 7 * DEG) * gauss(r - 78, 11) + 16 * gauss(off - 23 * DEG, 8 * DEG) * gauss(r - 74, 12);
  const saddle = 16 * gauss(off, 9 * DEG);
  const envelope = Math.max(6, 10 + 26 * north + titans - saddle);
  // Big ridges about every 10° of the far band; finer aretes on them.
  const field = ridgedField(x / 13, z / 13);
  return RANGE_FLOOR + band * envelope * (0.3 + 0.7 * field);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The range's skyline from the eye: the highest elevation (radians) any of
 * it reaches at a bearing. */
export function rangeSilhouette(bearing: number, steps = 60): number {
  let best = -Math.PI / 2;
  const c = Math.cos(bearing);
  const sn = Math.sin(bearing);
  for (let i = 0; i <= steps; i++) {
    const r = RANGE_INNER + ((RANGE_OUTER - RANGE_INNER) * i) / steps;
    best = Math.max(best, Math.atan2(rangeHeight(c * r, sn * r), r));
  }
  return best;
}
