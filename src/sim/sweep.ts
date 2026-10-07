import type { Vec } from "../enemies/brains/common";

/** Swept-ball tests against capsules — how the authority's copy of a spell
 * hits things it judges at a time other than "now" (lag compensation,
 * sim/floorSim.ts): their rewound positions aren't in the physics world, so
 * the bolt is tested against them as shapes. Pure geometry. */

/** A vertical capsule: the segment from `center − halfHeight` to
 * `center + halfHeight` on y, inflated by `radius` (a ball: halfHeight 0). */
export interface Capsule {
  center: Vec;
  halfHeight: number;
  radius: number;
}

/** The first fraction t ∈ [0, 1] of the move `from` → `from + move` at which
 * a ball of `radius` touches `cap`, or null if it never does. */
export function sweepBallCapsule(from: Vec, move: Vec, radius: number, cap: Capsule): number | null {
  const reach = radius + cap.radius;
  const ay = cap.center.y - cap.halfHeight;
  const by = cap.center.y + cap.halfHeight;
  const gap = (t: number) => distToAxis(from.x + move.x * t, from.y + move.y * t, from.z + move.z * t, cap.center, ay, by) - reach;
  if (gap(0) <= 0) return 0;
  // The distance from a point moving on a line to a convex set is convex in
  // t: find its minimum, and if that touches, the first touch lies before.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (gap(m1) < gap(m2)) hi = m2;
    else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  if (gap(tMin) > 0) return null;
  lo = 0;
  hi = tMin;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Distance from a point to the vertical segment x = c.x, z = c.z, y ∈ [ay, by]. */
function distToAxis(x: number, y: number, z: number, c: Vec, ay: number, by: number): number {
  const cy = y < ay ? ay : y > by ? by : y;
  return Math.hypot(x - c.x, y - cy, z - c.z);
}

/** Distance from a point to a capsule's surface (negative inside). */
export function distToCapsule(p: Vec, cap: Capsule): number {
  return distToAxis(p.x, p.y, p.z, cap.center, cap.center.y - cap.halfHeight, cap.center.y + cap.halfHeight) - cap.radius;
}
