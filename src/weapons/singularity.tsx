import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group } from "three";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { blackHoleFx, collapseFlashFx, voidSeedFx } from "../fx/effects";
import type { DamageSource } from "../game/damageSource";
import { isHostileWizard } from "../game/hostility";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachDynamicBody, forEachHittable } from "../game/registry";
import { isHost } from "../net/netStore";
import { holePullsLocal, type DamageTeam } from "./allegiance";
import { explode } from "./explosions";
import { localWizardId } from "./localWizard";
import type { ProjectileSpec } from "./projectiles";

/** The Singularity Staff's two-stage weapon. The primary plants slow "void
 * seeds" (a projectile variant); the secondary, Collapse, activates the
 * caster's live seeds into black holes that drag enemies/props/wizards inward
 * for a beat, then implode for damage.
 *
 * Multiplayer: seeds are normal networked projectiles, so peers already see
 * them (cosmetic); the Collapse cast is peer-replayed, so every client
 * collapses its copies of THAT caster's seeds and spawns matching black holes.
 * The pull on enemies/props and the implosion's entity damage are
 * host-authoritative (like explosions). The local wizard is pulled locally by
 * its own and hostile wizards' holes, and hurt only by hostile ones
 * (allegiance.ts — the same rule as every blast). */

// ── Void-seed registry, keyed by owner ───────────────────────────────────────
// Every machine holds seeds from several wizards (its own + replays), so a
// Collapse must only reach its caster's seeds — otherwise a floor-mate's
// Collapse would detonate the seeds YOU planted.

/** owner wizard id → (seed projectile id → collapse) */
const seedsByOwner = new Map<string, Map<number, () => void>>();

function ownerOf(source: DamageSource): string {
  return source.kind === "wizard" ? source.id : "";
}

function registerSeed(owner: string, id: number, collapse: () => void): void {
  let mine = seedsByOwner.get(owner);
  if (!mine) {
    mine = new Map();
    seedsByOwner.set(owner, mine);
  }
  mine.set(id, collapse);
}

function unregisterSeed(owner: string, id: number): void {
  const mine = seedsByOwner.get(owner);
  if (!mine) return;
  mine.delete(id);
  if (mine.size === 0) seedsByOwner.delete(owner);
}

/** Collapse every live void seed planted by `owner` (a wizard id) — called by
 * the Collapse ability, locally with our id and on peer replay with the
 * caster's. Collapsing them is what turns the planted seeds into holes. */
export function activateSingularities(owner: string): void {
  const mine = seedsByOwner.get(owner);
  if (!mine) return;
  for (const collapse of [...mine.values()]) collapse();
}

// Dev-only hook for end-to-end tests (mirrors __game / __fireProjectile):
// collapses the local wizard's seeds, like pressing Collapse.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__collapse = () =>
    activateSingularities(localWizardId());
}

// ── Black-hole spawn manager (mounted once, in GameScene) ────────────────────

interface Hole {
  id: number;
  pos: [number, number, number];
  damage: number;
  team: DamageTeam;
  /** The seed's caster — who the implosion is credited to, and whether the
   * hole may tug/hurt the local wizard. */
  source: DamageSource;
}

let holeCounter = 1;
let pushHole: ((h: Hole) => void) | null = null;

function spawnBlackHole(
  pos: [number, number, number],
  damage: number,
  team: DamageTeam,
  source: DamageSource,
): void {
  pushHole?.({ id: holeCounter++, pos, damage, team, source });
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
    spawnBlackHole(at, spec.damage, spec.team, spec.source);
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
    const owner = ownerOf(spec.source);
    registerSeed(owner, spec.id, collapse);
    // A seed never activated just fizzles — no free black hole on a timer.
    const expire = setTimeout(() => {
      unregisterSeed(owner, spec.id);
      remove(spec.id);
    }, 6000);
    return () => {
      clearTimeout(expire);
      removeLightSource(src);
      light.current = null;
      unregisterSeed(owner, spec.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const b = body.current;
    if (!b) return;
    const p = b.translation();
    light.current?.position.set(p.x, p.y, p.z);
    // Motes drawn in on tight spirals + a dark wake: a seed that eats light.
    voidSeedFx(p, spec.size);
    if (swirl.current) {
      swirl.current.rotation.y += dt * 6;
      swirl.current.rotation.x += dt * 3;
    }
  });

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
      <BallCollider args={[spec.size]} collisionGroups={spec.collisionGroups} mass={0.05} />
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

/** Seconds between event-horizon rings contracting into the core. */
const BH_RING_EVERY = 0.16;

function BlackHole({ hole, remove }: { hole: Hole; remove: (id: number) => void }) {
  const life = useRef(BH_DURATION);
  const tug = useRef(0);
  const ringClock = useRef(0);
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
    collapseFlashFx(hole.pos);
    // Host does entity damage; replicas replay VFX + local-player effects
    // only. The local wizard is hurt only by a hostile caster's implosion.
    explode({
      position: hole.pos,
      radius: BH_RADIUS,
      damage: hole.damage,
      impulse: 15,
      team: hole.team,
      source: hole.source,
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

    // The local wizard is physical too: get too close to your own hole and it
    // tugs; a hostile wizard's hole drags you toward its implosion. Allies'
    // holes leave you be.
    const pb = getPlayerBody();
    const pdx = cx - playerPosition.x;
    const pdy = cy - playerPosition.y;
    const pdz = cz - playerPosition.z;
    const pdist = Math.hypot(pdx, pdy, pdz);
    if (
      pb &&
      pdist < BH_RADIUS &&
      pdist > 0.3 &&
      holePullsLocal(hole.team, hole.source, localWizardId(), isHostileWizard)
    ) {
      const inv = (BH_PULL * (1 - pdist / BH_RADIUS) * dt * 1.4) / pdist;
      pb.applyImpulse({ x: pdx * inv, y: pdy * inv * 0.3, z: pdz * inv }, true);
    }

    // Matter spiralling into the well along its accretion disc, and rings
    // of light falling through the event horizon.
    ringClock.current -= dt;
    const pulse = ringClock.current <= 0;
    if (pulse) ringClock.current = BH_RING_EVERY;
    blackHoleFx(hole.pos, BH_RADIUS, pulse);

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
