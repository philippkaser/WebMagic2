import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group } from "three";
import { GROUPS } from "../core/config";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachDynamicBody, forEachHittable } from "../game/registry";
import { isHost } from "../net/netStore";
import { explode, type DamageTeam } from "./damage";
import type { ProjectileSpec } from "./projectiles";

/** The Singularity Staff's two-stage weapon. The primary plants slow "void
 * seeds" (a projectile variant); the secondary, Collapse, activates every live
 * seed into a black hole that drags enemies/props/the caster inward for a beat,
 * then implodes for damage.
 *
 * Multiplayer: seeds are normal networked projectiles, so peers already see
 * them (cosmetic); the Collapse cast is peer-replayed, so every client
 * collapses its own copies and spawns matching black holes. The inward pull and
 * the implosion damage are host-authoritative (like explosions); the local
 * player is always pulled locally. */

// ── Void-seed registry — Collapse activates every live seed ──────────────────

interface Seed {
  getPosition(): { x: number; y: number; z: number };
  collapse(): void;
}

const seeds = new Map<number, Seed>();

/** Collapse all live void seeds (called by the Collapse ability, locally and on
 * peer replay). Collapsing them is what turns the planted seeds into holes. */
export function activateSingularities(): void {
  for (const s of [...seeds.values()]) s.collapse();
}

// Dev-only hook for end-to-end tests (mirrors __game / __fireProjectile).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__collapse = activateSingularities;
}

// ── Black-hole spawn manager (mounted once, in GameScene) ────────────────────

interface Hole {
  id: number;
  pos: [number, number, number];
  damage: number;
  team: DamageTeam;
}

let holeCounter = 1;
let pushHole: ((h: Hole) => void) | null = null;

function spawnBlackHole(pos: [number, number, number], damage: number, team: DamageTeam): void {
  pushHole?.({ id: holeCounter++, pos, damage, team });
}

export function BlackHoles() {
  const [holes, setHoles] = useState<Hole[]>([]);
  useEffect(() => {
    pushHole = (h) => setHoles((prev) => [...prev, h]);
    return () => {
      pushHole = null;
    };
  }, []);
  const remove = useCallback((id: number) => setHoles((prev) => prev.filter((h) => h.id !== id)), []);
  return (
    <>
      {holes.map((h) => (
        <BlackHole key={h.id} hole={h} remove={remove} />
      ))}
    </>
  );
}

// ── The void seed (a projectile variant rendered by Projectiles) ─────────────

