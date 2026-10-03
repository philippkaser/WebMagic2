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
import { Rng } from "../../core/rng";
import { addLightSource, removeLightSource } from "../../fx/DynamicLights";
import { getVillageTextures } from "../../render/textures/villagePainters";
import { InstancedParts, trs } from "./instanced";
import { inStructure, KEEP_CLEAR, LANE, LANTERNS, PLAZA_R, STONE_RING, STRUCTURES, WORLD_GROUPS } from "./layout";

/** The ground of the camp between its tents: the ancient paving round the
 * gate (the diggers uncovered it) and the lane, the standing-stone ring,
 * a few dead trees, lamp posts and grass tufts. Deterministic (seeded)
 * layout, instanced wherever a thing repeats. The forest and the land
 * beyond are Wilds; the camp's own things are Camp. */

/** Each lantern post turns a little so the arms don't all point one way. */
const lanternYaw = (i: number) => i * 1.3;

function merge(parts: BufferGeometry[]) {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

export function Grounds() {
  const res = useMemo(() => {
    const bark = getVillageTextures("treeBark");
    const rune = getVillageTextures("basalt");
    const plazaTex = getVillageTextures("cobble", 4, 4);
    const pathTex = getVillageTextures("cobble", 1, 4);
    const decal = { polygonOffset: true, polygonOffsetFactor: -1 } as const;
    return {
      geo: {
        deadTree: merge([
          new CylinderGeometry(0.1, 0.22, 3.2, 5).translate(0, 1.6, 0),
          new CylinderGeometry(0.04, 0.08, 1.5, 4).rotateZ(0.9).translate(0.5, 2.4, 0),
          new CylinderGeometry(0.04, 0.07, 1.2, 4).rotateZ(-1.0).translate(-0.45, 2.0, 0.1),
          new CylinderGeometry(0.03, 0.06, 1.1, 4).rotateX(0.8).translate(0, 2.9, 0.35),
          new CylinderGeometry(0.02, 0.04, 0.7, 4).rotateZ(0.4).translate(-0.1, 3.4, 0),
        ]),
        stone: monolith(),
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
        plaza: new CircleGeometry(PLAZA_R, 28).rotateX(-Math.PI / 2),
        path: new PlaneGeometry(LANE.width, LANE.z1 - LANE.z0).rotateX(-Math.PI / 2),
      },
      mat: {
        bark: new MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 }),
        stone: new MeshStandardMaterial({ map: rune.map, normalMap: rune.normalMap, color: "#9a96a2", emissive: "#06201c", roughness: 0.85, flatShading: true }),
        iron: new MeshStandardMaterial({ color: "#1e1c1e", roughness: 0.6, metalness: 0.6 }),
        lantern: new MeshStandardMaterial({ color: "#301800", emissive: "#ffb050", emissiveIntensity: 3, toneMapped: false }),
        grass: new MeshStandardMaterial({ color: "#1f3320", roughness: 1, flatShading: true, side: DoubleSide }),
        plaza: new MeshStandardMaterial({ map: plazaTex.map, normalMap: plazaTex.normalMap, roughnessMap: plazaTex.roughnessMap, roughness: 0.8, ...decal }),
        path: new MeshStandardMaterial({ map: pathTex.map, normalMap: pathTex.normalMap, roughnessMap: pathTex.roughnessMap, roughness: 0.8, ...decal }),
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

  const layout = useMemo(() => scatter(), []);

  useEffect(() => {
    // The lamp hangs off the arm's end: local +x turned by the post's yaw.
    const srcs = LANTERNS.map(([x, , z], i) =>
      addLightSource({
        position: [x + Math.cos(lanternYaw(i)) * 0.5, 2.2, z - Math.sin(lanternYaw(i)) * 0.5],
        color: "#ffb45a",
        intensity: 4,
        distance: 8,
        priority: 1,
      }),
    );
    return () => srcs.forEach(removeLightSource);
  }, []);

  const { geo, mat } = res;
  return (
    <group>
      <mesh geometry={geo.plaza} material={mat.plaza} position={[0, 0.01, 0]} receiveShadow />
      <mesh geometry={geo.path} material={mat.path} position={[0, 0.01, (LANE.z0 + LANE.z1) / 2]} receiveShadow />

      <InstancedParts matrices={layout.dead} parts={[[geo.deadTree, mat.bark]]} castShadow />
      <InstancedParts matrices={layout.stones} parts={[[geo.stone, mat.stone]]} castShadow />
      <InstancedParts matrices={layout.lanterns} parts={[[geo.lanternPost, mat.iron], [geo.lantern, mat.lantern]]} />
      <InstancedParts matrices={layout.tufts} parts={[[geo.tuft, mat.grass]]} />

      <RigidBody type="fixed" colliders={false}>
        {layout.solids.map(([x, z, r], i) => (
          <CylinderCollider key={i} args={[1.5, r]} position={[x, 1.5, z]} collisionGroups={WORLD_GROUPS} />
        ))}
      </RigidBody>
    </group>
  );
}

/** Seeded placement, keeping clear of the camp's structures, the plaza,
 * the lane and its gameplay fixtures (layout KEEP_CLEAR). */
function scatter() {
  const rng = new Rng(0x7111a6e);
  const dead: Matrix4[] = [];
  const stones: Matrix4[] = [];
  const tufts: Matrix4[] = [];
  /** [x, z, radius] of solid trunks and stones inside the playfield. */
  const solids: [number, number, number][] = [];
  const clearOf = (x: number, z: number, pad: number) =>
    STRUCTURES.every((s) => !inStructure(s, x, z, pad + 0.3)) &&
    KEEP_CLEAR.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r + pad) &&
    !(Math.abs(x) < LANE.width / 2 + 0.7 + pad && z > 3 && z < LANE.z1 + 0.5) &&
    Math.hypot(x, z) > PLAZA_R + 0.2 + pad;

  // A few dead trees at the camp's edge, where the forest was cleared.
  for (let tries = 0; tries < 200 && dead.length < 6; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(13, 20);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!clearOf(x, z, 1.2)) continue;
    dead.push(trs([x, 0, z], rng.range(0, 6.28), rng.range(0.9, 1.4)));
    solids.push([x, z, 0.25]);
  }

  // Standing stones ring the gate, open toward the lane from the south.
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

  for (let tries = 0; tries < 1400 && tufts.length < 420; tries++) {
    const x = rng.range(-24, 24);
    const z = rng.range(-24, 24);
    if (!clearOf(x, z, 0.2)) continue;
    tufts.push(trs([x, 0, z], rng.range(0, 6.28), rng.range(0.7, 1.5)));
  }

  const lanterns = LANTERNS.map((p, i) => trs(p, lanternYaw(i)));
  for (const [x, , z] of LANTERNS) solids.push([x, z, 0.15]);
  return { dead, stones, tufts, lanterns, solids };
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
