import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import { hashSeed } from "../../core/rng";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import type { Vec3 } from "../types";
/** Wall torch: flickering warm light (via the dynamic light pool), glowing
 * ember head, drifting sparks. */
export function Torch({ position }: { position: Vec3 }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const worldPos = useRef(new Vector3(...position));
  const emberClock = useRef(Math.random());
  const seed = useMemo(() => hashSeed(position.join(",")) % 100, [position]);

  useEffect(() => {
    // Torches can be nested (village posts) — register the light at the
    // torch's *world* position.
    const g = group.current!;
    g.updateWorldMatrix(true, false);
    g.getWorldPosition(worldPos.current);
    const src = addLightSource({
      position: [worldPos.current.x, worldPos.current.y + 0.25, worldPos.current.z + 0.2],
      color: "#ff9a4d",
      intensity: 7,
      distance: 10,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    if (light.current) {
      light.current.intensity =
        7 + Math.sin(t * 9.3) * 1.4 + Math.sin(t * 23.7) * 0.9 + Math.sin(t * 3.1) * 0.9;
    }
    emberClock.current -= dt;
    if (emberClock.current <= 0) {
      emberClock.current = 0.16 + Math.random() * 0.12;
      const w = worldPos.current;
      spawnBurst({
        position: [w.x, w.y + 0.12, w.z],
        count: 1,
        color: ["#ffb257", "#ff6b2e"],
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
      <mesh position={[0, -0.22, 0]} rotation={[0.22, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.045, 0.5, 6]} />
        <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.08, 0.05]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#200" emissive="#ff8b3d" emissiveIntensity={4.5} toneMapped={false} />
      </mesh>
    </group>
  );
}
