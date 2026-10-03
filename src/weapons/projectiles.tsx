import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import { MeshStandardMaterial, SphereGeometry } from "three";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { boltTrailFx } from "../fx/effects";
import type { DamageSource } from "../game/damageSource";
import { isHostileWizard } from "../game/hostility";
import { nearestHittable } from "../game/registry";
import {
  defaultSource,
  PROJECTILE_GROUPS,
  relationToLocal,
  type DamageTeam,
  type LocalRelation,
} from "./allegiance";
import { explode } from "./explosions";
import { localWizardId } from "./localWizard";
import { SingularitySeed } from "./singularity";

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
  /** Who cast it — carried into its explosion (death credit, and whether it
   * may hurt the local wizard) and, for seeds, whose Collapse activates it. */
  source: DamageSource;
  /** Rapier interaction groups, decided ONCE at fire time from the caster's
   * relation to us (allegiance.ts#PROJECTILE_GROUPS): a pact that forms or
   * breaks mid-flight doesn't retarget bolts already in the air. */
  collisionGroups: number;
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
  /** A void seed: plants instead of exploding, and collapses into a black hole
   * when the staff's Collapse ability activates it. */
  singularity: boolean;
  /** Replayed peer/replicated projectile: explosion skips entity damage. */
  cosmetic: boolean;
}

export interface FireOptions {
  team: DamageTeam;
  /** Our casts: wizardSource(localWizardId()); replayed peer casts:
   * wizardSource(casterId); monster bolts ENEMY_SOURCE; trap darts WORLD_SOURCE. */
  source: DamageSource;
  position: [number, number, number];
  velocity: [number, number, number];
  damage: number;
  blastRadius?: number;
  blastImpulse?: number;
  color?: string;
  size?: number;
  gravityScale?: number;
  homing?: number;
  singularity?: boolean;
  cosmetic?: boolean;
}

const MAX_LIVE = 80;
let nextProjectileId = 1;
let enqueue: ((spec: ProjectileSpec) => void) | null = null;

/** One pre-built mask per relation — interactionGroups packs bits, so build
 * each once instead of on every shot. */
function groupsMask(relation: LocalRelation): number {
  const g = PROJECTILE_GROUPS[relation];
  return interactionGroups([...g.membership], [...g.filter]);
}
const COLLISION_MASKS: Readonly<Record<LocalRelation, number>> = {
  own: groupsMask("own"),
  ally: groupsMask("ally"),
  hostile: groupsMask("hostile"),
  dungeon: groupsMask("dungeon"),
};

// Dev-only hook for end-to-end tests (mirrors __game / __spawnEnemy). Scripts
// may omit `source`; it defaults by team, like explode() does.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__fireProjectile = (
    o: Omit<FireOptions, "source"> & { source?: DamageSource },
  ) => fireProjectile({ ...o, source: o.source ?? defaultSource(o.team, localWizardId()) });
}

export function fireProjectile(opts: FireOptions): void {
  if (!enqueue) return;
  const relation = relationToLocal(opts.team, opts.source, localWizardId(), isHostileWizard);
  enqueue({
    id: nextProjectileId++,
    team: opts.team,
    source: opts.source,
    collisionGroups: COLLISION_MASKS[relation],
    position: opts.position,
    velocity: opts.velocity,
    damage: opts.damage,
    blastRadius: opts.blastRadius ?? 1.7,
    blastImpulse: opts.blastImpulse ?? 9,
    color: opts.color ?? "#7fd4ff",
    size: opts.size ?? 0.13,
    gravityScale: opts.gravityScale ?? 0,
    homing: opts.homing ?? 0,
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
  /** Where the bolt was last frame — the trail is laid along the segment
   * between, so it stays continuous at any speed or frame rate. */
  const prev = useRef({ x: spec.position[0], y: spec.position[1], z: spec.position[2] });
  const light = useRef<DynamicLightSource | null>(null);

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
      source: spec.source,
      color: spec.color,
      particles: 14,
      light: 14,
      remote: spec.cosmetic,
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
    const timeout = setTimeout(detonate, 3200);
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

    const t = b.translation();
    boltTrailFx(prev.current, t, spec.color, spec.size);
    prev.current.x = t.x;
    prev.current.y = t.y;
    prev.current.z = t.z;
  });

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
        collisionGroups={spec.collisionGroups}
        mass={0.05}
      />
      <mesh geometry={boltGeometry} material={boltMaterial(spec.color)} scale={spec.size} />
    </RigidBody>
  );
}
