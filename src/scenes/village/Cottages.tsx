import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, CylinderGeometry, Matrix4, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";
import { addLightSource, removeLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { getModelTextures } from "../../render/models/modelPaint";
import { getVillageTextures } from "../../render/textures/villagePainters";
import type { Vec3 } from "../../world/types";
import { InstancedParts, trs } from "./instanced";
import { WORLD_GROUPS, type Cottage } from "./layout";

/** Half-timbered cottages with steep shingle roofs, chimneys that smoke and
 * leaded windows glowing warm, spilling light onto the lanes. Every part is
 * instanced across all cottages, so the whole hamlet costs five draw calls.
 * (The artpass cottages.) */

/** Local layout of one cottage (front faces +z). */
function shape(size: number) {
  const w = size;
  const d = size * 0.8;
  const h = size * 0.6;
  const r = d * 0.64; // roof prism circumradius: overhangs the eaves
  const apex = h + r * 1.5 - 0.05;
  return { w, d, h, r, apex };
}

// Unit geometries, shaped per instance by scale.
const box = new BoxGeometry(1, 1, 1);
/** Triangular prism along x with its apex up, circumradius 1. */
const prism = new CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
const pane = new PlaneGeometry(1, 1);

const smokeAt = new Vector3();

export function Cottages({ cottages }: { cottages: Cottage[] }) {
  const mats = useMemo(() => {
    const timber = getVillageTextures("timber");
    const shingles = getVillageTextures("shingles");
    const cobble = getVillageTextures("cobble");
    const win = getVillageTextures("window");
    const planks = getModelTextures("planks");
    return {
      walls: new MeshStandardMaterial({ map: timber.map, normalMap: timber.normalMap, roughness: 0.92 }),
      roof: new MeshStandardMaterial({ map: shingles.map, normalMap: shingles.normalMap, roughness: 0.85 }),
      chimney: new MeshStandardMaterial({ map: cobble.map, normalMap: cobble.normalMap, roughness: 0.95 }),
      window: new MeshStandardMaterial({
        map: win.map,
        emissiveMap: win.emissiveMap,
        emissive: "#ffffff",
        emissiveIntensity: 2.2,
        toneMapped: false,
      }),
      door: new MeshStandardMaterial({ map: planks.map, normalMap: planks.normalMap, color: "#5a4636", roughness: 0.9 }),
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const layout = useMemo(() => {
    const walls: Matrix4[] = [];
    const roofs: Matrix4[] = [];
    const chimneys: Matrix4[] = [];
    const windows: Matrix4[] = [];
    const doors: Matrix4[] = [];
    const lights: Vec3[] = [];
    const smoke: Vec3[] = [];
    const at = (base: Matrix4, local: Matrix4) => base.clone().multiply(local);
    const world = (base: Matrix4, p: Vec3): Vec3 => new Vector3(...p).applyMatrix4(base).toArray() as Vec3;
    for (const c of cottages) {
      const { w, d, h, r, apex } = shape(c.size);
      const base = trs(c.pos, c.rot);
      walls.push(at(base, trs([0, h / 2, 0], 0, [w, h, d])));
      roofs.push(at(base, trs([0, h + r / 2 - 0.05, 0], 0, [w + 0.6, r, r])));
      const chimneyH = apex - h + 0.2;
      chimneys.push(at(base, trs([w * 0.27, h + chimneyH / 2, -d * 0.18], 0, [0.6, chimneyH, 0.6])));
      smoke.push(world(base, [w * 0.27, h + chimneyH + 0.2, -d * 0.18]));
      for (const x of [-w * 0.28, w * 0.28]) windows.push(at(base, trs([x, h * 0.58, d / 2 + 0.02], 0, [0.75, 0.85, 1])));
      windows.push(at(base, trs([w / 2 + 0.02, h * 0.58, 0], Math.PI / 2, [0.75, 0.85, 1])));
      doors.push(at(base, trs([0, 0.85, d / 2 + 0.02], 0, [0.95, 1.7, 1])));
      lights.push(world(base, [0, h * 0.5, d / 2 + 0.9]));
    }
    return { walls, roofs, chimneys, windows, doors, lights, smoke };
  }, [cottages]);

  // Warm spill from the windows onto the lane.
  useEffect(() => {
    const srcs = layout.lights.map((p) =>
      addLightSource({ position: p, color: "#ffa04a", intensity: 3.2, distance: 7, priority: 1 }),
    );
    return () => srcs.forEach(removeLightSource);
  }, [layout]);

  // Woodsmoke: one chimney at a time puffs a slow grey chunk.
  const smokeClock = useRef(0);
  useFrame((_, dt) => {
    smokeClock.current -= dt;
    if (smokeClock.current > 0) return;
    smokeClock.current = 0.35;
    const p = layout.smoke[Math.floor(Math.random() * layout.smoke.length)];
    spawnBurst({
      position: smokeAt.set(p[0], p[1], p[2]),
      count: 1,
      color: ["#3a3e4a", "#2c2f38", "#4a4d58"],
      speed: 0.15,
      upward: 0.9,
      ttl: 3.2,
      size: 0.22,
      gravity: 0,
      drag: 0.2,
    });
  });

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        {cottages.map((c, i) => {
          const { w, d, h } = shape(c.size);
          return (
            <CuboidCollider
              key={i}
              args={[w / 2, h / 2 + 0.6, d / 2]}
              position={[c.pos[0], h / 2 + 0.6, c.pos[2]]}
              rotation={[0, c.rot, 0]}
              collisionGroups={WORLD_GROUPS}
            />
          );
        })}
      </RigidBody>
      <InstancedParts matrices={layout.walls} parts={[[box, mats.walls]]} castShadow />
      <InstancedParts matrices={layout.roofs} parts={[[prism, mats.roof]]} castShadow />
      <InstancedParts matrices={layout.chimneys} parts={[[box, mats.chimney]]} castShadow />
      <InstancedParts matrices={layout.windows} parts={[[pane, mats.window]]} />
      <InstancedParts matrices={layout.doors} parts={[[pane, mats.door]]} />
    </group>
  );
}
