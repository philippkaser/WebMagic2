import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

/** Pooled CPU particle system rendered as one instanced draw call. Gameplay
 * code calls spawnBurst() from anywhere. Light emission lives in
 * DynamicLights (flashLight) — this module is purely the sparks/debris. */

const MAX_PARTICLES = 3072;

interface Particle {
  alive: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  ttl: number;
  size: number;
  gravity: number;
  drag: number;
}

export interface BurstOptions {
  position: Vector3 | [number, number, number];
  count?: number;
  /** One or more hex colors, picked per particle. */
  color?: string | string[];
  speed?: number;
  /** Extra upward bias. */
  upward?: number;
  ttl?: number;
  size?: number;
  gravity?: number;
  drag?: number;
}

interface Manager {
  particles: Particle[];
  mesh: InstancedMesh;
  cursor: number;
  highWater: number;
}

let manager: Manager | null = null;

const tmpColor = new Color();

export function spawnBurst(opts: BurstOptions): void {
  if (!manager) return;
  const {
    count = 16,
    color = "#ffcf7a",
    speed = 6,
    upward = 2,
    ttl = 0.8,
    size = 0.09,
    gravity = -14,
    drag = 1.6,
  } = opts;
  const [x, y, z] = Array.isArray(opts.position)
    ? opts.position
    : [opts.position.x, opts.position.y, opts.position.z];
  const colors = Array.isArray(color) ? color : [color];
  for (let i = 0; i < count; i++) {
    const p = manager.particles[manager.cursor];
    const slot = manager.cursor;
    manager.cursor = (manager.cursor + 1) % MAX_PARTICLES;
    manager.highWater = Math.max(manager.highWater, slot + 1);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const s = speed * (0.35 + Math.random() * 0.65);
    p.alive = true;
    p.px = x;
    p.py = y;
    p.pz = z;
    p.vx = Math.sin(phi) * Math.cos(theta) * s;
    p.vy = Math.cos(phi) * s + upward;
    p.vz = Math.sin(phi) * Math.sin(theta) * s;
    p.age = 0;
    p.ttl = ttl * (0.6 + Math.random() * 0.8);
    p.size = size * (0.6 + Math.random() * 0.9);
    p.gravity = gravity;
    p.drag = drag;
    tmpColor.set(colors[(Math.random() * colors.length) | 0]);
    manager.mesh.setColorAt(slot, tmpColor);
  }
  if (manager.mesh.instanceColor) manager.mesh.instanceColor.needsUpdate = true;
}

export function FxSystems() {
  const meshRef = useRef<InstancedMesh>(null!);
  const dummy = useMemo(() => new Object3D(), []);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () => new MeshBasicMaterial({ toneMapped: false }),
    [],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    const particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
      alive: false,
      px: 0,
      py: 0,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      ttl: 1,
      size: 0.1,
      gravity: 0,
      drag: 0,
    }));
    // Initialize instance colors so the attribute exists before first burst,
    // then mark both instance buffers as dynamic — they stream every frame,
    // and static-usage uploads can stall some drivers.
    for (let i = 0; i < MAX_PARTICLES; i++) mesh.setColorAt(i, tmpColor.set("#ffffff"));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor?.setUsage(DynamicDrawUsage);
    manager = { particles, mesh, cursor: 0, highWater: 0 };
    return () => {
      manager = null;
    };
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (!manager) return;
    const { particles, mesh, highWater } = manager;
    let alive = 0;
    for (let i = 0; i < highWater; i++) {
      const p = particles[i];
      if (!p.alive) {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
      } else {
        p.age += dt;
        if (p.age >= p.ttl) {
          p.alive = false;
          dummy.scale.setScalar(0.0001);
        } else {
          alive++;
          const damp = Math.max(0, 1 - p.drag * dt);
          p.vx *= damp;
          p.vz *= damp;
          p.vy = p.vy * damp + p.gravity * dt;
          p.px += p.vx * dt;
          p.py += p.vy * dt;
          p.pz += p.vz * dt;
          if (p.py < 0.03 && p.vy < 0) {
            p.py = 0.03;
            p.vy *= -0.35;
          }
          const t = p.age / p.ttl;
          dummy.position.set(p.px, p.py, p.pz);
          dummy.scale.setScalar(p.size * (1 - t * t));
        }
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    // Compact when idle so quiet stretches stop paying for the biggest
    // burst that ever happened.
    if (alive === 0 && highWater > 0) {
      manager.highWater = 0;
      manager.cursor = 0;
    }
    mesh.count = manager.highWater;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PARTICLES]}
      frustumCulled={false}
    />
  );
}
