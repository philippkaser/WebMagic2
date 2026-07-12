import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  interactionGroups,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { playHit } from "../audio/sound";
import { floorScale, GROUPS, PLAYER } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { allocId, registerHittable } from "../game/registry";
import { nearestWizardTo } from "../game/targets";
import { GOLD_DROPS } from "../items/economy";
import { dropGold, dropLoot } from "../items/LootOrbs";
import { isHost } from "../net/netStore";
import { useNetBody, type NetBody } from "../net/NetSystems";
import { combatActive, getStats, useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { sanitizeHit, type HitData } from "./damage";
import { getEnemyStats } from "./enemyStats";
import { enemyCast } from "./remoteEffects";

const ENEMY_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

const LOOT_DROP_CHANCE = 0.24;

/** Shared enemy networking: registers the entity with the replication
 * framework (snapshots, interpolation, late-join and migration are all
 * automatic) and wires the hittable so damage routes to the authority.
 * Keeps Wisp/Sentry/Boss focused on their behavior. */
export function useEnemyNet(opts: {
  entityId: string;
  body: React.RefObject<RapierRigidBody | null>;
  hp: React.MutableRefObject<number>;
  deadRef: React.MutableRefObject<boolean>;
  flash: React.MutableRefObject<number>;
  dead: boolean;
  /** Sentries never move — replicate hp only. */
  immobile?: boolean;
  knockTimer?: React.MutableRefObject<number>;
  /** Fraction of knockback impulses that actually applies (bosses resist). */
  knockbackScale?: number;
  /** silent = late-join catch-up: apply the death without VFX. */
  onKill: (silent?: boolean) => void;
  hitFeedback?: () => void;
  /** Authority: damage landed (from anyone) — wake up and fight back. */
  onDamaged?: () => void;
  /** Replica: authoritative hp arrived (e.g. boss HP bar). */
  onHp?: (hp: number) => void;
}): NetBody {
  const {
    entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    immobile,
    knockTimer,
    knockbackScale = 1,
    onKill,
    hitFeedback,
    onDamaged,
    onHp,
  } = opts;

  const netRef = useRef<NetBody | null>(null);

  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }) => {
      if (deadRef.current) return;
      hp.current -= damage;
      flash.current = 1;
      if (knockTimer) knockTimer.current = 0.4;
      body.current?.applyImpulse(
        {
          x: impulse.x * knockbackScale,
          y: impulse.y * knockbackScale,
          z: impulse.z * knockbackScale,
        },
        true,
      );
      onHp?.(hp.current);
      onDamaged?.();
      if (hp.current <= 0) {
        onKill();
        netRef.current?.despawn();
      }
    },
    [body, deadRef, flash, hp, knockTimer, knockbackScale, onKill, onDamaged, onHp],
  );

  const net = useNetBody({
    id: entityId,
    body,
    immobile,
    enabled: !dead,
    fields: () => ({ hp: hp.current }),
    onFields: (f) => {
      if (f.hp !== undefined) {
        hp.current = f.hp;
        onHp?.(f.hp);
      }
    },
    onCommand: (cmd, data) => {
      if (cmd === "hit") {
        const d = sanitizeHit(data);
        if (d) applyDamage(d.damage, d.impulse);
      }
    },
    onDespawn: (_data, catchup) => onKill(catchup),
  });
  netRef.current = net;

  useEffect(() => {
    if (dead) return;
    return registerHittable({
      id: allocId(),
      team: "enemy",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        flash.current = 1;
        playHit();
        hitFeedback?.();
        // Shooter-favored: our shots apply where we saw them land — locally
        // on the authority, via a command to it otherwise (with the physical
        // knockback predicted immediately, so the reaction never waits on
        // the round trip).
        if (isHost()) {
          applyDamage(damage, impulse);
        } else {
          netRef.current?.command("hit", { damage, impulse } satisfies HitData);
          netRef.current?.predictImpulse(impulse, knockbackScale);
        }
      },
    });
  }, [dead, applyDamage, body, deadRef, flash, hitFeedback]);

  return net;
}

/** Wisp — a floating mote of hostile magic. Chases the nearest wizard and
 * burns on contact. The floor authority runs its AI; replicas are driven by
 * the replication framework. */
