import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D } from "three";
import { TILE, WALL_HEIGHT } from "../core/config";
import { COLLISION } from "../physics/groups";
import { getTextures } from "../render/textures";
import type { FloorLayout } from "./types";

const WORLD_GROUPS = COLLISION.world;

/** The static architecture of a floor: instanced wall cubes over
 * greedy-merged colliders, plus floor and ceiling slabs. */
export function FloorGeometry({ layout }: { layout: FloorLayout }) {
  const walls = useRef<InstancedMesh>(null);
  const wallTex = useMemo(() => getTextures("stone"), []);
  const floorTex = useMemo(
    () => getTextures("slab", layout.extent / 2, layout.extent / 2),
    [layout.extent],
  );
  const ceilTex = useMemo(
    () => getTextures("dark", layout.extent / 2, layout.extent / 2),
    [layout.extent],
  );

  useLayoutEffect(() => {
    const mesh = walls.current;
    if (!mesh) return;
    const dummy = new Object3D();
    dummy.scale.set(TILE, WALL_HEIGHT, TILE);
    layout.wallInstances.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [layout]);

  return (
    <group>
      {/* All static colliders in one fixed body. */}
      <RigidBody type="fixed" colliders={false}>
        {layout.wallBoxes.map((box, i) => (
          <CuboidCollider
            key={i}
            args={box.half}
            position={box.center}
            collisionGroups={WORLD_GROUPS}
          />
        ))}
        <CuboidCollider
          args={[layout.extent, 0.5, layout.extent]}
          position={[0, -0.5, 0]}
          collisionGroups={WORLD_GROUPS}
        />
        <CuboidCollider
          args={[layout.extent, 0.5, layout.extent]}
          position={[0, WALL_HEIGHT + 0.5, 0]}
          collisionGroups={WORLD_GROUPS}
        />
      </RigidBody>

      <instancedMesh
        ref={walls}
        args={[undefined, undefined, layout.wallInstances.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          map={wallTex.map}
          normalMap={wallTex.normalMap}
          roughness={0.88}
          metalness={0.06}
          envMapIntensity={0.4}
        />
      </instancedMesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[layout.extent * 2, layout.extent * 2]} />
        <meshStandardMaterial
          map={floorTex.map}
          normalMap={floorTex.normalMap}
          roughness={0.6}
          metalness={0.18}
          envMapIntensity={0.75}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_HEIGHT, 0]}>
        <planeGeometry args={[layout.extent * 2, layout.extent * 2]} />
        <meshStandardMaterial map={ceilTex.map} normalMap={ceilTex.normalMap} roughness={0.95} />
      </mesh>
    </group>
  );
}
