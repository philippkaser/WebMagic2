import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  type Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../../../core/rng";
import { addLightSource, removeLightSource } from "../../../fx/DynamicLights";
import { COLLISION } from "../../../physics/groups";
import { getTextures } from "../../../render/textures";
import type { Vec3 } from "../../types";
import { InstancedParts, trs } from "../Instanced";
import type { Cottage } from "./Cottages";

/** Everything growing or standing between the cottages: pines and dead
 * trees, the standing-stone ring around the rift, the well, fences,
 * lanterns, grass, and the cobbled plaza. Deterministic (seeded) layout,
 * instanced wherever a thing repeats. */

const WELL: Vec3 = [8.6, 0, 2.2];
const LANTERNS: Vec3[] = [
  [-7.2, 0, -0.8],
  [6.4, 0, -4.2],
  [1.8, 0, -9.5],
  [-8.5, 0, 9.5],
];
const FENCES: [Vec3, Vec3][] = [
  [[4.5, 0, 9.5], [10.5, 0, 12.5]],
  [[10.5, 0, 12.5], [15, 0, 10]],
  [[-6, 0, 12.5], [-12, 0, 10.5]],
  [[-16, 0, -2], [-14, 0, -10]],
];
const STONE_RING = 6.3;
/** Each lantern post turns a little so the arms don't all point one way. */
const lanternYaw = (i: number) => i * 1.3;

