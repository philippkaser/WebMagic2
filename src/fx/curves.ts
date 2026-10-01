/** Pure curve and emitter maths shared by the particle simulation, the
 * gameplay effects and the ambient volumes. No three.js, no allocation in the
 * hot helpers — everything here runs thousands of times a frame and is
 * unit-tested (curves.test.ts). */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Decelerating ease: fast start, gentle arrival (rings, puffs). */
export const easeOutCubic = (t: number): number => {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
};

/** Ease-out with a stronger snap, for shockwaves that should read as a
 * pressure front: most of the radius is covered in the first third. */
export const easeOutQuint = (t: number): number => {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u * u;
};

/** Alpha envelope over a particle's normalised life `t` (0..1): a linear
 * fade-in over the first `fadeIn` of life, then a power fade-out. A fade-in
 * matters for anything that spawns big (smoke, fireballs): popping in at full
 * opacity reads as a sprite, fading in over a few frames reads as a volume. */
export function lifeAlpha(t: number, fadeIn: number, fadeOutPow: number): number {
  const c = clamp01(t);
  const inA = fadeIn > 0 ? clamp01(c / fadeIn) : 1;
  const outA = Math.pow(1 - c, fadeOutPow);
  return inA * outA;
}

/** Size over life. `curve` picks the shape:
 * - 0 "shrink": start → end on (1 − t²), so it holds its size then collapses
 *   (the legacy look, and sparks/embers burning out);
 * - 1 "grow":   start → end on easeOutCubic (smoke, rings, fireballs);
 * - 2 "pop":    swells fast to `end` in the first 15% then eases back to
 *   `start` (flashes and cores that punch, then settle). */
export function lifeSize(t: number, start: number, end: number, curve: number): number {
  const c = clamp01(t);
  if (curve === 1) return lerp(start, end, easeOutCubic(c));
  if (curve === 2) {
    if (c < 0.15) return lerp(start, end, easeOutCubic(c / 0.15));
    return lerp(end, start, (c - 0.15) / 0.85);
  }
  // shrink: from start toward end, accelerating
  return lerp(start, end, c * c);
}

/** Colour-over-life mix factor: `pow(t, k)`. k < 1 cools quickly (sparks go
 * from white-hot to their tint within a few frames); k > 1 holds the start
 * colour and only shifts late (smoke darkening as it thins). */
export const colorMix = (t: number, k: number): number => Math.pow(clamp01(t), k);

/** Deterministic 0..1 hash of a float — a per-particle "random" that can be
 * recomputed any frame from a stored seed (flicker phases, wobble). */
