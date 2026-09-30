import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D, PlaneGeometry } from "three";
import { TILE, WALL_HEIGHT } from "../core/config";
import { COLLISION } from "../physics/groups";
import { WALL_VARIANTS } from "../render/textures";
import { hash2 } from "../render/textures/noise";
import type { Biome } from "./biomes";
import { biomeMaterials } from "./decor/materials";
import type { FloorLayout, Vec3 } from "./types";

const WORLD_GROUPS = COLLISION.world;
/** Share of wall cubes drawing each variant: mostly plain masonry, the
 * set-pieces (niches, geodes, eyes…) rare enough to stay special. */
const VARIANT_WEIGHTS = [0.72, 0.16, 0.12];
/** World units covered by one floor texture (128px → 32px per unit, the
 * same density as the walls). */
const FLOOR_TEX_SPAN = 4;
const CEIL_TEX_SPAN = 2;

/** The static architecture of a floor: instanced wall cubes (one instanced
 * mesh per wall variant) over greedy-merged colliders, plus floor and
 * ceiling slabs, all dressed in the biome's surfaces. */
export function FloorGeometry({ layout, biome }: { layout: FloorLayout; biome: Biome }) {
  const walls = useRef<(InstancedMesh | null)[]>([]);
  const mats = biomeMaterials(biome);

  const byVariant = useMemo(() => {
    const out: Vec3[][] = Array.from({ length: WALL_VARIANTS }, () => []);
    for (const pos of layout.wallInstances) out[pickVariant(pos, layout.seed)].push(pos);
    return out;
  }, [layout]);

  // Tiling lives in the plane's UVs, not texture.repeat, so the cached
  // textures and materials serve every floor size.
  const planes = useMemo(() => {
    const side = layout.extent * 2;
    return { floor: tiledPlane(side, FLOOR_TEX_SPAN), ceiling: tiledPlane(side, CEIL_TEX_SPAN) };
  }, [layout.extent]);
  useEffect(
    () => () => {
      planes.floor.dispose();
      planes.ceiling.dispose();
    },
    [planes],
  );

  useLayoutEffect(() => {
    const dummy = new Object3D();
    dummy.scale.set(TILE, WALL_HEIGHT, TILE);
    byVariant.forEach((positions, v) => {
      const mesh = walls.current[v];
      if (!mesh) return;
      positions.forEach(([x, y, z], i) => {
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [byVariant]);

  // Glowing seams breathe: a slow uniform tweak on a handful of materials.
  useFrame(({ clock }) => {
    const { intensity, pulse } = biome.glow;
    const t = clock.elapsedTime;
    const k = intensity * (1 + pulse * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.7) * 0.25));
    for (const m of mats.glowing) m.emissiveIntensity = k;
  });

  return (
    <group>
      {/* All static colliders in one fixed body. */}
      <RigidBody type="fixed" colliders={false}>
        {layout.wallBoxes.map((box, i) => (
          <CuboidCollider key={i} args={box.half} position={box.center} collisionGroups={WORLD_GROUPS} />
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

      {byVariant.map((positions, v) =>
        positions.length ? (
          <instancedMesh
            key={v}
            ref={(m) => {
              walls.current[v] = m;
            }}
            args={[undefined, mats.walls[v], positions.length]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1, 1, 1]} />
          </instancedMesh>
        ) : null,
      )}

      <mesh geometry={planes.floor} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mats.floor} />
      <mesh
        geometry={planes.ceiling}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, WALL_HEIGHT, 0]}
        material={mats.ceiling}
      />
    </group>
  );
}

function tiledPlane(side: number, span: number): PlaneGeometry {
  const g = new PlaneGeometry(side, side);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * side) / span, (uv.getY(i) * side) / span);
  return g;
}

function pickVariant([x, , z]: Vec3, seed: number): number {
  const r = hash2(Math.round(x * 10), Math.round(z * 10), seed);
  let acc = 0;
  for (let v = 0; v < VARIANT_WEIGHTS.length; v++) {
    acc += VARIANT_WEIGHTS[v];
    if (r < acc) return v;
  }
  return 0;
}
