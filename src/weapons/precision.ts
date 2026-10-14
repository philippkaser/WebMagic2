/** Precision hits: put the shot through a creature's weak point (the
 * sentry's crystal head, the shadow's eyes, the wisp's core, the Warden's
 * heart while its shell stands open) and it lands harder, in gold.
 *
 * Decided on the shooter's machine, like everything about where a shot
 * landed: the multiplier rides the damage in the "hit" command, and the
 * host's cap (weapons/hits.ts) is sized for it, so the trust model is the
 * one it always was. Pure geometry over plain points — no three.js — so
 * every rule is tested. */

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** A weak point: a sphere in the world, and (the Warden's core) its own
 * multiplier. Hittable.weakSpot() returns one, or null while it's shut. */
export interface WeakSpot extends Point {
  r: number;
  mult?: number;
}

export const CRIT = {
  /** What a precision hit multiplies its damage by. */
  mult: 1.5,
  /** The most any weak point may multiply by (the Warden's open core) —
   * and so what the host's hit cap allows for. */
  maxMult: 2,
} as const;

/** The multiplier `spot` grants: its own if it names one, else CRIT.mult —
 * never below 1, never past CRIT.maxMult. */
export function critMult(spot: WeakSpot | null | undefined): number {
  const m = spot && typeof spot.mult === "number" && Number.isFinite(spot.mult) ? spot.mult : CRIT.mult;
  return Math.min(CRIT.maxMult, Math.max(1, m));
}

/** Does the ray (origin `o`, unit `d`) pass through the weak point before
 * `maxDist`? Hitscan spells pass the far edge of the body's front half, so a
 * beam can't crit the eyes on the far side of a head it burned into from
 * behind. */
export function rayCrit(o: Point, d: Point, spot: WeakSpot, maxDist: number): boolean {
  const ox = o.x - spot.x;
  const oy = o.y - spot.y;
  const oz = o.z - spot.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - spot.r * spot.r;
  if (c <= 0) return true; // fired from inside it
  if (b > 0) return false; // behind us
  const disc = b * b - c;
  if (disc < 0) return false;
  return -b - Math.sqrt(disc) <= maxDist;
}

/** Did a projectile of radius `size`, flying along unit `dir`, that burst
 * at `p` pass through the weak point? It bursts on the body's skin, short of
 * a core inside, so its line is followed `ahead` metres on (the body's
 * radius: as deep as a core can sit, never out through the far side) and
 * `back` metres behind (a fast bolt can skim an eye in the frame before it
 * touches the skin). */
export function pathCrit(p: Point, dir: Point, spot: WeakSpot, size: number, ahead: number, back = 0.6): boolean {
  const cx = spot.x - p.x;
  const cy = spot.y - p.y;
  const cz = spot.z - p.z;
  const t = Math.max(-back, Math.min(ahead, cx * dir.x + cy * dir.y + cz * dir.z));
  const dx = cx - dir.x * t;
  const dy = cy - dir.y * t;
  const dz = cz - dir.z * t;
  const reach = spot.r + size;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/** Did a swept sphere (a piercing bolt this frame, from `a` to `b`, radius
 * `size`) pass through the weak point? */
export function sweptCrit(a: Point, b: Point, spot: WeakSpot, size: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const px = spot.x - a.x;
  const py = spot.y - a.y;
  const pz = spot.z - a.z;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2)) : 0;
  const ex = px - dx * t;
  const ey = py - dy * t;
  const ez = pz - dz * t;
  const reach = spot.r + size;
  return ex * ex + ey * ey + ez * ez <= reach * reach;
}
