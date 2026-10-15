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
import { playRicochet } from "../audio/spellSounds";
import { GROUPS } from "../core/config";
import { hitSparksFx } from "../fx/effects";
import { lightningFx, ricochetFx } from "../fx/spellFx";
import { forEachHittable, type Hittable, type Vec3Tuple } from "../game/registry";
import { hitWeight } from "./castFeel";
import { explode } from "./explosions";
import { chainPath, lightningPoints, sweptHits, type HitTarget } from "./hitscan";
import { burstOn, land, weakOf } from "./land";
import { localWizardId } from "./localWizard";
import { critMult, onAimLine, pathCrit, sweptCrit, type WeakSpot } from "./precision";
import { reportLocalHit } from "./procs";
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
  /** Ricochets left: walls bounce it instead of bursting it (mods). */
  bounces: number;
  /** Creatures it may pass through (and hurt) before it bursts. */
  pierce: number;
  /** Shards it bursts into where it lands. */
  splitShards: number;
  /** Creatures its landing arcs on to. */
  chain: number;
  /** Fired by a legendary power — its hits don't roll powers again. */
  noProc: boolean;
  /** How heavy its hits land, 0…1 (weapons/castFeel hitWeight). */
  weight: number;
  /** The local wizard's own magic, landing for real (not a replay): its
   * hits confirm, pop numbers and catch the frame. */
  mine: boolean;
  /** From the bolt's line across to the crosshair's (castKinds), or null:
   * its precision hits are judged on where it was aimed. */
  aimOffset: [number, number, number] | null;
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
  bounces?: number;
  pierce?: number;
  splitShards?: number;
  chain?: number;
  noProc?: boolean;
  /** How heavy its hits land (default: judged from `damage`). */
  weight?: number;
  /** Our own aimed bolts: the crosshair's line, beside the bolt's. */
  aimOffset?: [number, number, number];
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
/** A piercing bolt flies through creatures (it finds them itself, by a
 * swept test each frame) — so its body ignores them. */