function merge(parts: BufferGeometry[]) {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

export function Grounds({ cottages }: { cottages: Cottage[] }) {
  const res = useMemo(() => {
    const bark = getTextures("bark");
    const rune = getTextures("runestone");
    const cobble = getTextures("cobble");
    const plazaTex = getTextures("cobble", 4, 4);
    const pathTex = getTextures("cobble", 1, 4);
    const planks = getTextures("planks");
    const decal = { polygonOffset: true, polygonOffsetFactor: -1 } as const;
    return {
      geo: {
        trunk: new CylinderGeometry(0.12, 0.2, 1.6, 5).translate(0, 0.8, 0),
        needles: merge([
          new ConeGeometry(1.3, 2.2, 6).translate(0, 2.2, 0),
          new ConeGeometry(1.0, 1.9, 6).translate(0, 3.3, 0),
          new ConeGeometry(0.65, 1.6, 6).translate(0, 4.3, 0),
        ]),
        deadTree: merge([
          new CylinderGeometry(0.1, 0.22, 3.2, 5).translate(0, 1.6, 0),
          new CylinderGeometry(0.04, 0.08, 1.5, 4).rotateZ(0.9).translate(0.5, 2.4, 0),
          new CylinderGeometry(0.04, 0.07, 1.2, 4).rotateZ(-1.0).translate(-0.45, 2.0, 0.1),
          new CylinderGeometry(0.03, 0.06, 1.1, 4).rotateX(0.8).translate(0, 2.9, 0.35),
          new CylinderGeometry(0.02, 0.04, 0.7, 4).rotateZ(0.4).translate(-0.1, 3.4, 0),
        ]),
        stone: monolith(),
        post: new BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0),
        rail: new BoxGeometry(1, 0.07, 0.05),
        lanternPost: merge([
          new BoxGeometry(0.14, 2.6, 0.14).translate(0, 1.3, 0),
          new BoxGeometry(0.6, 0.08, 0.08).translate(0.27, 2.5, 0),
        ]),
        lantern: new BoxGeometry(0.22, 0.3, 0.22).translate(0.5, 2.22, 0),
        tuft: merge([
          new ConeGeometry(0.06, 0.4, 3).translate(0, 0.2, 0),
          new ConeGeometry(0.05, 0.32, 3).rotateZ(0.3).translate(0.08, 0.15, 0.03),
          new ConeGeometry(0.05, 0.28, 3).rotateZ(-0.35).translate(-0.07, 0.13, -0.04),
        ]),
        plaza: new CircleGeometry(4.8, 28).rotateX(-Math.PI / 2),
        path: new PlaneGeometry(2.6, 10.5).rotateX(-Math.PI / 2),
      },
      mat: {
        bark: new MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 }),
        needles: new MeshStandardMaterial({ color: "#132218", roughness: 0.95, flatShading: true }),
        stone: new MeshStandardMaterial({ map: rune.map, normalMap: rune.normalMap, color: "#9a96a2", emissive: "#06201c", roughness: 0.85, flatShading: true }),
        wood: new MeshStandardMaterial({ map: planks.map, color: "#5a4a3a", roughness: 0.95 }),
        iron: new MeshStandardMaterial({ color: "#1e1c1e", roughness: 0.6, metalness: 0.6 }),
        lantern: new MeshStandardMaterial({ color: "#301800", emissive: "#ffb050", emissiveIntensity: 3, toneMapped: false }),
        grass: new MeshStandardMaterial({ color: "#1f3320", roughness: 1, flatShading: true, side: DoubleSide }),
        plaza: new MeshStandardMaterial({ map: plazaTex.map, normalMap: plazaTex.normalMap, roughness: 0.8, ...decal }),
        path: new MeshStandardMaterial({ map: pathTex.map, normalMap: pathTex.normalMap, roughness: 0.8, ...decal }),
        wellStone: new MeshStandardMaterial({ map: cobble.map, normalMap: cobble.normalMap, roughness: 0.9, side: DoubleSide }),
        water: new MeshStandardMaterial({ color: "#050a14", roughness: 0.05, metalness: 0.7 }),
      },
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(res.geo).forEach((g) => g.dispose());
      Object.values(res.mat).forEach((m) => m.dispose());
    },
    [res],
  );

  const layout = useMemo(() => scatter(cottages), [cottages]);

  useEffect(() => {
    // The lamp hangs off the arm's end: local +x turned by the post's yaw.
    const srcs = LANTERNS.map(([x, , z], i) =>
      addLightSource({ position: [x + Math.cos(lanternYaw(i)) * 0.5, 2.2, z - Math.sin(lanternYaw(i)) * 0.5], color: "#ffb45a", intensity: 4, distance: 8, priority: 1 }),
    );
    return () => srcs.forEach(removeLightSource);
  }, []);

  const { geo, mat } = res;
  return (
    <group>
      <mesh geometry={geo.plaza} material={mat.plaza} position={[0, 0.01, 0]} receiveShadow />
      <mesh geometry={geo.path} material={mat.path} position={[0, 0.01, 9.4]} receiveShadow />

      <InstancedParts matrices={layout.pines} parts={[[geo.trunk, mat.bark], [geo.needles, mat.needles]]} castShadow />
      <InstancedParts matrices={layout.dead} parts={[[geo.deadTree, mat.bark]]} castShadow />
      <InstancedParts matrices={layout.stones} parts={[[geo.stone, mat.stone]]} castShadow />
      <InstancedParts matrices={layout.posts} parts={[[geo.post, mat.wood]]} />
      <InstancedParts matrices={layout.rails} parts={[[geo.rail, mat.wood]]} />
      <InstancedParts matrices={layout.lanterns} parts={[[geo.lanternPost, mat.iron], [geo.lantern, mat.lantern]]} />
      <InstancedParts matrices={layout.tufts} parts={[[geo.tuft, mat.grass]]} />

      <Well position={WELL} stone={mat.wellStone} wood={mat.wood} water={mat.water} />

      <RigidBody type="fixed" colliders={false}>
        {layout.solids.map(([x, z, r], i) => (
          <CylinderCollider key={i} args={[1.5, r]} position={[x, 1.5, z]} collisionGroups={COLLISION.world} />
        ))}
      </RigidBody>
    </group>
  );
}