export function Wisp({
  position,
  floor,
  entityId,
}: {
  position: Vec3;
  floor: number;
  entityId: string;
}) {
  const body = useRef<RapierRigidBody>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(getEnemyStats("wisp").baseHealth * scale.enemyHealth);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const aggro = useRef(false);
  const knockTimer = useRef(0);
  const contactTimer = useRef(0);
  const flash = useRef(0);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const desired = useMemo(() => new Vector3(), []);

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        spawnBurst({
          position: [t.x, t.y, t.z],
          count: 30,
          color: ["#b46bff", "#ffffff", "#4a2a7a"],
          speed: 7,
          ttl: 0.8,
          size: 0.1,
        });
        flashLight([t.x, t.y, t.z], "#b46bff", 22);
        dropLoot([t.x, Math.max(t.y, 0.6), t.z], floor, LOOT_DROP_CHANCE);
        dropGold([t.x, Math.max(t.y, 0.6), t.z], floor, GOLD_DROPS.enemyChance, "enemy");
      }
      setDead(true);
    },
    [floor, position],
  );

  const hitFeedback = useCallback(() => {
    const t = body.current?.translation();
    if (!t) return;
    spawnBurst({
      position: [t.x, t.y, t.z],
      count: 6,
      color: "#d9a9ff",
      speed: 3,
      ttl: 0.4,
      size: 0.06,
    });
  }, []);

  const onDamaged = useCallback(() => {
    aggro.current = true; // getting shot wakes it, no matter who shot
  }, []);

  const net = useEnemyNet({
    entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    knockTimer,
    onKill: kill,
    hitFeedback,
    onDamaged,
  });

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (!combatActive()) return;

    flash.current = Math.max(0, flash.current - dt * 5);
    if (mat.current) mat.current.emissiveIntensity = 1.7 + flash.current * 6;
    contactTimer.current -= dt;

    const t = b.translation();
    const dx = playerPosition.x - t.x;
    const dy = playerPosition.y - t.y;
    const dz = playerPosition.z - t.z;
    const dist = Math.hypot(dx, dy, dz);

    // Contact burn is local on every client — your health is yours.
    if (dist < 1.45 && contactTimer.current <= 0) {
      contactTimer.current = PLAYER.contactDamageCooldown;
      useGame.getState().takeDamage(9 * scale.enemyDamage);
      spawnBurst({
        position: [playerPosition.x, playerPosition.y + 0.3, playerPosition.z],
        count: 12,
        color: ["#ff5d5d", "#b46bff"],
        speed: 4,
        ttl: 0.5,
        size: 0.08,
      });
      const push = 5 / Math.max(dist, 0.4);
      getPlayerBody()?.applyImpulse({ x: dx * push * 0.35, y: 2, z: dz * push * 0.35 }, true);
    }

    // Replicas are driven by the net layer; only the authority thinks.
    if (!net.isAuthority) return;

    // ── Authority AI: threaten the NEAREST wizard on the floor ──────────────
    const target = nearestWizardTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current) {
      if (target.dist < 15 * getStats().aggroMult) aggro.current = true;
      b.setLinvel({ x: 0, y: Math.sin(clock.elapsedTime * 1.4 + phase) * 0.5, z: 0 }, true);
      return;
    }
    if (knockTimer.current <= 0) {
      const targetY = target.pos.y + 0.5 + Math.sin(clock.elapsedTime * 2.1 + phase) * 0.4;
      desired.set(target.pos.x - t.x, 0, target.pos.z - t.z);
      if (desired.lengthSq() > 0.01) desired.normalize();
      desired.multiplyScalar(4.3 + floor * 0.07);
      desired.y = Math.max(-3.5, Math.min(3.5, (targetY - t.y) * 2.4));
      const v = b.linvel();
      const k = 1 - Math.exp(-2.8 * dt);
      b.setLinvel(
        {
          x: v.x + (desired.x - v.x) * k,
          y: v.y + (desired.y - v.y) * k,
          z: v.z + (desired.z - v.z) * k,
        },
        true,
      );
    }
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={net.bodyType}
      colliders={false}
      gravityScale={0}
      linearDamping={0.5}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[0.42]} mass={2} collisionGroups={ENEMY_GROUPS} />
      <mesh castShadow>
        <icosahedronGeometry args={[0.42, 0]} />
        <meshStandardMaterial
          ref={mat}
          color="#160d26"
          emissive="#b46bff"
          emissiveIntensity={1.7}
          flatShading
          roughness={0.4}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color="#000" emissive="#f0dcff" emissiveIntensity={4} toneMapped={false} />
      </mesh>
    </RigidBody>
  );
}