const PIERCING_MASKS: Readonly<Record<LocalRelation, number>> = {
  own: piercingMask("own"),
  ally: piercingMask("ally"),
  hostile: piercingMask("hostile"),
  dungeon: piercingMask("dungeon"),
};
function piercingMask(relation: LocalRelation): number {
  const g = PROJECTILE_GROUPS[relation];
  return interactionGroups([...g.membership], g.filter.filter((f) => f !== GROUPS.ENEMY));
}

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
  const pierce = opts.team === "player" ? Math.max(0, Math.round(opts.pierce ?? 0)) : 0;
  enqueue({
    id: nextProjectileId++,
    team: opts.team,
    source: opts.source,
    collisionGroups: (pierce > 0 ? PIERCING_MASKS : COLLISION_MASKS)[relation],
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
    bounces: Math.max(0, Math.round(opts.bounces ?? 0)),
    pierce,
    splitShards: Math.max(0, Math.round(opts.splitShards ?? 0)),
    chain: Math.max(0, Math.round(opts.chain ?? 0)),
    noProc: opts.noProc ?? false,
    weight: opts.weight ?? hitWeight(opts.damage),
    mine: !opts.cosmetic && relation === "own",
    aimOffset: opts.aimOffset ?? null,
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

/** A piercing bolt's pass deals this share of its damage to each creature
 * it goes through (the burst at the end deals the rest as usual). */
const PIERCE_SHARE = 0.85;
/** Shards: share of the parent's damage each, and how fast they fly. */
const SHARD_SHARE = 0.35;
const SHARD_SPEED = 17;
/** An arcing landing: share of damage per leap, and how far it reaches. */
const ARC_SHARE = 0.45;
const ARC_RANGE = 6;

function creatureTargets(): HitTarget<Hittable>[] {
  const out: HitTarget<Hittable>[] = [];
  forEachHittable((h) => {
    if (h.team !== "enemy") return;
    out.push({ pos: h.getPosition(), radius: h.radius ?? 0.5, ref: h });
  });
  return out;
}

function Bolt({ spec, remove }: { spec: ProjectileSpec; remove: (id: number) => void }) {
  const body = useRef<RapierRigidBody>(null);
  const detonated = useRef(false);
  /** Where the bolt was last frame — the trail is laid along the segment
   * between, so it stays continuous at any speed or frame rate. */
  const prev = useRef({ x: spec.position[0], y: spec.position[1], z: spec.position[2] });
  const light = useRef<DynamicLightSource | null>(null);
  const bounces = useRef(spec.bounces);
  const pierce = useRef(spec.pierce);
  const struck = useRef(new Set<Hittable>());
  /** The crosshair's line beside the bolt's (spec.aimOffset) — only while
   * the bolt flies the line it was aimed along. A wall that turns it or
   * homing that bends it drops it: from then on it's judged on its own. */
  const aimed = useRef(spec.aimOffset);
  const speed = useRef(Math.hypot(spec.velocity[0], spec.velocity[1], spec.velocity[2]));

  /** Burst where it is — on `on`, if it burst on a creature or a crate:
   * that body takes the full blow, a precision one if the bolt was flying
   * through its weak point. */
  const detonate = useCallback(
    (on?: Hittable | null) => {
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
        noProc: spec.noProc,
        weight: spec.weight,
        direct: on && !spec.cosmetic ? { target: on, crit: boltCrit(on, at, prev.current, b, spec.size, aimed.current) } : undefined,
      });
      if (spec.team === "player") {
        if (spec.splitShards > 0) splinter(spec, at, b);
        if (spec.chain > 0) arc(spec, at, struck.current);
      }
      remove(spec.id);
    },
    [remove, spec],
  );

  /** Walls ricochet a bolt with bounces left; anything else bursts it —
   * a sentry too, though it's as rooted as a wall. A creature it already
   * pierced isn't what it burst on (land.ts#burstOn). */
  const onContact = useCallback(
    (other: { rigidBody?: { isFixed(): boolean; translation(): Vec3Tuple } | null }) => {
      const t = body.current?.translation();
      const on =
        spec.team === "player" && t ? burstOn(other.rigidBody?.translation() ?? null, t, spec.size + 0.05, struck.current) : null;
      if (bounces.current > 0 && other.rigidBody?.isFixed() && !on) {
        bounces.current--;
        aimed.current = null;
        if (t) {
          ricochetFx(t, spec.color);
          playRicochet([t.x, t.y, t.z]);
        }
        return;
      }
      detonate(on);
    },
    [detonate, spec.color, spec.size, spec.team],
  );

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
    // Ricocheting bolts live a little longer: they take the long way round.
    const timeout = setTimeout(detonate, 3200 + spec.bounces * 900);
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
          aimed.current = null;
        }
      }
    }

    // A ricochet keeps its pace: a weightless bolt never loses speed off a
    // wall (the solver's restitution is close, not exact).
    if (spec.bounces > 0 && spec.gravityScale === 0) {
      const v = b.linvel();
      const s = Math.hypot(v.x, v.y, v.z);
      if (s > 0.1 && Math.abs(s - speed.current) > 0.5) {
        const k = speed.current / s;
        b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      }
    }

    const t = b.translation();
    // Piercing: hurt every creature the bolt passed through this frame; the
    // first one past its pierce count bursts it.
    if (spec.pierce > 0) {
      for (const target of sweptHits(prev.current, t, spec.size, creatureTargets())) {
        const h = target.ref;
        if (struck.current.has(h)) continue;
        struck.current.add(h);
        if (pierce.current <= 0) {
          detonate(h);
          return;
        }
        pierce.current--;
        hitSparksFx(target.pos, spec.color, 0.8);
        if (!spec.cosmetic) {
          const k = spec.blastImpulse * 0.4;
          const v = b.linvel();
          const vl = Math.hypot(v.x, v.y, v.z) || 1;
          const spot = weakOf(h);
          const crit =
            spot && sweptCrit(onAimLine(prev.current, aimed.current, sweepA), onAimLine(t, aimed.current, sweepB), spot, spec.size)
              ? spot
              : null;
          const dmg = spec.damage * PIERCE_SHARE * (crit ? critMult(crit) : 1);
          const at: [number, number, number] = [target.pos.x, target.pos.y, target.pos.z];
          land(h, dmg, { x: (v.x / vl) * k, y: k * 0.3, z: (v.z / vl) * k }, { mine: spec.mine, at, crit: crit !== null }, spec.weight);
          if (!spec.noProc) reportLocalHit(target.pos, dmg);
        }
      }
    }

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
      onCollisionEnter={(payload) => onContact(payload.other)}
    >
      <BallCollider
        args={[spec.size]}
        collisionGroups={spec.collisionGroups}
        mass={0.05}
        restitution={spec.bounces > 0 ? 1 : 0}
        friction={spec.bounces > 0 ? 0 : 0.5}
      />
      <mesh geometry={boltGeometry} material={boltMaterial(spec.color)} scale={spec.size} />
    </RigidBody>
  );
}

