import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
} from "three";
import { GRAVITY } from "../../core/config";
import { gameEvents } from "../../core/events";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { playerPosition } from "../../game/player-state";
import { useGame } from "../../state/gameStore";
import type { Vec3 } from "../../world/types";
import { WALLS_ONLY } from "../shared";

/** Lingering ground hazards left by lobbed enemy spells (an imp's fireball,
 * the Choir's falling notes). A lob is fully described by its launch —
 * origin, velocity, gravity — so every client predicts the same landing spot
 * from the replicated cast and lights its own patch there. Damage is local:
 * each client burns only its own wizard, like contact damage. */

const MAX_PATCHES = 10;
const MAX_PENDING = 16;
const TICK = 0.3;
/** Arc sampling for the "did it hit a wall first" check. */
const ARC_STEPS = 8;

export interface BurnSpec {
  /** Seconds the patch burns. */
  ttl: number;
  /** Damage per second to a wizard standing in it. */
  dps: number;
  radius: number;
  color: string;
}

interface Pending {
  origin: Vec3;
  velocity: Vec3;
  gravity: number;
  spec: BurnSpec;
}

interface Patch {
  alive: boolean;
  x: number;
  z: number;
  age: number;
  spec: BurnSpec;
  light: DynamicLightSource | null;
  seed: number;
}

const pending: Pending[] = [];
const patches: Patch[] = [];

/** Queue a lobbed hazard. Host calls it directly when casting; replicas get
 * it from the replicated enemyCast (see the subscription below). */
export function scheduleBurn(origin: Vec3, velocity: Vec3, gravity: number, spec: BurnSpec): void {
  if (pending.length < MAX_PENDING) pending.push({ origin, velocity, gravity, spec });
}

/** Burn patches spawned by replicated casts carry their look in the cast. */
gameEvents.on("entityEvent", (ev) => {
  if (ev.k !== "enemyCast" || !ev.burn) return;
  scheduleBurn(ev.origin, ev.velocity, ev.gravity ?? 0, {
    ttl: ev.burn,
    dps: ev.damage * 0.9,
    radius: ev.blastRadius * 0.8,
    color: ev.color,
  });
});

/** Seconds until a ballistic launch comes down to height y (or +∞). */
function landingTime(oy: number, vy: number, g: number, y: number): number {
  // oy + vy t + ½ g t² = y
  const a = 0.5 * g;
  const c = oy - y;
  const disc = vy * vy - 4 * a * c;
  if (a === 0 || disc < 0) return Infinity;
  const r = Math.sqrt(disc);
  return Math.max((-vy - r) / (2 * a), (-vy + r) / (2 * a));
}

