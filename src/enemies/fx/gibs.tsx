import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
} from "three";
import { GRAVITY } from "../../core/config";
import type { Vec3 } from "../../world/types";

/** Pooled death debris: bone splinters, stone chunks, crystal shards that
 * tumble, bounce on the floor and shrink away. Cheap CPU ballistics (no
 * Rapier bodies) in two instanced draw calls — one lit, one glowing — so a
 * room full of dying skitters never costs more than the pool. */

export interface GibPalette {
  colors: readonly string[];
  /** Unlit + octahedral (embers, crystal) instead of lit + boxy (bone, stone). */
  glow: boolean;
  /** Proportions of one piece, multiplied by `size`. */
  shape: Vec3;
  size: number;
}

export const GIBS = {
  bone: { colors: ["#8a7f68", "#6e634e", "#a0957c"], glow: false, shape: [0.35, 0.35, 1.4], size: 0.16 },
  stone: { colors: ["#4a4452", "#2f2b36", "#5d5566"], glow: false, shape: [1, 0.8, 1], size: 0.16 },
  silt: { colors: ["#2d3b37", "#44524a", "#6b6a58"], glow: false, shape: [1, 0.7, 1.2], size: 0.18 },
  wood: { colors: ["#4a3020", "#2e1d10", "#8a6c22"], glow: false, shape: [0.4, 0.3, 1.5], size: 0.2 },
  crystal: { colors: ["#7fe8ff", "#3fb0ff", "#d8fbff"], glow: true, shape: [0.5, 1.6, 0.5], size: 0.14 },
  ember: { colors: ["#ff7a2a", "#ffb347", "#ff3d1e"], glow: true, shape: [1, 1, 1], size: 0.09 },
  shadow: { colors: ["#8a5cff", "#4b2a9a", "#d7c2ff"], glow: true, shape: [0.6, 1.2, 0.6], size: 0.1 },
} as const satisfies Record<string, GibPalette>;

const POOL = 120;
const LIFE = 1.8;

interface Gib {
  alive: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  sx: number;
  sy: number;
  sz: number;
  age: number;
  ttl: number;
}

interface Pool {
  gibs: Gib[];
  mesh: InstancedMesh | null;
  cursor: number;
  high: number;
}

function makePool(): Pool {
  const gibs: Gib[] = [];
  for (let i = 0; i < POOL; i++) {
    gibs.push({
      alive: false,
      px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0,
      sx: 0, sy: 0, sz: 0, age: 0, ttl: 0,
    });
  }
  return { gibs, mesh: null, cursor: 0, high: 0 };
}

const lit = makePool();
const glow = makePool();
const tmpColor = new Color();

export function spawnGibs(opts: {
  position: Vec3;
  count: number;
  palette: GibPalette;
  /** Outward speed. */
  force: number;
}): void {
  const { position, count, palette, force } = opts;
  const pool = palette.glow ? glow : lit;
  const mesh = pool.mesh;
  if (!mesh) return;
  for (let i = 0; i < count; i++) {
    const slot = pool.cursor;
    pool.cursor = (pool.cursor + 1) % POOL;
    pool.high = Math.max(pool.high, slot + 1);
    const g = pool.gibs[slot];
    const a = Math.random() * Math.PI * 2;
    const s = force * (0.45 + Math.random() * 0.75);
    g.alive = true;
    g.px = position[0] + (Math.random() - 0.5) * 0.3;
    g.py = position[1] + (Math.random() - 0.5) * 0.3;
    g.pz = position[2] + (Math.random() - 0.5) * 0.3;
    g.vx = Math.cos(a) * s;
    g.vz = Math.sin(a) * s;
    g.vy = force * (0.5 + Math.random() * 0.8);
    g.rx = Math.random() * 6;
    g.ry = Math.random() * 6;
    g.rz = Math.random() * 6;
    g.wx = (Math.random() - 0.5) * 18;
    g.wy = (Math.random() - 0.5) * 18;
    g.wz = (Math.random() - 0.5) * 18;
    const k = palette.size * (0.6 + Math.random() * 0.8);
    g.sx = palette.shape[0] * k;
    g.sy = palette.shape[1] * k;
    g.sz = palette.shape[2] * k;
    g.age = 0;
    g.ttl = LIFE * (0.7 + Math.random() * 0.6);
    mesh.setColorAt(slot, tmpColor.set(palette.colors[i % palette.colors.length]));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

const dummy = new Object3D();
const boxGeo = new BoxGeometry(1, 1, 1);
const shardGeo = new OctahedronGeometry(0.7, 0);
const litMat = new MeshStandardMaterial({ roughness: 0.85, flatShading: true });
const glowMat = new MeshBasicMaterial({ toneMapped: false });

function step(pool: Pool, dt: number): void {
  const mesh = pool.mesh;
  if (!mesh) return;
  for (let i = 0; i < pool.high; i++) {
    const g = pool.gibs[i];
    if (!g.alive) continue;
    g.age += dt;
    if (g.age >= g.ttl) {
      g.alive = false;
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      continue;
    }
    g.vy += GRAVITY * dt;
    g.px += g.vx * dt;
    g.py += g.vy * dt;
    g.pz += g.vz * dt;
    const floorY = g.sy * 0.5;
    if (g.py < floorY) {
      // Bounce with heavy friction; tumbling slows as pieces settle.
      g.py = floorY;
      g.vy = Math.abs(g.vy) > 1.5 ? -g.vy * 0.35 : 0;
      g.vx *= 0.6;
      g.vz *= 0.6;
      g.wx *= 0.5;
      g.wy *= 0.5;
      g.wz *= 0.5;
    }
    g.rx += g.wx * dt;
    g.ry += g.wy * dt;
    g.rz += g.wz * dt;
    const shrink = Math.min(1, (g.ttl - g.age) / 0.35);
    dummy.position.set(g.px, g.py, g.pz);
    dummy.rotation.set(g.rx, g.ry, g.rz);
    dummy.scale.set(g.sx * shrink, g.sy * shrink, g.sz * shrink);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.count = pool.high;
  mesh.instanceMatrix.needsUpdate = true;
}

function makeMesh(pool: Pool, geo: BoxGeometry | OctahedronGeometry, mat: MeshBasicMaterial | MeshStandardMaterial): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, POOL);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setColorAt(0, tmpColor.set("#ffffff"));
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = !(mat instanceof MeshBasicMaterial);
  pool.mesh = mesh;
  return mesh;
}

export function GibSystem() {
  const meshes = useMemo(() => [makeMesh(lit, boxGeo, litMat), makeMesh(glow, shardGeo, glowMat)], []);

  useEffect(
    () => () => {
      for (const pool of [lit, glow]) {
        pool.mesh = null;
        pool.high = 0;
        pool.cursor = 0;
        for (const g of pool.gibs) g.alive = false;
      }
    },
    [],
  );

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    step(lit, d);
    step(glow, d);
  });

  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}
