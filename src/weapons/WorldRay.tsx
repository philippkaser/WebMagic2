import { interactionGroups, useRapier } from "@react-three/rapier";
import { useEffect } from "react";
import { GROUPS } from "../core/config";
import { setWorldRaycaster } from "../game/worldRay";

/** A ray that flies like a friendly spell: walls and the camp stop it (they
 * accept FRIENDLY_PROJECTILE); creatures, props, wizards and other spells
 * don't — hitscan finds those on its own (a beam burns a crate it meets). */
const RAY_GROUPS = interactionGroups(GROUPS.FRIENDLY_PROJECTILE, [GROUPS.WORLD]);

/** Installs the physics world's raycaster behind game/worldRay while the
 * physics world exists. Mount inside <Physics>. */
export function WorldRaySystem() {
  const { world, rapier } = useRapier();
  useEffect(() => {
    const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    setWorldRaycaster((o, d, max) => {
      ray.origin = { x: o.x, y: o.y, z: o.z };
      ray.dir = { x: d.x, y: d.y, z: d.z };
      const hit = world.castRay(ray, max, true, undefined, RAY_GROUPS);
      return hit ? Math.min(max, hit.timeOfImpact) : max;
    });
    return () => setWorldRaycaster(null);
  }, [world, rapier]);
  return null;
}