/** Splintering: the bolt bursts into shards that fly back out of what it
 * hit, each a small bolt of its own (no further splintering). */
function splinter(spec: ProjectileSpec, at: [number, number, number], b: RapierRigidBody | null): void {
  const v = b?.linvel() ?? { x: spec.velocity[0], y: spec.velocity[1], z: spec.velocity[2] };
  const vl = Math.hypot(v.x, v.y, v.z) || 1;
  for (let i = 0; i < Math.min(spec.splitShards, 8); i++) {
    // Back the way it came, fanned wide, a little up.
    const a = Math.random() * Math.PI * 2;
    const dx = -v.x / vl + Math.cos(a) * 0.9;
    const dy = 0.35 + Math.random() * 0.5;
    const dz = -v.z / vl + Math.sin(a) * 0.9;
    const dl = Math.hypot(dx, dy, dz) || 1;
    fireProjectile({
      team: spec.team,
      source: spec.source,
      position: [at[0] - (v.x / vl) * 0.25, at[1] + 0.05, at[2] - (v.z / vl) * 0.25],
      velocity: [(dx / dl) * SHARD_SPEED, (dy / dl) * SHARD_SPEED, (dz / dl) * SHARD_SPEED],
      damage: spec.damage * SHARD_SHARE,
      color: spec.color,
      size: Math.max(0.05, spec.size * 0.55),
      gravityScale: 0.5,
      blastRadius: Math.max(0.8, spec.blastRadius * 0.5),
      blastImpulse: spec.blastImpulse * 0.4,
      cosmetic: spec.cosmetic,
      noProc: spec.noProc,
      weight: spec.weight * SHARD_SHARE,
    });
  }
}

const flight = { x: 0, y: 0, z: 0 };
/** Where a burst is judged from, moved onto the crosshair's line. */
const judgedAt = { x: 0, y: 0, z: 0 };
/** A piercing pass's sweep, moved onto the crosshair's line. */
const sweepA = { x: 0, y: 0, z: 0 };
const sweepB = { x: 0, y: 0, z: 0 };

/** The weak point a bolt that burst on `h` at `at` was flying through, or
 * null. Its line is the way it came this frame (from `from`), followed as
 * deep as the body goes — moved across onto the crosshair's line
 * (`aimOffset`) for a bolt still flying where it was aimed, so a precision
 * hit is where you aimed. */
function boltCrit(
  h: Hittable,
  at: [number, number, number],
  from: { x: number; y: number; z: number },
  b: RapierRigidBody | null,
  size: number,
  aimOffset: [number, number, number] | null,
): WeakSpot | null {
  const spot = weakOf(h);
  if (!spot) return null;
  flight.x = at[0] - from.x;
  flight.y = at[1] - from.y;
  flight.z = at[2] - from.z;
  let len = Math.hypot(flight.x, flight.y, flight.z);
  if (len < 1e-3 && b) {
    // It barely moved this frame: go by its velocity instead.
    const v = b.linvel();
    flight.x = v.x;
    flight.y = v.y;
    flight.z = v.z;
    len = Math.hypot(v.x, v.y, v.z);
  }
  if (len < 1e-6) return null;
  flight.x /= len;
  flight.y /= len;
  flight.z /= len;
  const p = onAimLine({ x: at[0], y: at[1], z: at[2] }, aimOffset, judgedAt);
  return pathCrit(p, flight, spot, size, h.radius ?? 0.5) ? spot : null;
}

/** Arcing: the landing leaps on to the nearest creatures nearby. */
function arc(spec: ProjectileSpec, at: [number, number, number], already: Set<Hittable>): void {
  const targets = creatureTargets().filter((t) => !already.has(t.ref));
  const origin: HitTarget<Hittable | null> = { pos: { x: at[0], y: at[1], z: at[2] }, radius: 0, ref: null };
  const path = chainPath<Hittable | null>(origin, targets, spec.chain, ARC_RANGE);
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!.pos;
    const to = path[i]!;
    lightningFx(lightningPoints(from, to.pos, 6, 0.35), spec.color);
    if (!spec.cosmetic && to.ref) {
      const damage = spec.damage * ARC_SHARE;
      land(to.ref, damage, { x: 0, y: 2, z: 0 }, { mine: spec.mine, at: [to.pos.x, to.pos.y, to.pos.z] }, spec.weight * ARC_SHARE);
      if (!spec.noProc) reportLocalHit(to.pos, damage);
    }
  }
}
