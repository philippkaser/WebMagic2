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

export interface Hittable {
  id: number;
  team: HitTeam;
  getPosition(): Vec3Tuple;
  /** Apply damage plus a physical impulse (world-space). */
  hit(damage: number, impulse: Vec3Tuple): void;
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
