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
import { Rng } from "../core/rng";
import { flashLight, spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition, playerVelocity } from "../game/player-state";
import { allocId, registerHittable } from "../game/registry";
import { rollLoot } from "../items/loot";
import { spawnLootOrb } from "../items/LootOrbs";
import { getStats, useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { fireProjectile } from "./projectiles";

const ENEMY_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

const LOOT_DROP_CHANCE = 0.24;

function maybeDropLoot(pos: { x: number; y: number; z: number }, floor: number) {
  if (Math.random() > LOOT_DROP_CHANCE) return;
  const def = rollLoot(new Rng((Math.random() * 0xffffffff) >>> 0), floor);
  spawnLootOrb([pos.x, Math.max(pos.y, 0.6), pos.z], def.id);
}

/** Wisp — a floating mote of hostile magic. Chases the player and burns on
 * contact. Fully physical: bolts and blasts send it tumbling. */
export function Wisp({ position, floor }: { position: Vec3; floor: number }) {
  const body = useRef<RapierRigidBody>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(30 * scale.enemyHealth);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const aggro = useRef(false);
  const knockTimer = useRef(0);
  const contactTimer = useRef(0);
  const flash = useRef(0);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const desired = useMemo(() => new Vector3(), []);

  const kill = useCallback(() => {
    if (deadRef.current) return;
    deadRef.current = true;
    const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
    spawnBurst({
      position: [t.x, t.y, t.z],
      count: 30,
      color: ["#b46bff", "#ffffff", "#4a2a7a"],
      speed: 7,
      ttl: 0.8,
      size: 0.1,
    });
    flashLight([t.x, t.y, t.z], "#b46bff", 22);
    maybeDropLoot(t, floor);
    setDead(true);
  }, [floor, position]);

  useEffect(() => {
    if (dead) return;
    return registerHittable({
      id: allocId(),
      team: "enemy",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        hp.current -= damage;
        flash.current = 1;
        knockTimer.current = 0.4;
        playHit();
        body.current?.applyImpulse(impulse, true);
        const t = body.current?.translation();
        if (t) {
          spawnBurst({
            position: [t.x, t.y, t.z],
            count: 6,
            color: "#d9a9ff",
            speed: 3,
            ttl: 0.4,
            size: 0.06,
          });
        }
        if (hp.current <= 0) kill();
      },
    });
  }, [dead, kill]);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;

    flash.current = Math.max(0, flash.current - dt * 5);
    if (mat.current) mat.current.emissiveIntensity = 1.7 + flash.current * 6;
    knockTimer.current -= dt;
    contactTimer.current -= dt;

    const t = b.translation();
    const dx = playerPosition.x - t.x;
    const dy = playerPosition.y - t.y;
    const dz = playerPosition.z - t.z;
    const dist = Math.hypot(dx, dy, dz);

    if (!aggro.current) {
      if (dist < 15 * getStats().aggroMult) aggro.current = true;
      // Idle drift.
      b.setLinvel({ x: 0, y: Math.sin(clock.elapsedTime * 1.4 + phase) * 0.5, z: 0 }, true);
      return;
    }

    if (knockTimer.current <= 0) {
      const targetY = playerPosition.y + 0.5 + Math.sin(clock.elapsedTime * 2.1 + phase) * 0.4;
      desired.set(dx, 0, dz);
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

    // Contact burn.
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
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
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
 * it has line of sight. Punishes standing still. */
export function Sentry({ position, floor }: { position: Vec3; floor: number }) {
  const body = useRef<RapierRigidBody>(null);
  const head = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const { world, rapier } = useRapier();
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(60 * scale.enemyHealth);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const fireTimer = useRef(2 + Math.random() * 1.5);
  const flash = useRef(0);
  const aim = useMemo(() => new Vector3(), []);

  const kill = useCallback(() => {
    if (deadRef.current) return;
    deadRef.current = true;
    const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
    spawnBurst({
      position: [t.x, t.y + 0.8, t.z],
      count: 36,
      color: ["#ff7a4d", "#ffd9a8", "#3a2418"],
      speed: 6.5,
      ttl: 0.9,
      size: 0.11,
    });
    flashLight([t.x, t.y + 0.8, t.z], "#ff7a4d", 26);
    maybeDropLoot({ x: t.x, y: t.y + 0.5, z: t.z }, floor);
    setDead(true);
  }, [floor, position]);

  useEffect(() => {
    if (dead) return;
    return registerHittable({
      id: allocId(),
      team: "enemy",
      getPosition: () => {
        const t = body.current?.translation() ?? { x: 0, y: -999, z: 0 };
        return { x: t.x, y: t.y + 0.8, z: t.z };
      },
      hit: (damage) => {
        if (deadRef.current) return;
        hp.current -= damage;
        flash.current = 1;
        playHit();
        if (hp.current <= 0) kill();
      },
    });
  }, [dead, kill]);

  useFrame((_, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;

    flash.current = Math.max(0, flash.current - dt * 5);
    const t = b.translation();
    const headPos = { x: t.x, y: t.y + 1.05, z: t.z };
    aim.set(playerPosition.x - headPos.x, playerPosition.y - headPos.y, playerPosition.z - headPos.z);
    const dist = aim.length();

    // Track the player.
    if (head.current && dist < 30) {
      const targetYaw = Math.atan2(aim.x, aim.z);
      head.current.rotation.y += (targetYaw - head.current.rotation.y) * Math.min(1, dt * 4);
    }

    fireTimer.current -= dt;
    const charging = fireTimer.current < 0.55;
    if (mat.current) {
      mat.current.emissiveIntensity = 1.4 + flash.current * 6 + (charging ? (0.55 - Math.max(fireTimer.current, 0)) * 7 : 0);
    }

    if (fireTimer.current <= 0) {
      fireTimer.current = Math.max(1.4, 2.5 - floor * 0.04);
      if (dist > 26) return;
      aim.normalize();
      const ray = new rapier.Ray(headPos, { x: aim.x, y: aim.y, z: aim.z });
      const hit = world.castRay(ray, dist - 0.6, true, undefined, undefined, undefined, b);
      if (hit !== null) return; // wall or prop in the way
      // Lead the shot slightly so strafing matters.
      const speed = 15;
      aim
        .multiplyScalar(dist)
        .addScaledVector(playerVelocity, Math.min(dist / speed, 1.2) * 0.45)
        .normalize()
        .multiplyScalar(speed);
      fireProjectile({
        team: "enemy",
        position: [headPos.x + aim.x * 0.06, headPos.y + aim.y * 0.06, headPos.z + aim.z * 0.06],
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