const patchGeo = new CircleGeometry(1, 7).rotateX(-Math.PI / 2);
const outerMat = new MeshBasicMaterial({
  transparent: true,
  opacity: 0.55,
  blending: AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
const innerMat = outerMat.clone();
innerMat.opacity = 0.9;
const dummy = new Object3D();
const tmpColor = new Color();
const hotColor = new Color();
const HOT = "#fff2c0";

export function HazardSystem() {
  const { world, rapier } = useRapier();
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const [outer, inner] = useMemo(
    () =>
      [outerMat, innerMat].map((mat) => {
        const m = new InstancedMesh(patchGeo, mat, MAX_PATCHES);
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        m.setColorAt(0, tmpColor.set("#ffffff"));
        m.frustumCulled = false;
        m.count = 0;
        return m;
      }),
    [],
  );
  const state = useMemo(() => ({ tick: 0, ember: 0 }), []);

  useEffect(
    () => () => {
      pending.length = 0;
      for (const p of patches) if (p.light) removeLightSource(p.light);
      patches.length = 0;
    },
    [],
  );

  /** Where (and after how long) a lob first meets the world: walls stop it
   * early — the fire drips down to their foot — otherwise the floor. */
  const resolveLanding = (p: Pending): { x: number; z: number; t: number } | null => {
    const g = GRAVITY * p.gravity;
    const tLand = landingTime(p.origin[1], p.velocity[1], g, 0.05);
    if (!Number.isFinite(tLand)) return null;
    const stepT = tLand / ARC_STEPS;
    let px = p.origin[0];
    let py = p.origin[1];
    let pz = p.origin[2];
    for (let i = 1; i <= ARC_STEPS; i++) {
      const t = stepT * i;
      const nx = p.origin[0] + p.velocity[0] * t;
      const ny = p.origin[1] + p.velocity[1] * t + 0.5 * g * t * t;
      const nz = p.origin[2] + p.velocity[2] * t;
      const dx = nx - px;
      const dy = ny - py;
      const dz = nz - pz;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-4) {
        ray.origin = { x: px, y: py, z: pz };
        ray.dir = { x: dx / len, y: dy / len, z: dz / len };
        const hit = world.castRay(ray, len, true, undefined, WALLS_ONLY);
        if (hit) {
          const toi = Math.max(0, hit.timeOfImpact - 0.35);
          return {
            x: px + (dx / len) * toi,
            z: pz + (dz / len) * toi,
            t: stepT * (i - 1 + toi / len),
          };
        }
      }
      px = nx;
      py = ny;
      pz = nz;
    }
    return { x: px, z: pz, t: tLand };
  };

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = clock.elapsedTime;

    // Resolve new lobs into timed patches (flight time is baked into age).
    while (pending.length > 0) {
      const p = pending.shift()!;
      const landing = resolveLanding(p);
      if (!landing) continue;
      if (patches.length >= MAX_PATCHES) {
        const oldest = patches.shift()!;
        if (oldest.light) removeLightSource(oldest.light);
      }
      patches.push({
        alive: true,
        x: landing.x,
        z: landing.z,
        age: -landing.t,
        spec: p.spec,
        light: null,
        seed: Math.random() * 10,
      });
    }

    state.tick -= dt;
    state.ember -= dt;
    const tickNow = state.tick <= 0;
    if (tickNow) state.tick = TICK;
    const emberNow = state.ember <= 0;
    if (emberNow) state.ember = 0.12;
    const inDungeon = useGame.getState().phase === "dungeon";

    let n = 0;
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i];
      p.age += dt;
      if (p.age >= p.spec.ttl) {
        if (p.light) removeLightSource(p.light);
        patches.splice(i, 1);
        continue;
      }
      if (p.age < 0) continue; // still in flight
      if (!p.light) {
        p.light = addLightSource({
          position: [p.x, 0.4, p.z],
          color: p.spec.color,
          intensity: 3,
          distance: 5,
          priority: 1,
        });
      }
      // Flare on ignition, gutter out at the end.
      const life = p.age / p.spec.ttl;
      const grow = Math.min(1, p.age * 6);
      const fade = life > 0.75 ? 1 - (life - 0.75) / 0.25 : 1;
      const flicker = 0.85 + Math.sin(time * 13 + p.seed) * 0.08 + Math.sin(time * 29 + p.seed * 3) * 0.07;
      p.light.intensity = 3.2 * fade * flicker + (p.age < 0.15 ? 6 : 0);
      const r = p.spec.radius * grow * (0.75 + 0.25 * fade);
      tmpColor.set(p.spec.color);
      dummy.position.set(p.x, 0.03, p.z);
      dummy.rotation.set(0, p.seed + time * 0.4, 0);
      dummy.scale.set(r * flicker, 1, r * flicker);
      dummy.updateMatrix();
      outer.setMatrixAt(n, dummy.matrix);
      outer.setColorAt(n, tmpColor.multiplyScalar(fade));
      dummy.position.y = 0.05;
      dummy.rotation.y = -p.seed - time * 0.7;
      dummy.scale.set(r * 0.55, 1, r * 0.55);
      dummy.updateMatrix();
      inner.setMatrixAt(n, dummy.matrix);
      inner.setColorAt(n, hotColor.set(HOT).lerp(tmpColor.set(p.spec.color), 0.4).multiplyScalar(fade));
      n++;

      if (emberNow) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r;
        spawnBurst({
          position: [p.x + Math.cos(a) * d, 0.1, p.z + Math.sin(a) * d],
          count: 1,
          color: [p.spec.color, "#ffe7a0"],
          speed: 0.6,
          upward: 2.4,
          ttl: 0.7,
          size: 0.07,
          gravity: 1.5,
          drag: 0.5,
        });
      }

      // Burn our own wizard while they stand in it (jumping over is fair play).
      if (tickNow && inDungeon) {
        const dx = playerPosition.x - p.x;
        const dz = playerPosition.z - p.z;
        if (dx * dx + dz * dz < r * r && playerPosition.y < 1.5) {
          useGame.getState().takeDamage(p.spec.dps * TICK);
        }
      }
    }
    outer.count = n;
    inner.count = n;
    outer.instanceMatrix.needsUpdate = true;
    inner.instanceMatrix.needsUpdate = true;
    if (outer.instanceColor) outer.instanceColor.needsUpdate = true;
    if (inner.instanceColor) inner.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <primitive object={outer} />
      <primitive object={inner} />
    </>
  );
}
