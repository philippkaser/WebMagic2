import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, TetrahedronGeometry, Vector3 } from "three";

/** Ash: what a lost thing crumbles into on the death screen.
 *
 * Embers (UiSparks) can only ADD light — on the transparent UI canvas a dark
 * additive particle is invisible. Ash has to be dark and solid, so it's a
 * small pool of lit, tumbling flakes (one instanced draw) that fall with
 * gravity and a little drift, shrinking as they go. Mount `<AshFlakes />`
 * once wherever ash can fall; `emitAsh()` from anywhere in the UI canvas. */

const CAPACITY = 320;

const pos = new Float32Array(CAPACITY * 3);
const vel = new Float32Array(CAPACITY * 3);
const spin = new Float32Array(CAPACITY * 3);
const rot = new Float32Array(CAPACITY * 3);
const life = new Float32Array(CAPACITY);
const ttl = new Float32Array(CAPACITY);
const size = new Float32Array(CAPACITY);
const shade = new Float32Array(CAPACITY);
let cursor = 0;
let alive = 0;

export interface AshOptions {
  position: readonly [number, number, number];
  count?: number;
  /** Flake size, metres. */
  size?: number;
  /** Positional jitter radius, metres. */
  spread?: number;
  /** Initial outward speed, m/s. */
  speed?: number;
  ttl?: number;
}

export function emitAsh(o: AshOptions): void {
  const count = o.count ?? 12;
  const spread = o.spread ?? 0.03;
  const speed = o.speed ?? 0.12;
  for (let n = 0; n < count; n++) {
    const i = cursor;
    cursor = (cursor + 1) % CAPACITY;
    const k = i * 3;
    pos[k] = o.position[0] + (Math.random() - 0.5) * spread * 2;
    pos[k + 1] = o.position[1] + (Math.random() - 0.5) * spread * 2;
    pos[k + 2] = o.position[2] + (Math.random() - 0.5) * spread * 2;
    const a = Math.random() * Math.PI * 2;
    vel[k] = Math.cos(a) * speed * Math.random();
    vel[k + 1] = Math.random() * speed * 0.6;
    vel[k + 2] = Math.sin(a) * speed * Math.random();
    for (let j = 0; j < 3; j++) {
      spin[k + j] = (Math.random() - 0.5) * 14;
      rot[k + j] = Math.random() * 6.28;
    }
    const t = (o.ttl ?? 1.6) * (0.6 + Math.random() * 0.7);
    life[i] = t;
    ttl[i] = t;
    size[i] = (o.size ?? 0.01) * (0.5 + Math.random());
    // Pale grey: real ash is lighter than what burned, and it has to read
    // against a dark screen.
    shade[i] = 0.45 + Math.random() * 0.4;
  }
  alive = CAPACITY;
}

const m4 = new Matrix4();
const p3 = new Vector3();
const q4 = new Quaternion();
const s3 = new Vector3();
const e3 = new Euler();
const c3 = new Color();

export function AshFlakes() {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(
      new TetrahedronGeometry(1, 0),
      new MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0, flatShading: true }),
      CAPACITY,
    );
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    for (let i = 0; i < CAPACITY; i++) m.setColorAt(i, c3.setScalar(0.3));
    return m;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      mesh.dispose();
    },
    [mesh],
  );

  useFrame((_, rawDt) => {
    if (alive === 0) {
      mesh.count = 0;
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    const drag = Math.exp(-dt * 1.6);
    let n = 0;
    for (let i = 0; i < CAPACITY; i++) {
      if (life[i]! <= 0) continue;
      life[i] = life[i]! - dt;
      if (life[i]! <= 0) continue;
      const k = i * 3;
      // Ash falls, but it's light: gravity fights a lot of air.
      vel[k] = vel[k]! * drag + Math.sin(life[i]! * 5 + i) * 0.05 * dt;
      vel[k + 1] = vel[k + 1]! * drag - 0.55 * dt;
      vel[k + 2] = vel[k + 2]! * drag;
      pos[k] = pos[k]! + vel[k]! * dt;
      pos[k + 1] = pos[k + 1]! + vel[k + 1]! * dt;
      pos[k + 2] = pos[k + 2]! + vel[k + 2]! * dt;
      for (let j = 0; j < 3; j++) rot[k + j] = rot[k + j]! + spin[k + j]! * dt;
      const f = life[i]! / ttl[i]!;
      p3.set(pos[k]!, pos[k + 1]!, pos[k + 2]!);
      q4.setFromEuler(e3.set(rot[k]!, rot[k + 1]!, rot[k + 2]!));
      s3.setScalar(size[i]! * Math.min(1, f * 1.6));
      m4.compose(p3, q4, s3);
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, c3.setRGB(shade[i]!, shade[i]! * 0.95, shade[i]! * 0.92));
      n++;
    }
    if (n === 0) alive = 0;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
