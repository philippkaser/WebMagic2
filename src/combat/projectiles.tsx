import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import { GROUPS } from "../core/config";
import { spawnBurst } from "../fx/Particles";
import { explode, type DamageTeam } from "./damage";

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
}

const MAX_LIVE = 80;
let nextProjectileId = 1;
let enqueue: ((spec: ProjectileSpec) => void) | null = null;

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
      {live.map((spec) => (
        <Bolt key={spec.id} spec={spec} remove={remove} />
      ))}
    </>
  );
}

function Bolt({ spec, remove }: { spec: ProjectileSpec; remove: (id: number) => void }) {
  const body = useRef<RapierRigidBody>(null);
  const detonated = useRef(false);
  const trailClock = useRef(0);

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
    });
    remove(spec.id);
  }, [remove, spec]);

  useEffect(() => {
    body.current?.setLinvel(
      { x: spec.velocity[0], y: spec.velocity[1], z: spec.velocity[2] },
      true,
    );
    const timeout = setTimeout(detonate, 3200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const b = body.current;
    if (!b || detonated.current) return;
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
      onCollisionEnter={detonate}
    >
      <BallCollider
        args={[spec.size]}
        collisionGroups={interactionGroups(membership, collidesWith)}
        mass={0.05}
      />
      <mesh>
        <sphereGeometry args={[spec.size, 8, 8]} />
        <meshStandardMaterial
          color="#000000"
          emissive={spec.color}
          emissiveIntensity={4}
          toneMapped={false}
        />
      </mesh>
    </RigidBody>
  );
}
