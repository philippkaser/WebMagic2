import type RAPIER from "@dimforge/rapier3d-compat";
import { useRapier } from "@react-three/rapier";
import { useEffect } from "react";
import { spawnEnemy } from "../enemies/spawnedStore";
import { reportLoot } from "../items/LootOrbs";
import { announceDespawn } from "../net/entities";
import { hostEvent } from "../net/channels";
import { FLOOR, type EnemyCueMsg } from "../net/floorProtocol";
import type { SimCue, SimWorld } from "../sim/world";
import { getStats } from "../state/gameStore";
import { enemyBoom, enemyCast } from "../weapons/hostileEffects";
import { getFloorRules } from "./floorRules";
import { nearestWizardTo } from "./targets";

/** The floor simulation's world when it runs in a host's browser
 * (sim/world.ts): wizards from the live poses, sight from the React-managed
 * Rapier world, and every authoritative action announced to the floor as a
 * host event. A headless host (sim/floorSim.ts) implements the same
 * interface with its own physics and an outbox instead. */

let physics: { world: RAPIER.World; ray: RAPIER.Ray } | null = null;

/** Entity id → its view's cue handler (enemies/useEnemy registers). */
const cueViews = new Map<string, (cue: SimCue) => void>();

/** Cues from the floor's authority, for this machine's view of the enemy
 * (the authority's own view had it directly). */
const enemyCue = hostEvent<EnemyCueMsg>(FLOOR.enemyCue, (d, meta) => {
  if (meta.self || typeof d?.id !== "string") return;
  cueViews.get(d.id)?.(d.cue);
});

/** A view hears the cues the floor's authority shows for entity `id`. */
export function onEnemyCue(id: string, fn: (cue: SimCue) => void): () => void {
  cueViews.set(id, fn);
  return () => {
    if (cueViews.get(id) === fn) cueViews.delete(id);
  };
}

export const browserSim: SimWorld = {
  rules: getFloorRules,
  nearestWizard: (x, y, z) => nearestWizardTo(x, y, z),
  aggroMult: () => getStats().aggroMult,
  clearShot(from, dir, dist, self) {
    if (!physics) return false; // no world to look through — hold fire
    const ray = physics.ray;
    ray.origin.x = from.x;
    ray.origin.y = from.y;
    ray.origin.z = from.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    return physics.world.castRay(ray, dist, true, undefined, undefined, undefined, self ?? undefined) === null;
  },
  random: Math.random,
  cue: (id, cue) => enemyCue.announce({ id, cue }),
  act(a) {
    switch (a.type) {
      case "cast":
        enemyCast.announce(a.data);
        break;
      case "boom":
        enemyBoom.announce(a.data);
        break;
      case "spawn":
        spawnEnemy(a.kind, a.generation, a.pos, a.floor);
        break;
      case "died":
        announceDespawn(a.id);
        break;
      case "loot":
        reportLoot(a.id, a.source, a.at);
        break;
    }
  },
};

/** Mounted inside <Physics>: lends the browser sim the physics world. */
export function BindSimPhysics() {
  const { world, rapier } = useRapier();
  useEffect(() => {
    const bound = { world, ray: new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) };
    physics = bound;
    return () => {
      if (physics === bound) physics = null;
    };
  }, [world, rapier]);
  return null;
}
