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
import { Group } from "three";
import { playBounce } from "../audio/sound";
import { GROUPS } from "../core/config";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachDynamicBody, forEachHittable, nearestHittable } from "../game/registry";
import { isHost } from "../net/netStore";
import { explode, type DamageTeam } from "./damage";
import { fanVelocities, fireProjectile, type ProjectileSpec } from "./projectiles";

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
  const bouncesLeft = useRef(spec.bounces);
  const age = useRef(0);

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

  // Mid-air fission — a splitting seed scatters into a cluster of smaller
  // seeds, so one Collapse detonates a whole minefield of black holes.
  const splitNow = useCallback(() => {
    if (collapsed.current) return;
    collapsed.current = true;
    const b = body.current;
    if (!b) return remove(spec.id);
    const t = b.translation();
    for (const velocity of fanVelocities(b.linvel(), spec.split + 1)) {
      fireProjectile({
        team: spec.team,
        position: [t.x, t.y, t.z],
        velocity,
        damage: spec.damage * 0.65,
        color: spec.color,
        size: spec.size * 0.85,
        gravityScale: spec.gravityScale,
        homing: spec.homing,
        bounces: bouncesLeft.current,
        split: 0,
        singularity: true,
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

  // Walls eat a bounce charge instead of planting the seed; anything else
  // (or a spent charge) stops it dead, planted where it hit.
  const onCollision = useCallback(
    (payload: CollisionPayload) => {
      const groups = payload.other.collider?.collisionGroups() ?? 0;
      const hitWorld = ((groups >> 16) & (1 << GROUPS.WORLD)) !== 0;
      if (hitWorld && bouncesLeft.current > 0) {
        bouncesLeft.current -= 1;
        playBounce();
        return;
      }
      body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    },
    [],
  );

  useFrame((_, dt) => {
    const b = body.current;
    if (!b) return;
    const p = b.translation();
    light.current?.position.set(p.x, p.y, p.z);
    if (swirl.current) {
      swirl.current.rotation.y += dt * 6;
      swirl.current.rotation.x += dt * 3;
    }

    age.current += dt;
    if (spec.split > 0 && age.current >= 0.22) {
      splitNow();
      return;
    }

    // Homing gear steers seeds while they still fly (planted seeds sit still).
    if (spec.homing > 0 && spec.team === "player" && !spec.cosmetic) {
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 2) {
        const target = nearestHittable("enemy", p.x, p.y, p.z, 16);
        if (target) {
          const tp = target.getPosition();
          const tx = tp.x - p.x;
          const ty = tp.y - p.y;
          const tz = tp.z - p.z;
          const td = Math.hypot(tx, ty, tz) || 1;
          if ((v.x * tx + v.y * ty + v.z * tz) / (speed * td) > 0.15) {
            const turn = Math.min(1, spec.homing * dt * 6);
            const nx = v.x / speed + (tx / td - v.x / speed) * turn;
            const ny = v.y / speed + (ty / td - v.y / speed) * turn;
            const nz = v.z / speed + (tz / td - v.z / speed) * turn;
            const nl = Math.hypot(nx, ny, nz) || 1;
            b.setLinvel(
              { x: (nx / nl) * speed, y: (ny / nl) * speed, z: (nz / nl) * speed },
              true,
            );
          }
        }
      }
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
      linearDamping={spec.bounces > 0 ? 0.6 : 2.4}
      onCollisionEnter={onCollision}
    >
      <BallCollider
        args={[spec.size]}
        collisionGroups={interactionGroups(membership, collidesWith)}
        mass={0.05}
        restitution={spec.bounces > 0 ? 0.8 : 0}
        restitutionCombineRule={CoefficientCombineRule.Max}
      />
      {/* A splinter of the tear itself: black kernel in a cage of shards. */}
      <group ref={swirl} scale={spec.size}>
        <mesh>
          <icosahedronGeometry args={[0.8, 0]} />
          <meshStandardMaterial
            color="#0a0416"
            emissive="#a06bff"
            emissiveIntensity={2.4}
            flatShading
            toneMapped={false}
          />
        </mesh>
        <mesh rotation={[0.6, 0.3, 0.9]} scale={1.4}>
          <tetrahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color="#050208"
            emissive="#6a3dcc"
            emissiveIntensity={1.1}
            flatShading
            transparent
            opacity={0.65}
          />
        </mesh>
        <mesh rotation={[2.1, 1.4, 0.2]} scale={1.15}>
          <tetrahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color="#050208"
            emissive="#c89cff"
            emissiveIntensity={0.8}
            flatShading
            transparent
            opacity={0.5}
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
      style: "arcane",
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
      {/* A wound in the world, rim chewed ragged, reality splintering off it. */}
      <group ref={core}>
        <mesh>
          <icosahedronGeometry args={[0.6, 1]} />
          <meshStandardMaterial
            color="#000000"
            emissive="#3a1a6a"
            emissiveIntensity={1.4}
            flatShading
            toneMapped={false}
          />
        </mesh>
        {/* Two jagged low-poly accretion rings, counter-tilted. */}
        <mesh rotation={[Math.PI / 2.3, 0, 0]}>
          <torusGeometry args={[1.15, 0.12, 3, 7]} />
          <meshStandardMaterial
            color="#1a0630"
            emissive="#b06bff"
            emissiveIntensity={2.6}
            flatShading
            toneMapped={false}
          />
        </mesh>
        <mesh rotation={[Math.PI / 1.7, 0.5, 0]}>
          <torusGeometry args={[0.9, 0.07, 3, 6]} />
          <meshStandardMaterial
            color="#0c0318"
            emissive="#e0ccff"
            emissiveIntensity={1.6}
            flatShading
            toneMapped={false}
            transparent
            opacity={0.8}
          />
        </mesh>
        {/* Splinters of floor and wall caught on the rim. */}
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 1.3, Math.sin(a * 2.7) * 0.3, Math.sin(a) * 1.3]}
              rotation={[a * 1.7, a, a * 0.6]}
              scale={0.14 + (i % 3) * 0.05}
            >
              <tetrahedronGeometry args={[1, 0]} />
              <meshStandardMaterial
                color="#100c18"
                emissive="#b06bff"
                emissiveIntensity={0.9}
                flatShading
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
