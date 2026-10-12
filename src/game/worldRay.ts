/** "How far can a line of magic go before stone stops it?" — the seam
 * between hitscan spells (weapons/castKinds) and the physics world. The
 * physics side installs a raycaster while a scene is mounted
 * (WorldRaySystem in weapons/WorldRay.tsx); without one (tests, no scene)
 * nothing blocks. Walls, the camp's structures and props stop a ray;
 * creatures and wizards don't (hitscan finds those itself, see
 * weapons/hitscan.ts). Import-free so pure modules can depend on it. */

export interface RayVec {
  x: number;
  y: number;
  z: number;
}

export type WorldRayFn = (origin: RayVec, dir: RayVec, maxDist: number) => number;

let raycaster: WorldRayFn | null = null;

export function setWorldRaycaster(fn: WorldRayFn | null): void {
  raycaster = fn;
}

/** Distance along the unit `dir` to the first solid thing, or `maxDist`. */
export function castWorldRay(origin: RayVec, dir: RayVec, maxDist: number): number {
  return raycaster ? raycaster(origin, dir, maxDist) : maxDist;
}

/** Is the straight line between two points clear of stone? */
export function clearLine(a: RayVec, b: RayVec, slack = 0.3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const d = { x: dx / dist, y: dy / dist, z: dz / dist };
  return castWorldRay(a, d, dist) >= dist - slack;
}
