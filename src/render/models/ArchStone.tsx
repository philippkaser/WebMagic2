import { CuboidCollider, RigidBody, interactionGroups } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { GROUPS } from "../../core/config";
import { addLightSource, removeLightSource } from "../../fx/DynamicLights";
import { getBiomeDef } from "../../world/biomes";
import type { FloorLayout, Vec3 } from "../../world/types";
import { trimForWall } from "../textures";
import { buildArchStone, doorwayCollider, pillarCollider } from "./archStoneMesh";
import { CRYSTAL_COLORS, CrystalClusters } from "./CrystalClusterModel";
import { toGeometry } from "./meshGeometry";
import { dungeonMaterial, useBreathingGlow } from "./wallMaterial";

/** The floor's dressed stonework (render/models/archStoneMesh.ts): every
 * pillar, rib, pier and doorway frame in ONE mesh, in the band's trim
 * stone, through the same tinted material family as the walls — so it
 * turns with the floor's hue and takes whatever light the walls take.
 * Pillars and the headers over doorways are solid; piers, jambs and ribs
 * stand too shallow (or too high) to need it. In the Crystal Deep, the
 * crystal clusters growing in the corners, each a soft pooled light. */

/** The walls' collision groups (scenes/DungeonFloor.tsx): stone is stone. */
const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

export function ArchStone({ layout }: { layout: FloorLayout }) {
  const biome = getBiomeDef(layout.biome);
  const { architecture } = layout;
  const geo = useMemo(() => toGeometry(buildArchStone(architecture)), [architecture]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mats = useMemo(() => [dungeonMaterial(trimForWall(biome.surfaces.wall))], [biome]);
  useBreathingGlow(mats, biome.glow);
  const colliders = useMemo(
    () => [...architecture.pillars.map((p) => pillarCollider(p.pos)), ...architecture.doorways.map(doorwayCollider)],
    [architecture],
  );

  return (
    <group>
      {colliders.length > 0 && (
        <RigidBody type="fixed" colliders={false}>
          {colliders.map((box, i) => (
            <CuboidCollider key={i} args={box.half} position={box.center} collisionGroups={WORLD_GROUPS} />
          ))}
        </RigidBody>
      )}
      {geo.index && geo.index.count > 0 && <mesh geometry={geo} material={mats[0]} castShadow receiveShadow />}
      {architecture.crystals.length > 0 && <CrystalLights layout={layout} />}
      {architecture.crystals.length > 0 && <CrystalClusters crystals={architecture.crystals} />}
    </group>
  );
}

/** A soft pooled light in each crystal cluster — below a torch's priority,
 * so the clusters light the Deep without stealing the torches' slots. */
function CrystalLights({ layout }: { layout: FloorLayout }) {
  useEffect(() => {
    const lights = layout.architecture.crystals.map((c) =>
      addLightSource({
        position: [c.pos[0], 0.9 * c.scale, c.pos[2]] as Vec3,
        color: CRYSTAL_COLORS[c.hue],
        intensity: 4.5 * c.scale,
        distance: 6,
        priority: 0.7,
      }),
    );
    return () => {
      for (const l of lights) removeLightSource(l);
    };
  }, [layout]);
  return null;
}
