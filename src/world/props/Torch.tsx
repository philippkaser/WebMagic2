import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import { hashSeed } from "../../core/rng";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { TorchModel } from "../../render/models/TorchModel";
import type { Vec3 } from "../types";

/** How far a torch looks for a wall to bolt its bracket to. */
const WALL_REACH = 0.9;
/** Physics frames to keep probing before settling for free-standing (the
 * floor's colliders may not be in the query pipeline on the first frame). */
const PROBE_FRAMES = 12;
const PROBES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Wall torch: flickering light (warm by default; biomes may tint it) (via the dynamic light pool), a flame
 * card over glowing coals, drifting sparks. The level data only gives a
 * position, so the torch feels for the nearest wall with a few short ray
 * casts and turns its bracket toward it. */
export function Torch({ position, color = "#ff9a4d" }: { position: Vec3; color?: string }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const worldPos = useRef(new Vector3(...position));
  const emberClock = useRef(Math.random());
  const seed = useMemo(() => hashSeed(position.join(",")) % 100, [position]);
  const { world, rapier } = useRapier();
  const probes = useRef(0);
  const [wallYaw, setWallYaw] = useState<number | null>(null);

  useEffect(() => {
    // Torches can be nested (village posts) — register the light at the
    // torch's *world* position.
    const g = group.current!;
    g.updateWorldMatrix(true, false);
    g.getWorldPosition(worldPos.current);
    const src = addLightSource({
      position: [worldPos.current.x, worldPos.current.y + 0.25, worldPos.current.z + 0.2],
      color,
      intensity: 7,
      distance: 10,
      priority: 1,
    });
    light.current = src;
    probes.current = 0;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position, color]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    if (light.current) {
      light.current.intensity =
        7 + Math.sin(t * 9.3) * 1.4 + Math.sin(t * 23.7) * 0.9 + Math.sin(t * 3.1) * 0.9;
    }

    if (wallYaw === null && probes.current < PROBE_FRAMES) {
      probes.current++;
      const w = worldPos.current;
      let best = WALL_REACH;
      let yaw: number | null = null;
      for (const [dx, dz] of PROBES) {
        const hit = world.castRay(
          new rapier.Ray({ x: w.x, y: w.y - 0.3, z: w.z }, { x: dx, y: 0, z: dz }),
          WALL_REACH,
          true,
          rapier.QueryFilterFlags.ONLY_FIXED,
        );
        if (hit && hit.timeOfImpact < best) {
          best = hit.timeOfImpact;
          yaw = Math.atan2(-dx, -dz);
        }
      }
      if (yaw !== null) setWallYaw(yaw);
    }

    emberClock.current -= dt;
    if (emberClock.current <= 0) {
      emberClock.current = 0.16 + Math.random() * 0.12;
      const w = worldPos.current;
      spawnBurst({
        position: [w.x, w.y + 0.25, w.z],
        count: 1,
        color: [color, "#ffb257"],
        speed: 0.5,
        upward: 1.3,
        ttl: 0.8,
        size: 0.05,
        gravity: 0.6,
        drag: 0.4,
      });
    }
  });

  return (
    <group ref={group} position={position}>
      <TorchModel wallYaw={wallYaw} seed={seed} color={color} />
    </group>
  );
}