/** Sentry — a fixed warding crystal that lobs slow, dodgeable fire bolts when
 * it has line of sight. The authority decides when it fires; the shot itself
 * is an authoritative host event replayed everywhere. */
export function Sentry({
  position,
  floor,
  entityId,
}: {
  position: Vec3;
  floor: number;
  entityId: string;
}) {
  const body = useRef<RapierRigidBody>(null);
  const head = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const { world, rapier } = useRapier();
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(getEnemyStats("sentry").baseHealth * scale.enemyHealth);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const fireTimer = useRef(2 + Math.random() * 1.5);
  const flash = useRef(0);
  const aim = useMemo(() => new Vector3(), []);
  const losRay = useMemo(
    () => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    [rapier],
  );

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        spawnBurst({
          position: [t.x, t.y + 0.8, t.z],
          count: 36,
          color: ["#ff7a4d", "#ffd9a8", "#3a2418"],
          speed: 6.5,
          ttl: 0.9,
          size: 0.11,
        });
        flashLight([t.x, t.y + 0.8, t.z], "#ff7a4d", 26);
        dropLoot([t.x, t.y + 0.5, t.z], floor, LOOT_DROP_CHANCE);
        dropGold([t.x, t.y + 0.5, t.z], floor, GOLD_DROPS.enemyChance, "enemy");
      }
      setDead(true);
    },
    [floor, position],
  );

  const net = useEnemyNet({ entityId, body, hp, deadRef, flash, dead, immobile: true, onKill: kill });

  useFrame((_, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (!combatActive()) return;

    flash.current = Math.max(0, flash.current - dt * 5);
    const t = b.translation();
    const headPos = { x: t.x, y: t.y + 1.05, z: t.z };

    // Head tracking is cosmetic — every client tracks its own player.
    aim.set(playerPosition.x - headPos.x, playerPosition.y - headPos.y, playerPosition.z - headPos.z);
    if (head.current && aim.length() < 30) {
      const targetYaw = Math.atan2(aim.x, aim.z);
      head.current.rotation.y += (targetYaw - head.current.rotation.y) * Math.min(1, dt * 4);
    }

    if (!net.isAuthority) {
      if (mat.current) mat.current.emissiveIntensity = 1.4 + flash.current * 6;
      return;
    }

    fireTimer.current -= dt;
    const charging = fireTimer.current < 0.55;
    if (mat.current) {
      mat.current.emissiveIntensity =
        1.4 + flash.current * 6 + (charging ? (0.55 - Math.max(fireTimer.current, 0)) * 7 : 0);
    }

    if (fireTimer.current <= 0) {
      fireTimer.current = Math.max(1.4, 2.5 - floor * 0.04);
      // Fire at the nearest wizard on the floor, leading their motion —
      // peer poses carry velocity, so everyone gets led equally.
      const target = nearestWizardTo(headPos.x, headPos.y, headPos.z);
      const dist = target.dist;
      if (dist > 26) return;
      aim.set(target.pos.x - headPos.x, target.pos.y - headPos.y, target.pos.z - headPos.z).normalize();
      losRay.origin.x = headPos.x;
      losRay.origin.y = headPos.y;
      losRay.origin.z = headPos.z;
      losRay.dir.x = aim.x;
      losRay.dir.y = aim.y;
      losRay.dir.z = aim.z;
      const hit = world.castRay(losRay, dist - 0.6, true, undefined, undefined, undefined, b);
      if (hit !== null) return; // wall or prop in the way
      const speed = 15;
      aim.multiplyScalar(dist);
      aim.addScaledVector(target.vel, Math.min(dist / speed, 1.2) * 0.45);
      aim.normalize().multiplyScalar(speed);
      const origin: Vec3 = [
        headPos.x + aim.x * 0.06,
        headPos.y + aim.y * 0.06,
        headPos.z + aim.z * 0.06,
      ];
      enemyCast.announce({
        origin,
        velocity: [aim.x, aim.y, aim.z],
        damage: 11 * scale.enemyDamage,
        color: "#ff5136",
        size: 0.16,
        blastRadius: 1.9,
        blastImpulse: 11,
      });
      flashLight([headPos.x, headPos.y, headPos.z], "#ff5136", 10);
    }
  });

  if (dead) return null;
  return (
    <RigidBody ref={body} position={position} type="fixed" colliders={false}>
      <CuboidCollider args={[0.42, 0.55, 0.42]} position={[0, 0.55, 0]} collisionGroups={ENEMY_GROUPS} />
      {/* Base plinth */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.8, 0.9, 0.8]} />
        <meshStandardMaterial color="#3a3442" roughness={0.9} />
      </mesh>
      <group ref={head} position={[0, 1.05, 0]}>
        <mesh castShadow>
          <octahedronGeometry args={[0.34]} />
          <meshStandardMaterial
            ref={mat}
            color="#1c0c08"
            emissive="#ff5136"
            emissiveIntensity={1.4}
            flatShading
            roughness={0.3}
          />
        </mesh>
      </group>
    </RigidBody>
  );
}