function Well({
  position,
  stone,
  wood,
  water,
}: {
  position: Vec3;
  stone: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  water: MeshStandardMaterial;
}) {
  const roof = useMemo(() => getTextures("shingles"), []);
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} material={stone} castShadow receiveShadow>
        <cylinderGeometry args={[0.95, 1.05, 0.9, 10, 1, true]} />
      </mesh>
      <mesh position={[0, 0.9, 0]} rotation={[-Math.PI / 2, 0, 0]} material={stone}>
        <ringGeometry args={[0.72, 1.0, 10]} />
      </mesh>
      <mesh position={[0, 0.55, 0]} rotation={[-Math.PI / 2, 0, 0]} material={water}>
        <circleGeometry args={[0.8, 10]} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 1.2, 0]} material={wood} castShadow>
          <boxGeometry args={[0.12, 2.4, 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, 1.95, 0]} rotation={[0, 0, Math.PI / 2]} material={wood}>
        <cylinderGeometry args={[0.05, 0.05, 1.7, 5]} />
      </mesh>
      <mesh position={[0, 1.55, 0]} material={wood}>
        <cylinderGeometry args={[0.13, 0.1, 0.22, 6]} />
      </mesh>
      <mesh position={[0, 2.6, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <coneGeometry args={[1.3, 0.8, 4]} />
        <meshStandardMaterial map={roof.map} normalMap={roof.normalMap} roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Seeded placement, keeping clear of cottages, the plaza, the path and
 * the playfield's gameplay objects. */
function scatter(cottages: Cottage[]) {
  const rng = new Rng(0x7111a6e);
  const pines: Matrix4[] = [];
  const dead: Matrix4[] = [];
  const stones: Matrix4[] = [];
  const posts: Matrix4[] = [];
  const rails: Matrix4[] = [];
  const tufts: Matrix4[] = [];
  /** [x, z, radius] of solid trunks and stones inside the playfield. */
  const solids: [number, number, number][] = [];
  const clearOf = (x: number, z: number, pad: number) =>
    cottages.every((c) => Math.hypot(x - c.pos[0], z - c.pos[2]) > c.size * 0.75 + pad) &&
    Math.hypot(x - WELL[0], z - WELL[2]) > 1.6 + pad &&
    !(Math.abs(x) < 2 + pad && z > 3 && z < 15) &&
    Math.hypot(x, z) > 5 + pad;

  // Pines crowd the edge of the clearing and march off into the dark.
  for (let tries = 0; tries < 400 && pines.length < 70; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(17, 48);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!clearOf(x, z, 1.5)) continue;
    const s = rng.range(0.8, 1.6);
    pines.push(trs([x, 0, z], rng.range(0, 6.28), [s, s * rng.range(0.9, 1.3), s]));
    if (r < 25) solids.push([x, z, 0.3 * s]);
  }
  for (let tries = 0; tries < 200 && dead.length < 9; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(9, 20);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!clearOf(x, z, 1.2)) continue;
    dead.push(trs([x, 0, z], rng.range(0, 6.28), rng.range(0.9, 1.4)));
    solids.push([x, z, 0.25]);
  }

  // Standing stones ring the rift, open toward the lane from the south.
  const count = 11;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * STONE_RING;
    const z = Math.sin(a) * STONE_RING;
    if (z > 3.5 && Math.abs(x) < 3.5) continue; // the gap the lane runs through
    const h = rng.range(1.7, 3.1);
    stones.push(trs([x, 0, z], Math.atan2(x, z), [rng.range(0.8, 1.1), h, 1]));
    solids.push([x, z, 0.4]);
  }

  for (const [a, b] of FENCES) {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / 1.3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      posts.push(trs([a[0] + dx * t, 0, a[2] + dz * t], yaw + rng.range(-0.1, 0.1), [1, rng.range(0.85, 1.05), 1]));
    }
    for (const y of [0.45, 0.85])
      rails.push(trs([(a[0] + b[0]) / 2, y, (a[2] + b[2]) / 2], yaw, [len, 1, 1]));
  }

  for (let tries = 0; tries < 1200 && tufts.length < 380; tries++) {
    const x = rng.range(-24, 24);
    const z = rng.range(-24, 24);
    if (!clearOf(x, z, 0.2)) continue;
    tufts.push(trs([x, 0, z], rng.range(0, 6.28), rng.range(0.7, 1.5)));
  }

  const lanterns = LANTERNS.map((p, i) => trs(p, lanternYaw(i)));
  for (const [x, , z] of LANTERNS) solids.push([x, z, 0.15]);
  solids.push([WELL[0], WELL[2], 1.05]);
  return { pines, dead, stones, posts, rails, tufts, lanterns, solids };
}

/** A weathered menhir: a five-sided slab, flattened, tapering to a slanted
 * top, with every vertex nudged (deterministically) so no two faces are flat
 * to the same plane — reads as hewn rock, not a box. */
function monolith(): BufferGeometry {
  const g = new CylinderGeometry(0.3, 0.46, 1, 5, 3).translate(0, 0.5, 0);
  const rng = new Rng(0x57a4e);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setXYZ(
      i,
      pos.getX(i) * 1.35 + (rng.next() - 0.5) * 0.08,
      y + (y > 0.99 ? pos.getX(i) * 0.18 : (rng.next() - 0.5) * 0.04),
      pos.getZ(i) * 0.7 + (rng.next() - 0.5) * 0.08,
    );
  }
  return g.toNonIndexed();
}