export function hash01(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Flicker multiplier in [1 − amount, 1]: two incommensurate sines so the
 * pattern never visibly repeats. */
export function flicker(time: number, seed: number, amount: number): number {
  const w = 0.5 + 0.5 * Math.sin(time * 17.3 + seed * 40) * Math.sin(time * 7.9 + seed * 13);
  return 1 - amount * (1 - w);
}

/** Quantize a 0..1 value into `bands` flat levels: 0, 1/(bands−1), …, 1.
 * Colour-over-life goes through this, so a spark steps white → yellow →
 * tint → dim like a hand-painted palette ramp instead of gliding. */
export function steps(x: number, bands: number): number {
  if (bands < 2) return clamp01(x);
  return Math.min(1, Math.floor(clamp01(x) * bands) / (bands - 1));
}

/** Flicker as a pixel artist would animate it: the brightness SWITCHES
 * between three levels in [1 − amount, 1] (see flicker for the pattern),
 * rather than breathing smoothly. */
export function steppedFlicker(time: number, seed: number, amount: number): number {
  if (amount <= 0) return 1;
  const w = (flicker(time, seed, amount) - (1 - amount)) / amount;
  return 1 - amount * (1 - steps(w, 3));
}

/** A sprite's size in whole pixels, as the particle and ambient shaders
 * draw it: the core is round(2 × half-extent) pixels, never below one. A
 * sprite smaller than a pixel keeps its one pixel and is instead dithered
 * out by its coverage (floored at `minCoverage`), so a steady subset of
 * distant sparks shows rather than all of them shimmering as they cross
 * pixel centres. (Mirrored in the vertex shaders; kept here so it's tested.) */
export function pixelSpan(
  halfPx: number,
  out: { n: number; coverage: number },
  minCoverage = 0.08,
): { n: number; coverage: number } {
  const full = 2 * Math.max(0, halfPx);
  out.n = Math.max(1, Math.floor(full + 0.5));
  out.coverage = full < 1 ? Math.max(full, minCoverage) : 1;
  return out;
}

/** Scratch 3-vector for the emitter helpers (they write into it rather than
 * allocating). */
export interface MutVec3 {
  x: number;
  y: number;
  z: number;
}

/** Uniform random unit vector (Archimedes: uniform z, uniform angle). */
export function randomUnit(out: MutVec3, rand: () => number = Math.random): MutVec3 {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  out.x = r * Math.cos(a);
  out.y = z;
  out.z = r * Math.sin(a);
  return out;
}

/** Random unit vector within `cone` radians of the unit axis (dx, dy, dz),
 * uniform over the spherical cap. cone ≥ π gives the whole sphere. */
export function randomInCone(
  dx: number,
  dy: number,
  dz: number,
  cone: number,
  out: MutVec3,
  rand: () => number = Math.random,
): MutVec3 {
  if (cone >= Math.PI) return randomUnit(out, rand);
  // Sample around +Z, then rotate +Z onto the axis.
  const cosMax = Math.cos(cone);
  const cz = 1 - rand() * (1 - cosMax);
  const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
  const a = rand() * Math.PI * 2;
  const lx = sz * Math.cos(a);
  const ly = sz * Math.sin(a);
  // Orthonormal basis (t, b, axis) — branchless-ish "any perpendicular".
  let tx: number, ty: number, tz: number;
  if (Math.abs(dy) < 0.99) {
    // t = normalize(cross(up, d))
    tx = dz;
    ty = 0;
    tz = -dx;
  } else {
    // t = normalize(cross(right, d))
    tx = 0;
    ty = -dz;
    tz = dy;
  }
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  // b = d × t
  const bx = dy * tz - dz * ty;
  const by = dz * tx - dx * tz;
  const bz = dx * ty - dy * tx;
  out.x = tx * lx + bx * ly + dx * cz;
  out.y = ty * lx + by * ly + dy * cz;
  out.z = tz * lx + bz * ly + dz * cz;
  return out;
}

/** Point on a horizontal circle of radius r around the origin at `angle`. */
export function ringPoint(angle: number, r: number, out: MutVec3): MutVec3 {
  out.x = Math.cos(angle) * r;
  out.y = 0;
  out.z = Math.sin(angle) * r;
  return out;
}

/** How many particles a gameplay effect should spend, given its nominal count
 * and how full the pool already is. Above `soft` occupancy counts scale down
 * linearly to a quarter at full — a massive chain reaction thins out
 * gracefully instead of evicting the particles of the blast before it. */
export function budgetCount(nominal: number, occupancy: number, soft = 0.6): number {
  if (nominal <= 0) return 0;
  const o = clamp01(occupancy);
  if (o <= soft) return Math.round(nominal);
  const k = lerp(1, 0.25, (o - soft) / (1 - soft));
  return Math.max(1, Math.round(nominal * k));
}

/** Emission spacing along a moving emitter's path: how many trail particles
 * to lay between two positions `dist` apart, one per `spacing`, capped. */
export function trailSteps(dist: number, spacing: number, max: number): number {
  if (!(dist > 0) || spacing <= 0) return 0;
  return Math.min(max, Math.max(1, Math.round(dist / spacing)));
}