export function SingularitySeed({
  spec,
  remove,
}: {
  spec: ProjectileSpec;
  remove: (id: number) => void;
}) {
  const body = useRef<RapierRigidBody>(null);
  const collapsed = useRef(false);
  const light = useRef<DynamicLightSource | null>(null);
  const swirl = useRef<Group>(null);

  const collapse = useCallback(() => {
    if (collapsed.current) return;
    collapsed.current = true;
    const b = body.current;
    const at: [number, number, number] = b
      ? [b.translation().x, b.translation().y, b.translation().z]
      : spec.position;
    spawnBlackHole(at, spec.damage, spec.team);
    remove(spec.id);
  }, [remove, spec]);

  useEffect(() => {
    body.current?.setLinvel(
      { x: spec.velocity[0], y: spec.velocity[1], z: spec.velocity[2] },
      true,
    );
    const src = addLightSource({
      position: spec.position,
      color: "#a06bff",
      intensity: 2.6,
      distance: 6,
      priority: 2,
    });
    light.current = src;
    seeds.set(spec.id, {
      getPosition: () =>
        body.current?.translation() ?? {
          x: spec.position[0],
          y: spec.position[1],
          z: spec.position[2],
        },
      collapse,
    });
    // A seed never activated just fizzles — no free black hole on a timer.
    const expire = setTimeout(() => {
      seeds.delete(spec.id);
      remove(spec.id);
    }, 6000);
    return () => {
      clearTimeout(expire);
      removeLightSource(src);
      light.current = null;
      seeds.delete(spec.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const b = body.current;
    if (!b) return;
    const p = b.translation();
    light.current?.position.set(p.x, p.y, p.z);
    if (swirl.current) {
      swirl.current.rotation.y += dt * 6;
      swirl.current.rotation.x += dt * 3;
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
      linearDamping={2.4}
      onCollisionEnter={() => body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)}
    >
      <BallCollider
        args={[spec.size]}
        collisionGroups={interactionGroups(membership, collidesWith)}
        mass={0.05}
      />
      <group ref={swirl} scale={spec.size}>
        <mesh>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color="#0a0416"
            emissive="#a06bff"
            emissiveIntensity={2.4}
            flatShading
            toneMapped={false}
          />
        </mesh>
      </group>
    </RigidBody>
  );
}

// ── The black hole ───────────────────────────────────────────────────────────

const BH_RADIUS = 4.5;
const BH_DURATION = 1.3;
const BH_PULL = 11;

function BlackHole({ hole, remove }: { hole: Hole; remove: (id: number) => void }) {
  const life = useRef(BH_DURATION);
  const tug = useRef(0);
  const imploded = useRef(false);
  const core = useRef<Group>(null);
  const [cx, cy, cz] = hole.pos;

  useEffect(() => {
    const src = addLightSource({
      position: hole.pos,
      color: "#b06bff",
      intensity: 6,
      distance: 11,
      priority: 3,
    });
    return () => removeLightSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const implode = useCallback(() => {
    if (imploded.current) return;
    imploded.current = true;
    // Host does entity damage; replicas replay VFX + local-player damage only.
    explode({
      position: hole.pos,
      radius: BH_RADIUS,
      damage: hole.damage,
      impulse: 15,
      team: hole.team,
      color: "#b06bff",
      particles: 34,
      light: 30,
      remote: !isHost(),
    });
  }, [hole]);

  useFrame((_, dt) => {
    life.current -= dt;
    const frac = Math.max(0, life.current / BH_DURATION);
    if (core.current) {
      core.current.rotation.y += dt * 5;
      core.current.scale.setScalar(0.5 + frac * 0.9);
    }

    tug.current -= dt;
    const doTug = tug.current <= 0;
    if (doTug) tug.current = 0.1;

    // Enemies and props are the authority's to move.
    if (isHost()) {
      if (doTug) {
        forEachHittable((h) => {
          if (h.team !== "enemy") return; // props are pulled as bodies below
          const p = h.getPosition();
          const dx = cx - p.x;
          const dy = cy - p.y;
          const dz = cz - p.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist > BH_RADIUS || dist < 0.2) return;
          const inv = (BH_PULL * (1 - dist / BH_RADIUS)) / dist;
          // Tiny tick damage + inward impulse: the hit also refreshes the
          // enemy's knockback timer, which suppresses its AI so the pull sticks.
          h.hit(1.5, { x: dx * inv, y: dy * inv + 1, z: dz * inv });
        });
      }
      forEachDynamicBody((b) => {
        const p = b.translation();
        const dx = cx - p.x;
        const dy = cy - p.y;
        const dz = cz - p.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > BH_RADIUS || dist < 0.2) return;
        const inv = (BH_PULL * (1 - dist / BH_RADIUS) * dt * 3) / dist;
        b.applyImpulse({ x: dx * inv, y: dy * inv, z: dz * inv }, true);
      });
    }

    // The caster is physical too — get too close to your own hole and it tugs.
    const pb = getPlayerBody();
    const pdx = cx - playerPosition.x;
    const pdy = cy - playerPosition.y;
    const pdz = cz - playerPosition.z;
    const pdist = Math.hypot(pdx, pdy, pdz);
    if (pb && pdist < BH_RADIUS && pdist > 0.3) {
      const inv = (BH_PULL * (1 - pdist / BH_RADIUS) * dt * 1.4) / pdist;
      pb.applyImpulse({ x: pdx * inv, y: pdy * inv * 0.3, z: pdz * inv }, true);
    }

    // Matter spiralling into the well.
    const a = Math.random() * Math.PI * 2;
    spawnBurst({
      position: [cx + Math.cos(a) * BH_RADIUS * 0.7, cy + (Math.random() - 0.5) * 2, cz + Math.sin(a) * BH_RADIUS * 0.7],
      count: 1,
      color: ["#c89cff", "#5a2d8a"],
      speed: 0,
      upward: 0,
      ttl: 0.5,
      size: 0.07,
      gravity: 0,
      drag: 0,
    });

    if (life.current <= 0) {
      implode();
      remove(hole.id);
    }
  });

  return (
    <group position={hole.pos}>
      <group ref={core}>
        <mesh>
          <sphereGeometry args={[0.6, 16, 16]} />
          <meshStandardMaterial color="#000000" emissive="#3a1a6a" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2.3, 0, 0]}>
          <torusGeometry args={[1.15, 0.12, 8, 24]} />
          <meshStandardMaterial color="#1a0630" emissive="#b06bff" emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
