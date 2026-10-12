import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { type BufferGeometry, ConeGeometry, CylinderGeometry, type Matrix4, MeshStandardMaterial, PlaneGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../../core/rng";
import { getVillageTextures } from "../../render/textures/villagePainters";
import { InstancedParts, trs } from "./instanced";
import { BOUNDS, groundHeight, inStructure, KEEP_CLEAR, LANE, PALISADE, STONE_RING, STRUCTURES, WORLD_GROUPS } from "./layout";

/** The valley round the camp: the ground itself — flat where the camp
 * stands, climbing north into the long forested slope under the mountains,
 * wooded hills east and west, a meadow south past the palisade — and the
 * pines that cover it, thick and tall toward the mountains, a few strays
 * inside the camp's edge. Instanced: the whole forest is a few draw calls. */

const SIZE = 240;
const SEGMENTS = 120;

function merge(parts: BufferGeometry[]) {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** Whether a tree may stand at (x, z): never in the camp's ways, its
 * structures or fixtures, nor on the palisade line. */
function clearForTree(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < STONE_RING + 3) return false;
  if (Math.abs(x) < LANE.width / 2 + 2 && z > 0 && z < BOUNDS + 6) return false;
  if (KEEP_CLEAR.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + 1.2)) return false;
  if (STRUCTURES.some((s) => inStructure(s, x, z, 1.5))) return false;
  if (Math.abs(r - PALISADE.r) < 2.2) {
    const a = Math.atan2(z, x);
    if (a > PALISADE.from - 0.1 && a < PALISADE.to + 0.1) return false;
  }
  return true;
}

/** How thick the forest grows at (x, z): 0…1. */
function density(x: number, z: number): number {
  const inside = Math.abs(x) < BOUNDS && Math.abs(z) < BOUNDS;
  if (inside) {
    // Inside the walls: the forest's edge creeps in north of the stones;
    // elsewhere a stray or two outside the palisade's ring.
    if (z < -11) return 0.55;
    return Math.hypot(x, z) > PALISADE.r + 1.5 ? 0.25 : 0;
  }
  if (z < -BOUNDS) return 0.95;
  if (z > BOUNDS) return 0.18; // the meadow south
  return 0.6; // the hills east and west
}

export function Wilds() {
  const res = useMemo(() => {
    const grass = getVillageTextures("grass", 110, 110);
    const ground = new PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    const pos = ground.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
    ground.computeVertexNormals();
    const bark = getVillageTextures("treeBark");
    return {
      ground,
      groundMat: new MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, roughness: 0.95 }),
      trunk: new CylinderGeometry(0.12, 0.2, 1.6, 5).translate(0, 0.8, 0),
      needles: merge([
        new ConeGeometry(1.3, 2.2, 6).translate(0, 2.2, 0),
        new ConeGeometry(1.0, 1.9, 6).translate(0, 3.3, 0),
        new ConeGeometry(0.65, 1.6, 6).translate(0, 4.3, 0),
      ]),
      bark: new MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 }),
      needleMat: new MeshStandardMaterial({ color: "#132218", roughness: 0.95, flatShading: true }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const r of Object.values(res)) r.dispose();
    },
    [res],
  );

  const forest = useMemo(() => {
    const rng = new Rng(0xf0e57);
    const near: Matrix4[] = [];
    const far: Matrix4[] = [];
    const solids: [number, number, number][] = [];
    const half = SIZE / 2 - 4;
    for (let tries = 0; tries < 9000 && near.length + far.length < 1100; tries++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half * 0.75);
      if (rng.next() > density(x, z) || !clearForTree(x, z)) continue;
      // Taller toward the mountains.
      const s = rng.range(0.9, 1.5) * (1 + 0.25 * Math.min(1, Math.max(0, -z - BOUNDS) / 50));
      const m = trs([x, groundHeight(x, z) - 0.1, z], rng.range(0, 6.28), [s, s * rng.range(0.9, 1.35), s]);
      const d = Math.hypot(x, z);
      (d < 40 ? near : far).push(m);
      if (Math.abs(x) < BOUNDS && Math.abs(z) < BOUNDS) solids.push([x, z, 0.3 * s]);
    }
    return { near, far, solids };
  }, []);

  return (
    <group>
      <mesh geometry={res.ground} material={res.groundMat} receiveShadow />
      <InstancedParts matrices={forest.near} parts={[[res.trunk, res.bark], [res.needles, res.needleMat]]} castShadow />
      <InstancedParts matrices={forest.far} parts={[[res.trunk, res.bark], [res.needles, res.needleMat]]} />
      <RigidBody type="fixed" colliders={false}>
        {forest.solids.map(([x, z, r], i) => (
          <CylinderCollider key={i} args={[1.5, r]} position={[x, 1.5, z]} collisionGroups={WORLD_GROUPS} />
        ))}
      </RigidBody>
    </group>
  );
}