/** Shadow — a lurking stalker. Instead of the wisp's straight chase it plays
 * keep-away: prowls a ring around its target, then darts in for a strike and
 * recoils back into the dark. Floats like the wisp; the authority runs its
 * stalk→lunge→recoil brain, replicas are driven by the net layer. */
export function Shadow({
  position,
  floor,
  entityId,
}: {
  position: Vec3;
  floor: number;
  entityId: string;
}) {
  const body = useRef<RapierRigidBody>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(getEnemyStats("shadow").baseHealth * scale.enemyHealth);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const aggro = useRef(false);
  const knockTimer = useRef(0);
  const contactTimer = useRef(0);
  const flash = useRef(0);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const desired = useMemo(() => new Vector3(), []);
  // Lurk state machine: stalk (prowl the ring) → lunge (dash in) → recoil.
  const mode = useRef<"stalk" | "lunge" | "recoil">("stalk");
  const modeTimer = useRef(0);
  const lungeTimer = useRef(2 + Math.random() * 2);
  // Fixed orbit direction so a given shadow prowls one way, not jittering.
  const spin = useMemo(() => (Math.random() < 0.5 ? 1 : -1), []);

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        spawnBurst({
          position: [t.x, t.y, t.z],
          count: 26,
          color: ["#2a1a44", "#6a3d9a", "#050208"],
          speed: 6,
          ttl: 0.8,
          size: 0.1,
        });
        flashLight([t.x, t.y, t.z], "#6a3d9a", 18);
        dropLoot([t.x, Math.max(t.y, 0.6), t.z], floor, LOOT_DROP_CHANCE);
        dropGold([t.x, Math.max(t.y, 0.6), t.z], floor, GOLD_DROPS.enemyChance, "enemy");
      }
      setDead(true);
    },
    [floor, position],
  );

  const hitFeedback = useCallback(() => {
    const t = body.current?.translation();
    if (!t) return;
    spawnBurst({ position: [t.x, t.y, t.z], count: 6, color: "#8a5cc0", speed: 3, ttl: 0.4, size: 0.06 });
  }, []);

  const onDamaged = useCallback(() => {
    aggro.current = true;
  }, []);

  const net = useEnemyNet({
    entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    knockTimer,
    onKill: kill,
    hitFeedback,
    onDamaged,
  });

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (!combatActive()) return;

    flash.current = Math.max(0, flash.current - dt * 5);
    if (mat.current) {
      mat.current.emissiveIntensity = 0.8 + flash.current * 6;
      mat.current.opacity = mode.current === "lunge" ? 0.95 : 0.55;
    }
    contactTimer.current -= dt;

    const t = b.translation();
    const dx = playerPosition.x - t.x;
    const dy = playerPosition.y - t.y;
    const dz = playerPosition.z - t.z;
    const dist = Math.hypot(dx, dy, dz);

    // Contact strike — lands mostly on a lunge; local, like the wisp's burn.
    if (dist < 1.5 && contactTimer.current <= 0) {
      contactTimer.current = PLAYER.contactDamageCooldown;
      useGame.getState().takeDamage(12 * scale.enemyDamage);
      spawnBurst({
        position: [playerPosition.x, playerPosition.y + 0.3, playerPosition.z],
        count: 12,
        color: ["#2a1a44", "#6a3d9a"],
        speed: 4,
        ttl: 0.5,
        size: 0.08,
      });
      const push = 5 / Math.max(dist, 0.4);
      getPlayerBody()?.applyImpulse({ x: dx * push * 0.3, y: 1.5, z: dz * push * 0.3 }, true);
    }

    // Replicas are driven by the net layer; only the authority thinks.
    if (!net.isAuthority) return;

    const target = nearestWizardTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current) {
      if (target.dist < 15 * getStats().aggroMult) aggro.current = true;
      b.setLinvel({ x: 0, y: Math.sin(clock.elapsedTime * 1.2 + phase) * 0.4, z: 0 }, true);
      return;
    }
    if (knockTimer.current > 0) return;

    // Planar unit vector toward the target, plus its perpendicular (for orbit).
    const px = target.pos.x - t.x;
    const pz = target.pos.z - t.z;
    const planar = Math.hypot(px, pz) || 1;
    const nx = px / planar;
    const nz = pz / planar;
    const targetY = target.pos.y + 0.3 + Math.sin(clock.elapsedTime * 1.8 + phase) * 0.3;
    const LURK = 6;

    modeTimer.current -= dt;
    if (mode.current === "stalk") {
      lungeTimer.current -= dt;
      // Radial term closes/opens toward the lurk ring; tangential term prowls
      // around it. Clamp the radial pull so it eases onto the ring.
      const radial = Math.max(-1, Math.min(1, (target.dist - LURK) * 0.5));
      const speed = 2.4 + floor * 0.03;
      desired.set(nx * radial + -nz * spin * 0.7, 0, nz * radial + nx * spin * 0.7);
      if (desired.lengthSq() > 1e-4) desired.normalize().multiplyScalar(speed);
      desired.y = Math.max(-3, Math.min(3, (targetY - t.y) * 2));
      if (lungeTimer.current <= 0 && target.dist < 10) {
        mode.current = "lunge";
        modeTimer.current = 0.55;
      }
    } else if (mode.current === "lunge") {
      const speed = 11 + floor * 0.12;
      desired.set(nx * speed, Math.max(-3, Math.min(3, (targetY - t.y) * 2)), nz * speed);
      if (modeTimer.current <= 0) {
        mode.current = "recoil";
        modeTimer.current = 0.45;
      }
    } else {
      // recoil — shrink back into the dark before prowling again
      desired.set(-nx * 6, 0, -nz * 6);
      if (modeTimer.current <= 0) {
        mode.current = "stalk";
        lungeTimer.current = 2 + Math.random() * 2;
      }
    }

    const v = b.linvel();
    const k = 1 - Math.exp(-(mode.current === "lunge" ? 6 : 3) * dt);
    b.setLinvel(
      { x: v.x + (desired.x - v.x) * k, y: v.y + (desired.y - v.y) * k, z: v.z + (desired.z - v.z) * k },
      true,
    );
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={net.bodyType}
      colliders={false}
      gravityScale={0}
      linearDamping={0.6}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[0.44]} mass={2} collisionGroups={ENEMY_GROUPS} />
      <mesh castShadow>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial
          ref={mat}
          color="#0a0616"
          emissive="#5a2d8a"
          emissiveIntensity={0.8}
          flatShading
          roughness={0.6}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* Two faint eyes peering out of the murk. */}
      {([0.13, -0.13] as const).map((x) => (
        <mesh key={x} position={[x, 0.06, 0.34]}>
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshStandardMaterial color="#000" emissive="#c89cff" emissiveIntensity={3} toneMapped={false} />
        </mesh>
      ))}
    </RigidBody>
  );
}
