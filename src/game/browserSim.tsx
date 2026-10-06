import type RAPIER from "@dimforge/rapier3d-compat";
import { useRapier } from "@react-three/rapier";
import { useEffect } from "react";
import { spawnEnemy } from "../enemies/spawnedStore";
import { reportLoot } from "../items/LootOrbs";
import { announceDespawn } from "../net/entities";
import type { SimWorld } from "../sim/world";
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
    return physics.world.castRay(ray, dist, true, undefined, undefined, undefined, self) === null;
  },
  random: Math.random,
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
