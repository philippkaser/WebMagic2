/** Runtime registries connecting combat to physical objects without React
 * prop-drilling or expensive world queries. Everything that can take a hit
 * registers here; everything dynamic registers for radial force effects. */

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

/** Structural subset of a Rapier rigid body we need — keeps this module free
 * of physics imports. */
export interface PhysBody {
  translation(): Vec3Tuple;
  applyImpulse(impulse: Vec3Tuple, wakeUp: boolean): void;
}

export type HitTeam = "enemy" | "prop";

/** What a hit knows besides its damage — for feedback, never for authority
 * (the host still decides damage and death). */
export interface HitInfo {
  /** The local wizard's own magic (drives hit confirms, numbers, hitstop). */
  mine?: boolean;
  /** Where it landed (sparks fly from here, numbers pop here). */
  at?: [number, number, number];
  /** A precision hit (a weak point). */
  crit?: boolean;
  /** A ceaseless tug or tick that shouldn't confirm or flinch (singularity). */
  quiet?: boolean;
}

export interface Hittable {
  id: number;
  team: HitTeam;
  /** Body radius for hitscan spells (beams, lightning, cones); ~0.5 if
   * unset. */
  radius?: number;
  getPosition(): Vec3Tuple;
  /** Its weak point right now (an eye, a core, a crystal head), if it has
   * one: a hit landing within `r` of it is a precision hit (HitInfo.crit). */
  /** A weak point (world centre, radius) and, if it isn't the usual 1.5×,
   * what a precision hit there multiplies by (weapons/precision). */
  weakSpot?(): { x: number; y: number; z: number; r: number; mult?: number } | null;
  /** Apply damage plus a physical impulse (world-space). */
  hit(damage: number, impulse: Vec3Tuple, info?: HitInfo): void;
}

let nextId = 1;
export function allocId(): number {
  return nextId++;
}

const hittables = new Map<number, Hittable>();
const dynamicBodies = new Set<PhysBody>();

export function registerHittable(h: Hittable): () => void {
  hittables.set(h.id, h);
  return () => hittables.delete(h.id);
}

export function forEachHittable(cb: (h: Hittable) => void): void {
  for (const h of hittables.values()) cb(h);
}

/** Nearest registered hittable of a team within maxDist (world units), or null.
 * Used by homing projectiles to pick a target to curve toward. */
export function nearestHittable(
  team: HitTeam,
  x: number,
  y: number,
  z: number,
  maxDist: number,
): Hittable | null {
  let best: Hittable | null = null;
  let bestD2 = maxDist * maxDist;
  for (const h of hittables.values()) {
    if (h.team !== team) continue;
    const p = h.getPosition();
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = h;
    }
  }
  return best;
}

export function registerDynamicBody(body: PhysBody): () => void {
  dynamicBodies.add(body);
  return () => dynamicBodies.delete(body);
}

export function forEachDynamicBody(cb: (b: PhysBody) => void): void {
  for (const b of dynamicBodies) cb(b);
}

/** Clear everything — called when a floor unmounts. */
export function resetRegistries(): void {
  hittables.clear();
  dynamicBodies.clear();
}

// Dev-only inspection for end-to-end tests.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__hittables = () =>
    [...hittables.values()].map((h) => ({ team: h.team, p: h.getPosition() }));
}
