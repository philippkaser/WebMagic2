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
import { Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
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
import { spawnEnemy } from "./spawnedEnemyStore";

const ENEMY_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

const LOOT_DROP_CHANCE = 0.24;

/** Smoothly yaw a cosmetic group toward the local player. Enemy bodies keep
 * their rotations locked for physics, so "facing" is pure presentation: each
 * client turns the eyes/maw toward its own wizard. */
function facePlayer(g: Group | null, dx: number, dz: number, dt: number): void {
  if (!g) return;
  const target = Math.atan2(dx, dz);
  let d = target - g.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  g.rotation.y += d * Math.min(1, dt * 6);
}

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
  const face = useRef<Group>(null);
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
    facePlayer(face.current, dx, dz, dt);

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
      {/* A lidless eye torn loose from something bigger — it looks AT you. */}
      <group ref={face}>
        <mesh castShadow>
          <icosahedronGeometry args={[0.4, 1]} />
          <meshStandardMaterial
            ref={mat}
            color="#241430"
            emissive="#b46bff"
            emissiveIntensity={1.7}
            flatShading
            roughness={0.55}
          />
        </mesh>
        {/* Iris and pupil, aimed out the front of the eye. */}
        <mesh position={[0, 0, 0.3]}>
          <sphereGeometry args={[0.17, 8, 6]} />
          <meshStandardMaterial color="#000" emissive="#f0dcff" emissiveIntensity={4} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.43]}>
          <sphereGeometry args={[0.075, 6, 5]} />
          <meshStandardMaterial color="#050308" roughness={0.3} />
        </mesh>
        {/* Torn optic tendrils trailing behind. */}
        {[-0.35, 0, 0.4].map((a, i) => (
          <mesh
            key={i}
            position={[Math.sin(a) * 0.14, -0.06 + i * 0.09, -0.38]}
            rotation={[-1.35 + i * 0.18, 0, a]}
          >
            <coneGeometry args={[0.05 - i * 0.01, 0.34, 4]} />
            <meshStandardMaterial color="#4a2a5a" roughness={0.8} flatShading />
          </mesh>
        ))}
      </group>
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
      {/* A spine planted in the floor, vertebra on vertebra. */}
      {[0.12, 0.38, 0.62, 0.84].map((y, i) => (
        <mesh key={i} position={[(i % 2) * 0.03 - 0.015, y, 0]} castShadow>
          <cylinderGeometry args={[0.16 - i * 0.02, 0.19 - i * 0.02, 0.16, 6]} />
          <meshStandardMaterial color="#a89878" roughness={0.8} flatShading />
        </mesh>
      ))}
      {/* Broken ribs still clinging on. */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={side}
          position={[side * 0.24, 0.5, 0.05]}
          rotation={[0.2, 0, side * 2.1]}
          castShadow
        >
          <coneGeometry args={[0.045, 0.5, 4]} />
          <meshStandardMaterial color="#988868" roughness={0.85} flatShading />
        </mesh>
      ))}
      {/* The skull that watches — the whole head group tracks its target. */}
      <group ref={head} position={[0, 1.05, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.42, 0.34, 0.4]} />
          <meshStandardMaterial color="#b8a888" roughness={0.75} flatShading />
        </mesh>
        {/* Eye pits — dead, faintly lit from inside. */}
        {([0.11, -0.11] as const).map((x) => (
          <mesh key={x} position={[x, 0.04, 0.21]}>
            <boxGeometry args={[0.1, 0.09, 0.03]} />
            <meshStandardMaterial color="#000" emissive="#ff5136" emissiveIntensity={0.7} toneMapped={false} />
          </mesh>
        ))}
        {/* The jaw hangs open; the fire builds in its throat (charging glow). */}
        <mesh position={[0, -0.24, 0.06]} rotation={[0.35, 0, 0]} castShadow>
          <boxGeometry args={[0.34, 0.1, 0.34]} />
          <meshStandardMaterial color="#a89878" roughness={0.8} flatShading />
        </mesh>
        <mesh position={[0, -0.14, 0.14]}>
          <boxGeometry args={[0.26, 0.12, 0.16]} />
          <meshStandardMaterial
            ref={mat}
            color="#1c0c08"
            emissive="#ff5136"
            emissiveIntensity={1.4}
            toneMapped={false}
          />
        </mesh>
        {/* Cracked horn stubs. */}
        {([0.16, -0.16] as const).map((x) => (
          <mesh key={x} position={[x, 0.22, 0]} rotation={[0, 0, -x * 2.2]} castShadow>
            <coneGeometry args={[0.05, 0.2, 4]} />
            <meshStandardMaterial color="#988868" roughness={0.85} flatShading />
          </mesh>
        ))}
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
  const face = useRef<Group>(null);
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
    facePlayer(face.current, dx, dz, dt);

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
      {/* Rags of dark trailing under it. */}
      {[-0.9, -0.2, 0.6, 1.4].map((a, i) => (
        <mesh
          key={i}
          position={[Math.cos(a) * 0.26, -0.42 - (i % 2) * 0.1, Math.sin(a) * 0.26]}
          rotation={[Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3]}
        >
          <coneGeometry args={[0.09, 0.34 + (i % 3) * 0.1, 4]} />
          <meshStandardMaterial
            color="#0a0616"
            roughness={0.8}
            flatShading
            transparent
            opacity={0.4}
          />
        </mesh>
      ))}
      {/* Too many eyes peering out of the murk, none of them level — and all
          of them turned toward you. */}
      <group ref={face}>
        <mesh position={[0.13, 0.06, 0.34]}>
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshStandardMaterial color="#000" emissive="#c89cff" emissiveIntensity={3} toneMapped={false} />
        </mesh>
        <mesh position={[-0.12, 0.0, 0.35]}>
          <sphereGeometry args={[0.06, 6, 6]} />
          <meshStandardMaterial color="#000" emissive="#c89cff" emissiveIntensity={3} toneMapped={false} />
        </mesh>
        <mesh position={[0.01, 0.18, 0.32]}>
          <sphereGeometry args={[0.032, 6, 6]} />
          <meshStandardMaterial color="#000" emissive="#e2ccff" emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      </group>
    </RigidBody>
  );
}

