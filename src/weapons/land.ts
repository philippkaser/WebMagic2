import { landing } from "../combat/landing";
import { forEachHittable, type HitInfo, type Hittable, type Vec3Tuple } from "../game/registry";
import type { WeakSpot } from "./precision";

/** Land a blow of `weight` (weapons/castFeel hitWeight) on `h`: the hit
 * itself (the host still decides what it does), with the shot's heft held
 * in combat/landing for the confirm to read while the shell reports it. */
export function land(h: Hittable, damage: number, impulse: Vec3Tuple, info: HitInfo, weight: number): void {
  const prev = landing.weight;
  landing.weight = weight;
  try {
    h.hit(damage, impulse, info);
  } finally {
    landing.weight = prev;
  }
}

/** `h`'s weak point right now, or null — not every creature has one, and
 * one that does may have it shut (the Warden's core behind its shell). */
export function weakOf(h: Hittable): WeakSpot | null {
  return h.weakSpot?.() ?? null;
}

/** Which hittable a bolt struck, from the body it touched: that body's
 * position read twice in the same step is the same numbers to the last bit,
 * so a match is exact. If nothing matches (a body under a compound
 * collider), the nearest hittable whose skin is within `slack` of `at`. */
export function struckBy(touched: Vec3Tuple | null, at: Vec3Tuple, slack: number): Hittable | null {
  let exact: Hittable | null = null;
  let near: Hittable | null = null;
  let nearGap = slack;
  forEachHittable((h) => {
    if (exact) return;
    const p = h.getPosition();
    if (touched && (p.x - touched.x) ** 2 + (p.y - touched.y) ** 2 + (p.z - touched.z) ** 2 < 1e-8) {
      exact = h;
      return;
    }
    const gap = Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) - (h.radius ?? 0.5);
    if (gap < nearGap) {
      nearGap = gap;
      near = h;
    }
  });
  return exact ?? near;
}

/** What a bolt that touched a body burst ON (struckBy's pick) — unless
 * that's a creature it already pierced. A piercing bolt's own body ignores
 * creatures, so this is a wall or a prop it touched beside one: the
 * creature had its pass, and the burst reaches it as blast like anything
 * else, not as a second full, re-crit blow. */
export function burstOn(
  touched: Vec3Tuple | null,
  at: Vec3Tuple,
  slack: number,
  pierced: ReadonlySet<Hittable>,
): Hittable | null {
  const h = struckBy(touched, at, slack);
  return h && pierced.has(h) ? null : h;
}
