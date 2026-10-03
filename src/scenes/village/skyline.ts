import { hash2 } from "../../render/textures/pixelKit";

/** The mountains around the valley, as silhouettes in ANGLES: how high
 * above the horizon each ridge's crest stands at every bearing. They're
 * drawn at infinity (the backdrop follows the eye), so an angle is all a
 * mountain range needs — and angles are what make it look big.
 *
 * Bearings: 0 = +x, increasing toward +z; NORTH (−z, behind the gate as
 * you come up the lane) is −π/2. The moon rises in the north, in the
 * saddle between the two great peaks. */

export const NORTH = -Math.PI / 2;
const DEG = Math.PI / 180;

/** Where the moon stands: elevation of its centre, and its angular radius. */
export const MOON_ELEVATION = 20 * DEG;
export const MOON_ANGULAR_RADIUS = 9 * DEG;

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

/** Sharp-crested noise (1 at the ridgelines): mountains, not hills. */
function ridged(bearing: number, cells: number, seed: number): number {
  return 1 - Math.abs(ringNoise(bearing, cells, seed) * 2 - 1);
}

export type Layer = "far" | "mid" | "near";

/** Crest elevation (radians) of a layer at a bearing. */
export function crestElevation(layer: Layer, bearing: number): number {
  const off = angleDiff(NORTH, bearing); // 0 behind the gate
  const north = Math.max(0, Math.cos(off)); // 1 in the north, 0 east/west and south
  if (layer === "far") {
    // The great range: highest in the north, a broad jagged shoulder under
    // the moon and two titans standing either side of it, a line of lesser
    // peaks running round the valley.
    const titan = (c: number, w: number, h: number) => h * Math.exp(-((off - c) * (off - c)) / (w * w));
    const peaks = titan(-21 * DEG, 6 * DEG, 9.5 * DEG) + titan(22 * DEG, 7 * DEG, 8 * DEG);
    const shoulder = 1.6 * DEG * Math.exp(-(off * off) / (12 * DEG * 12 * DEG));
    // Calmer right under the moon, so it rises clear of the crest.
    const calm = 1 - 0.65 * Math.exp(-(off * off) / (9 * DEG * 9 * DEG));
    const jag = 4.5 * DEG * ridged(bearing, 23, 11) + 1.8 * DEG * ridged(bearing, 61, 12) + 0.6 * DEG * ringNoise(bearing, 190, 13);
    return 5 * DEG + north * north * 4 * DEG + shoulder + peaks + jag * (0.55 + 0.45 * north) * calm;
  }
  if (layer === "mid") {
    // Lower, darker shoulders: fall away under the moon so it stays clear.
    const saddle = Math.exp(-(off * off) / (8 * DEG * 8 * DEG));
    const jag = 3.4 * DEG * ridged(bearing, 17, 21) + 1.2 * DEG * ridged(bearing, 47, 22) + 0.4 * DEG * ringNoise(bearing, 160, 23);
    return 2.6 * DEG + north * 3.6 * DEG + jag * (1 - 0.6 * saddle);
  }
  // The near hills: low and forested — a fringe of pine tips along the crest.
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