/** Slime — a gelatinous melee blob that hops toward its prey and, on death,
 * SPLITS into two smaller, faster copies (down to a terminal generation).
 * Children are spawned host-authoritatively via spawnEnemy() and rendered by
 * <SpawnedEnemies>. Unlike the fliers it lives on the floor (gravity on). */
const SLIME_MAX_GEN = 2;
const SLIME_GEN = [
  { size: 1.0, speed: 3.2, hp: 1.0, contact: 12, hop: 5.4 },
  { size: 0.66, speed: 4.6, hp: 0.5, contact: 9, hop: 5.0 },
  { size: 0.44, speed: 6.2, hp: 0.3, contact: 6, hop: 4.6 },
];

export function Slime({
  position,
  floor,
  entityId,
  generation = 0,
  onDeath,
}: {
  position: Vec3;
  floor: number;
  entityId: string;
  generation?: number;
  onDeath?: () => void;
}) {
  const gen = Math.min(generation, SLIME_MAX_GEN);
  const cfg = SLIME_GEN[gen];
  const radius = 0.5 * cfg.size;
  const body = useRef<RapierRigidBody>(null);
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const face = useRef<Group>(null);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(getEnemyStats("slime").baseHealth * cfg.hp * scale.enemyHealth);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const aggro = useRef(false);
  const knockTimer = useRef(0);
  const contactTimer = useRef(0);
  const hopTimer = useRef(Math.random() * 0.6);
  const flash = useRef(0);

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        spawnBurst({
          position: [t.x, t.y, t.z],
          count: 20,
          color: ["#7fdc4a", "#2f5a1a", "#c8ff8a"],
          speed: 5,
          ttl: 0.7,
          size: 0.09 + cfg.size * 0.05,
        });
        flashLight([t.x, t.y, t.z], "#7fdc4a", 14);
        dropGold([t.x, Math.max(t.y, 0.4), t.z], floor, GOLD_DROPS.enemyChance, "enemy");
        // The whole slime's loot lands when its LAST piece dies, not on every split.
        if (gen >= SLIME_MAX_GEN) dropLoot([t.x, Math.max(t.y, 0.4), t.z], floor, LOOT_DROP_CHANCE);
        // Split into two smaller, faster children (host decides; all render).
        if (gen < SLIME_MAX_GEN) {
          spawnEnemy("slime", gen + 1, [t.x - 0.7, t.y + 0.2, t.z], floor);
          spawnEnemy("slime", gen + 1, [t.x + 0.7, t.y + 0.2, t.z], floor);
        }
      }
      onDeath?.();
      setDead(true);
    },
    [floor, position, gen, cfg.size, onDeath],
  );

  const hitFeedback = useCallback(() => {
    const t = body.current?.translation();
    if (!t) return;
    spawnBurst({ position: [t.x, t.y, t.z], count: 6, color: "#a8f06a", speed: 3, ttl: 0.4, size: 0.06 });
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

  useFrame((_, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (!combatActive()) return;

    flash.current = Math.max(0, flash.current - dt * 5);
    if (mat.current) mat.current.emissiveIntensity = 0.9 + flash.current * 6;
    contactTimer.current -= dt;

    const t = b.translation();
    const v = b.linvel();
    // Squash & stretch from vertical motion — reads as a bouncing blob.
    if (mesh.current) {
      const sy = Math.max(0.72, Math.min(1.28, 1 + v.y * 0.03));
      const sxz = 1 / Math.sqrt(sy);
      mesh.current.scale.set(cfg.size * sxz, cfg.size * sy, cfg.size * sxz);
    }

    const dx = playerPosition.x - t.x;
    const dz = playerPosition.z - t.z;
    const dist = Math.hypot(dx, playerPosition.y - t.y, dz);
    facePlayer(face.current, dx, dz, dt);
    if (dist < radius + 0.8 && contactTimer.current <= 0) {
      contactTimer.current = PLAYER.contactDamageCooldown;
      useGame.getState().takeDamage(cfg.contact * scale.enemyDamage);
      const push = 4 / Math.max(dist, 0.4);
      getPlayerBody()?.applyImpulse({ x: dx * push * 0.3, y: 1.5, z: dz * push * 0.3 }, true);
    }

    if (!net.isAuthority) return;

    const target = nearestWizardTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current) {
      if (target.dist < 14 * getStats().aggroMult) aggro.current = true;
      return;
    }
    if (knockTimer.current > 0) return;

    const tx = target.pos.x - t.x;
    const tz = target.pos.z - t.z;
    const planar = Math.hypot(tx, tz) || 1;
    const speed = cfg.speed + floor * 0.03;
    let vy = v.y;
    hopTimer.current -= dt;
    if (hopTimer.current <= 0 && Math.abs(v.y) < 0.9) {
      hopTimer.current = 0.55 + Math.random() * 0.4;
      vy = cfg.hop; // a spring off the floor
    }
    b.setLinvel({ x: (tx / planar) * speed, y: vy, z: (tz / planar) * speed }, true);
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={net.bodyType}
      colliders={false}
      gravityScale={1}
      linearDamping={0.1}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[radius]} mass={1.2 * cfg.size} collisionGroups={ENEMY_GROUPS} />
      <mesh ref={mesh} castShadow scale={cfg.size}>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial
          ref={mat}
          color="#1f3a1a"
          emissive="#7fdc4a"
          emissiveIntensity={0.9}
          transparent
          opacity={0.85}
          roughness={0.5}
          flatShading
        />
      </mesh>
      {/* Things it has eaten, still visible inside. */}
      <mesh position={[0.1 * cfg.size, -0.05 * cfg.size, 0.05 * cfg.size]} rotation={[0.5, 0.8, 0.2]}>
        <boxGeometry args={[0.16 * cfg.size, 0.07 * cfg.size, 0.07 * cfg.size]} />
        <meshStandardMaterial color="#b8a888" roughness={0.8} flatShading />
      </mesh>
      <mesh position={[-0.12 * cfg.size, 0.08 * cfg.size, -0.04 * cfg.size]} rotation={[1.2, 0.2, 0.9]}>
        <coneGeometry args={[0.05 * cfg.size, 0.18 * cfg.size, 4]} />
        <meshStandardMaterial color="#a89878" roughness={0.8} flatShading />
      </mesh>
      {/* Face — mismatched eyes and a slack mouth, kept turned toward you. */}
      <group ref={face}>
        <mesh position={[0.16 * cfg.size, 0.12 * cfg.size, 0.33 * cfg.size]}>
          <sphereGeometry args={[0.07 * cfg.size, 6, 6]} />
          <meshStandardMaterial color="#04140a" emissive="#d4ffb0" emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <mesh position={[-0.15 * cfg.size, 0.04 * cfg.size, 0.35 * cfg.size]}>
          <sphereGeometry args={[0.045 * cfg.size, 6, 6]} />
          <meshStandardMaterial color="#04140a" emissive="#d4ffb0" emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.12 * cfg.size, 0.4 * cfg.size]} rotation={[0.3, 0, 0.12]}>
          <boxGeometry args={[0.3 * cfg.size, 0.045 * cfg.size, 0.05 * cfg.size]} />
          <meshStandardMaterial color="#0c2410" roughness={0.9} />
        </mesh>
      </group>
    </RigidBody>
  );
}
