import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CoefficientCombineRule,
  interactionGroups,
  RigidBody,
  type CollisionPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import { MeshStandardMaterial, SphereGeometry } from "three";
import { playBounce } from "../audio/sound";
import { GROUPS } from "../core/config";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { nearestHittable } from "../game/registry";
import { SingularitySeed } from "./blackhole";
import { explode, type DamageTeam } from "./damage";

// Shared across all bolts: allocating geometry/material per shot causes GC
// churn and a shader compile on the first use of each new material instance.
const boltGeometry = new SphereGeometry(1, 8, 8);
const boltMaterials = new Map<string, MeshStandardMaterial>();

function boltMaterial(color: string): MeshStandardMaterial {
  let mat = boltMaterials.get(color);
  if (!mat) {
    mat = new MeshStandardMaterial({
      color: "#000000",
      emissive: color,
      emissiveIntensity: 4,
      toneMapped: false,
    });
    boltMaterials.set(color, mat);
  }
  return mat;
}

/** Pooled magic projectiles. Real dynamic bodies (they arc, bounce off props
 * and shove things via their explosion) with CCD so fast bolts never tunnel
 * through walls. */

export interface ProjectileSpec {
  id: number;
  team: DamageTeam;
  position: [number, number, number];
  velocity: [number, number, number];
  damage: number;
  blastRadius: number;
  blastImpulse: number;
  color: string;
  size: number;
  gravityScale: number;
  /** Seek strength 0..~1: how hard a player bolt curves toward enemies. */
  homing: number;
  /** Ricochets off the WORLD this many times before a wall detonates it.
   * Enemies and props always detonate on contact. */
  bounces: number;
  /** Mid-air fission: after a short flight the bolt splits into 1+split
   * children fanning out (children never split again). */
  split: number;
  /** Detonate this many seconds after launch (0 = default lifetime). */
  fuse: number;
  /** A void seed: plants instead of exploding, and collapses into a black hole
   * when the staff's Collapse ability activates it. */
  singularity: boolean;
  /** Replayed peer/replicated projectile: explosion skips entity damage. */
  cosmetic: boolean;
}

export interface FireOptions {
  team: DamageTeam;
  position: [number, number, number];
  velocity: [number, number, number];
  damage: number;
  blastRadius?: number;
  blastImpulse?: number;
  color?: string;
  size?: number;
  gravityScale?: number;
  homing?: number;
  bounces?: number;
  split?: number;
  fuse?: number;
  singularity?: boolean;
  cosmetic?: boolean;
}

const MAX_LIVE = 80;
let nextProjectileId = 1;
let enqueue: ((spec: ProjectileSpec) => void) | null = null;

// Dev-only hook for end-to-end tests (mirrors __game / __spawnEnemy).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__fireProjectile = (o: FireOptions) =>
    fireProjectile(o);
}

export function fireProjectile(opts: FireOptions): void {
  enqueue?.({
    id: nextProjectileId++,
    team: opts.team,
    position: opts.position,
    velocity: opts.velocity,
    damage: opts.damage,
    blastRadius: opts.blastRadius ?? 1.7,
    blastImpulse: opts.blastImpulse ?? 9,
    color: opts.color ?? "#7fd4ff",
    size: opts.size ?? 0.13,
    gravityScale: opts.gravityScale ?? 0,
    homing: opts.homing ?? 0,
    bounces: Math.max(0, Math.round(opts.bounces ?? 0)),
    split: Math.max(0, Math.round(opts.split ?? 0)),
    fuse: opts.fuse ?? 0,
    singularity: opts.singularity ?? false,
    cosmetic: opts.cosmetic ?? false,
  });
}

