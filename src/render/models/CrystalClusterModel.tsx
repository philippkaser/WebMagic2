import { useLayoutEffect, useMemo, useRef } from "react";
import { type InstancedMesh, LatheGeometry, MeshStandardMaterial, Object3D, Vector2 } from "three";
import { Rng, hashSeed } from "../../core/rng";
import type { CrystalSpawn } from "../../world/types";
import { shared } from "./shared";

/** Crystal clusters for the Crystal Deep: faceted shards growing out of the
 * room corners, glowing violet or cyan. They are where the biome's colour
 * lives now — the walls are dark slate — so each cluster is also a pooled
 * light (the scene registers it; see scenes/DungeonFloor.tsx).
 *
 * One hexagonal shard geometry (a six-sided lathe: prism + point, flat
 * shaded so every facet catches light on its own), drawn as two instanced
 * meshes (one per hue) for all clusters on the floor. Shard layout is a
 * deterministic hash of the cluster's position — cosmetic, but identical
 * for every floor-mate. */

export const CRYSTAL_COLORS = ["#a46bff", "#4fd8ff"] as const;

const shardGeo = shared(
  () =>
    new LatheGeometry(
      [new Vector2(0, -0.15), new Vector2(0.1, -0.1), new Vector2(0.11, 0.7), new Vector2(0, 1)],
      6,
    ),
);

const materials = [
  shared(
    () =>
      new MeshStandardMaterial({
        color: "#2c1650",
        emissive: CRYSTAL_COLORS[0],
        emissiveIntensity: 1.5,
        roughness: 0.16,
        metalness: 0.25,
        flatShading: true,
        toneMapped: false,
      }),
  ),
  shared(
    () =>
      new MeshStandardMaterial({
        color: "#0e2a3a",
        emissive: CRYSTAL_COLORS[1],
        emissiveIntensity: 1.35,
        roughness: 0.16,
        metalness: 0.25,
        flatShading: true,
        toneMapped: false,
      }),
  ),
];

interface Shard {
  x: number;
  z: number;
  yaw: number;
  tilt: number;
  length: number;
  girth: number;
}

/** The shards of one cluster, leaning out of its corner toward `facing`. */
export function clusterShards(c: CrystalSpawn): Shard[] {
  const rng = new Rng(hashSeed(`crystal:${c.pos[0].toFixed(2)}:${c.pos[2].toFixed(2)}`));
  const shards: Shard[] = [];
  const count = rng.int(5, 8);
  for (let i = 0; i < count; i++) {
    const main = i === 0;
    const spread = main ? 0 : rng.range(-1.2, 1.2);
    const yaw = c.facing + spread;
    const r = main ? 0 : rng.range(0.12, 0.42) * c.scale;
    shards.push({
      x: Math.sin(yaw) * r,
      z: Math.cos(yaw) * r,
      yaw,
      tilt: main ? rng.range(0.12, 0.3) : rng.range(0.3, 0.75),
      length: (main ? rng.range(1.5, 2.1) : rng.range(0.45, 1.2)) * c.scale,
      girth: (main ? rng.range(1.5, 1.9) : rng.range(0.8, 1.3)) * c.scale,
    });
  }
  return shards;
}

/** A shard placed in the world (cluster foot + its offset). */
type PlacedShard = Shard & { cx: number; cz: number };

export function CrystalClusters({ crystals }: { crystals: CrystalSpawn[] }) {
  const byHue = useMemo(() => {
    const out: PlacedShard[][] = [[], []];
    for (const c of crystals) {
      for (const s of clusterShards(c)) out[c.hue].push({ ...s, cx: c.pos[0], cz: c.pos[2] });
    }
    return out;
  }, [crystals]);

  return (
    <group>
      {byHue.map((shards, hue) =>
        shards.length ? <ShardInstances key={hue} shards={shards} material={materials[hue]()} /> : null,
      )}
    </group>
  );
}

function ShardInstances({ shards, material }: { shards: PlacedShard[]; material: MeshStandardMaterial }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    shards.forEach((s, i) => {
      o.position.set(s.cx + s.x, 0, s.cz + s.z);
      // Lean along the shard's yaw: rotate about the axis perpendicular to it.
      o.rotation.set(0, 0, 0);
      o.rotateY(s.yaw);
      o.rotateX(s.tilt);
      o.scale.set(s.girth, s.length, s.girth);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shards]);
  return <instancedMesh ref={ref} args={[shardGeo(), material, shards.length]} castShadow />;
}