export function Projectiles() {
  const [live, setLive] = useState<ProjectileSpec[]>([]);

  useEffect(() => {
    enqueue = (spec) =>
      setLive((prev) => (prev.length >= MAX_LIVE ? prev : [...prev, spec]));
    return () => {
      enqueue = null;
    };
  }, []);

  const remove = useCallback((id: number) => {
    setLive((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <>
      {live.map((spec) =>
        spec.singularity ? (
          <SingularitySeed key={spec.id} spec={spec} remove={remove} />
        ) : (
          <Bolt key={spec.id} spec={spec} remove={remove} />
        ),
      )}
    </>
  );
}

function Bolt({ spec, remove }: { spec: ProjectileSpec; remove: (id: number) => void }) {
  const body = useRef<RapierRigidBody>(null);
  const detonated = useRef(false);
  const trailClock = useRef(0);
  const light = useRef<DynamicLightSource | null>(null);
  const bouncesLeft = useRef(spec.bounces);
  const age = useRef(0);

  const detonate = useCallback(() => {
    if (detonated.current) return;
    detonated.current = true;
    const b = body.current;
    const at: [number, number, number] = b
      ? [b.translation().x, b.translation().y, b.translation().z]
      : spec.position;
    explode({
      position: at,
      radius: spec.blastRadius,
      damage: spec.damage,
      impulse: spec.blastImpulse,
      team: spec.team,
      color: spec.color,
      particles: 14,
      light: 14,
      remote: spec.cosmetic,
    });
    remove(spec.id);
  }, [remove, spec]);

  // Walls eat a bounce charge (or detonate); flesh and props always detonate.
  const onCollision = useCallback(
    (payload: CollisionPayload) => {
      const groups = payload.other.collider?.collisionGroups() ?? 0;
      const hitWorld = ((groups >> 16) & (1 << GROUPS.WORLD)) !== 0;
      if (hitWorld && bouncesLeft.current > 0) {
        bouncesLeft.current -= 1;
        playBounce();
        const b = body.current;
        if (b) {
          const t = b.translation();
          spawnBurst({
            position: [t.x, t.y, t.z],
            count: 4,
            color: [spec.color, "#fff3d0"],
            speed: 2.4,
            upward: 0.5,
            ttl: 0.3,
            size: 0.05,
          });
        }
        return;
      }
      detonate();
    },
    [detonate, spec.color],
  );

  // Fission: after a beat of flight the bolt pops into a fan of children.
  const splitNow = useCallback(() => {
    if (detonated.current) return;
    detonated.current = true;
    const b = body.current;
    if (!b) return remove(spec.id);
    const t = b.translation();
    const v = b.linvel();
    const speed = Math.hypot(v.x, v.y, v.z) || 1;
    // Two unit vectors perpendicular to the flight path span the fan plane.
    const ax = Math.abs(v.y) < 0.9 * speed ? 0 : 1;
    let px = ax === 0 ? -v.z : 0;
    let py = ax === 0 ? 0 : v.z;
    let pz = ax === 0 ? v.x : -v.y;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl;
    py /= pl;
    pz /= pl;
    const qx = (v.y * pz - v.z * py) / speed;
    const qy = (v.z * px - v.x * pz) / speed;
    const qz = (v.x * py - v.y * px) / speed;
    const children = spec.split + 1;
    for (let i = 0; i < children; i++) {
      const a = (i / children) * Math.PI * 2 + Math.random() * 0.8;
      const wob = 0.22 + Math.random() * 0.1;
      const ox = (Math.cos(a) * px + Math.sin(a) * qx) * wob;
      const oy = (Math.cos(a) * py + Math.sin(a) * qy) * wob;
      const oz = (Math.cos(a) * pz + Math.sin(a) * qz) * wob;
      const nl = Math.hypot(v.x / speed + ox, v.y / speed + oy, v.z / speed + oz) || 1;
      fireProjectile({
        team: spec.team,
        position: [t.x, t.y, t.z],
        velocity: [
          ((v.x / speed + ox) / nl) * speed,
          ((v.y / speed + oy) / nl) * speed,
          ((v.z / speed + oz) / nl) * speed,
        ],
        damage: spec.damage * 0.65,
        blastRadius: spec.blastRadius * 0.85,
        blastImpulse: spec.blastImpulse * 0.85,
        color: spec.color,
        size: spec.size * 0.8,
        gravityScale: spec.gravityScale,
        homing: spec.homing,
        bounces: bouncesLeft.current,
        split: 0,
        // Fused parents (grenades) hand children the remaining fuse.
        fuse: spec.fuse > 0 ? Math.max(0.45, spec.fuse - 0.22) : 0,
        cosmetic: spec.cosmetic,
      });
    }
    spawnBurst({
      position: [t.x, t.y, t.z],
      count: 8,
      color: [spec.color, "#ffffff"],
      speed: 3,
      upward: 0,
      ttl: 0.25,
      size: 0.07,
      gravity: 0,
      drag: 2,
    });
    remove(spec.id);
  }, [remove, spec]);

  useEffect(() => {
    body.current?.setLinvel(
      { x: spec.velocity[0], y: spec.velocity[1], z: spec.velocity[2] },
      true,
    );
    // Bolts light the corridors they fly through — the pool assigns real
    // lights to the ones nearest the camera.
    const src = addLightSource({
      position: spec.position,
      color: spec.color,
      intensity: 3.2,
      distance: 8,
      priority: 3,
    });
    light.current = src;
    const timeout = setTimeout(detonate, spec.fuse > 0 ? spec.fuse * 1000 : 3200);
    return () => {
      clearTimeout(timeout);
      removeLightSource(src);
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const b = body.current;
    if (!b || detonated.current) return;
    const pos = b.translation();
    light.current?.position.set(pos.x, pos.y, pos.z);

    // Fission pops shortly after launch — far enough to have cleared the
    // caster, early enough that the fan still converges on the aim point.
    age.current += dt;
    if (spec.split > 0 && age.current >= 0.22) {
      splitNow();
      return;
    }

    // Homing: gently curve our own bolts toward the nearest enemy ahead,
    // preserving speed. Player-only and skipped on cosmetic peer replays.
    if (spec.homing > 0 && spec.team === "player" && !spec.cosmetic) {
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const target = speed > 0.1 ? nearestHittable("enemy", pos.x, pos.y, pos.z, 16) : null;
      if (target) {
        const tp = target.getPosition();
        const tx = tp.x - pos.x;
        const ty = tp.y - pos.y;
        const tz = tp.z - pos.z;
        const td = Math.hypot(tx, ty, tz) || 1;
        // Only steer toward targets roughly ahead — no U-turns.
        if ((v.x * tx + v.y * ty + v.z * tz) / (speed * td) > 0.15) {
          const turn = Math.min(1, spec.homing * dt * 6);
          const nx = v.x / speed + (tx / td - v.x / speed) * turn;
          const ny = v.y / speed + (ty / td - v.y / speed) * turn;
          const nz = v.z / speed + (tz / td - v.z / speed) * turn;
          const nl = Math.hypot(nx, ny, nz) || 1;
          b.setLinvel({ x: (nx / nl) * speed, y: (ny / nl) * speed, z: (nz / nl) * speed }, true);
        }
      }
    }

    trailClock.current -= dt;
    if (trailClock.current <= 0) {
      trailClock.current = 0.035;
      const t = b.translation();
      spawnBurst({
        position: [t.x, t.y, t.z],
        count: 1,
        color: spec.color,
        speed: 0.4,
        upward: 0,
        ttl: 0.35,
        size: 0.06,
        gravity: 0,
        drag: 0,
      });
    }
  });

  const membership =
    spec.team === "player" ? GROUPS.FRIENDLY_PROJECTILE : GROUPS.ENEMY_PROJECTILE;
  const collidesWith =
    spec.team === "player"
      ? [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP]
      : [GROUPS.WORLD, GROUPS.PLAYER, GROUPS.PROP];

  return (
    <RigidBody
      ref={body}
      position={spec.position}
      gravityScale={spec.gravityScale}
      ccd
      colliders={false}
      onCollisionEnter={onCollision}
    >
      <BallCollider
        args={[spec.size]}
        collisionGroups={interactionGroups(membership, collidesWith)}
        mass={0.05}
        restitution={spec.bounces > 0 ? 0.85 : 0}
        // Max rule: the wall's restitution 0 must not deaden the ricochet.
        restitutionCombineRule={CoefficientCombineRule.Max}
        friction={0.1}
      />
      <mesh geometry={boltGeometry} material={boltMaterial(spec.color)} scale={spec.size} />
    </RigidBody>
  );
}
