import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { playBossRoar } from "../audio/sound";
import { floorScale, GROUPS } from "../core/config";
import { gameEvents } from "../core/events";
import {
  addLightSource,
  flashLight,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition, playerVelocity } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { dropLoot } from "../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { explode } from "./damage";
import { useEnemyNet } from "./enemies";
import { fireProjectile } from "./projectiles";

const BOSS_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

const BOSS_ID = "boss";
const BOSS_NAME = "WARDEN OF THE DEEP";
const COLOR = "#ff3d2e";

type Attack = "volley" | "ring" | "charge" | "slam";

/** Floor boss (every 10th floor). The floor host runs its brain; replicas
 * interpolate its body, replay its attacks, and mirror its health bar. The
 * floor's portals stay sealed until it falls. */
export function Boss({
  position,
  floor,
  onDeath,
}: {
  position: Vec3;
  floor: number;
  onDeath: () => void;
}) {
  const body = useRef<RapierRigidBody>(null);
  const shell = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const host = useNet(selectIsHost);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const maxHp = useMemo(() => 420 * scale.enemyHealth, [scale]);
  const hp = useRef(maxHp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const awake = useRef(false);
  const attackTimer = useRef(2.5);
  const charging = useRef(0);
  const slamTelegraph = useRef(0);
  const flash = useRef(0);
  const contactTimer = useRef(0);
  const light = useRef<DynamicLightSource | null>(null);
  const desired = useMemo(() => new Vector3(), []);
  const aim = useMemo(() => new Vector3(), []);

  useEffect(() => {
    const src = addLightSource({
      position,
      color: COLOR,
      intensity: 8,
      distance: 13,
      priority: 2,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position]);

  const kill = useCallback(
    (silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        for (let i = 0; i < 3; i++) {
          spawnBurst({
            position: [t.x + (Math.random() - 0.5), t.y + (Math.random() - 0.5), t.z + (Math.random() - 0.5)],
            count: 40,
            color: [COLOR, "#ffd9a8", "#2a0d0a"],
            speed: 8,
            ttl: 1.1,
            size: 0.13,
          });
        }
        flashLight([t.x, t.y, t.z], COLOR, 60);
        playBossRoar();
        if (isHost()) {
          // Guaranteed rich drops for the whole party.
          dropLoot([t.x - 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor + 2);
          dropLoot([t.x + 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor + 2);
          session.sendEntityEvent({ k: "death", id: BOSS_ID });
        }
        gameEvents.emit("message", "The Warden falls. The seal breaks.");
        gameEvents.emit("shake", 0.8);
      }
      gameEvents.emit("bossHp", null);
      setDead(true);
      onDeath(); // unseal the portals either way
    },
    [floor, onDeath, position],
  );

  const announceHp = useCallback(
    (current: number) => {
      if (deadRef.current) return;
      if (!awake.current) {
        awake.current = true;
        gameEvents.emit("message", `${BOSS_NAME} wakes`);
      }
      gameEvents.emit("bossHp", { name: BOSS_NAME, frac: Math.max(current / maxHp, 0) });
    },
    [maxHp],
  );

  const { interpolate } = useEnemyNet({
    entityId: BOSS_ID,
    body,
    hp,
    deadRef,
    flash,
    dead,
    knockbackScale: 0.25,
    onKill: kill,
    onSnap: announceHp,
  });

  // Hide the HUD bar if the floor unmounts mid-fight.
  useEffect(() => () => gameEvents.emit("bossHp", null), []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;

    flash.current = Math.max(0, flash.current - dt * 4);
    const enraged = hp.current < maxHp * 0.5;
    if (mat.current) {
      mat.current.emissiveIntensity =
        1.3 + flash.current * 5 + (enraged ? 0.8 + Math.sin(clock.elapsedTime * 8) * 0.4 : 0);
    }
    if (shell.current) shell.current.rotation.y += dt * (enraged ? 1.6 : 0.7);

    const t = b.translation();
    if (light.current) {
      light.current.position.set(t.x, t.y, t.z);
      light.current.intensity =
        8 + flash.current * 10 + (enraged ? 2 + Math.sin(clock.elapsedTime * 8) * 1.5 : 0);
    }

    // Contact damage is local on every client (distance to OUR player).
    const localDist = Math.hypot(
      playerPosition.x - t.x,
      playerPosition.y + 0.4 - t.y,
      playerPosition.z - t.z,
    );
    contactTimer.current -= dt;
    if (awake.current && localDist < 2.3 && contactTimer.current <= 0) {
      contactTimer.current = 0.9;
      useGame.getState().takeDamage(16 * scale.enemyDamage);
    }

    if (!host) {
      interpolate(dt);
      return;
    }

    // Host brain: fight the nearest wizard on the floor.
    const target = nearestPlayerTo(t.x, t.y + 0.4, t.z);
    aim.set(target.pos.x - t.x, target.pos.y + 0.4 - t.y, target.pos.z - t.z);
    const dist = target.dist;

    if (!awake.current) {
      if (dist < 13) {
        awake.current = true;
        playBossRoar();
        gameEvents.emit("message", `${BOSS_NAME} wakes`);
        gameEvents.emit("bossHp", { name: BOSS_NAME, frac: 1 });
        gameEvents.emit("shake", 0.5);
      }
      return;
    }

    // ── Movement ─────────────────────────────────────────────────────────────
    const speed = enraged ? 3.4 : 2.3;
    if (charging.current > 0) {
      charging.current -= dt;
    } else {
      desired.copy(aim).setY(0);
      if (desired.lengthSq() > 0.01) desired.normalize();
      const range = dist > 7.5 ? 1 : dist < 4 ? -0.55 : 0;
      desired.multiplyScalar(speed * range);
      desired.y = (position[1] + Math.sin(clock.elapsedTime * 1.3) * 0.5 - t.y) * 2;
      const v = b.linvel();
      const k = 1 - Math.exp(-2 * dt);
      b.setLinvel(
        {
          x: v.x + (desired.x - v.x) * k,
          y: v.y + (desired.y - v.y) * k,
          z: v.z + (desired.z - v.z) * k,
        },
        true,
      );
    }

    // ── Attacks ──────────────────────────────────────────────────────────────
    if (slamTelegraph.current > 0) {
      slamTelegraph.current -= dt;
      if (slamTelegraph.current <= 0) {
        const pos: Vec3 = [t.x, t.y, t.z];
        const damage = 20 * scale.enemyDamage;
        explode({
          position: pos,
          radius: 5.2,
          damage,
          impulse: 46,
          team: "enemy",
          color: COLOR,
          particles: 50,
          light: 50,
        });
        session.sendEntityEvent({ k: "boom", pos, radius: 5.2, damage, impulse: 46, color: COLOR });
      }
      return;
    }

    attackTimer.current -= dt;
    if (attackTimer.current > 0 || dist > 24) return;
    attackTimer.current = enraged ? 1.7 : 2.6;

    const attack = pickAttack(dist);
    const origin: Vec3 = [t.x, t.y + 0.4, t.z];
    const cast = (velocity: Vec3, damage: number, color: string, size: number) => {
      const blastRadius = size > 0.16 ? 1.9 : 1.5;
      const blastImpulse = size > 0.16 ? 12 : 9;
      fireProjectile({
        team: "enemy",
        position: origin,
        velocity,
        damage,
        color,
        size,
        blastRadius,
        blastImpulse,
      });
      session.sendEntityEvent({
        k: "enemyCast",
        origin,
        velocity,
        damage,
        color,
        size,
        blastRadius,
        blastImpulse,
      });
    };
    switch (attack) {
      case "volley": {
        aim.normalize();
        const projSpeed = 14;
        aim.multiplyScalar(dist);
        // Lead the shot only against our own player — peer velocity unknown.
        if (target.isLocal) aim.addScaledVector(playerVelocity, 0.4);
        aim.normalize();
        for (let i = 0; i < (enraged ? 6 : 4); i++) {
          cast(
            [
              (aim.x + (Math.random() - 0.5) * 0.16) * projSpeed,
              (aim.y + (Math.random() - 0.5) * 0.1) * projSpeed,
              (aim.z + (Math.random() - 0.5) * 0.16) * projSpeed,
            ],
            10 * scale.enemyDamage,
            COLOR,
            0.17,
          );
        }
        break;
      }
      case "ring": {
        const count = enraged ? 14 : 10;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          cast([Math.cos(a) * 9, 0.4, Math.sin(a) * 9], 8 * scale.enemyDamage, "#ff8b3d", 0.15);
        }
        flashLight(origin, "#ff8b3d", 24);
        break;
      }
      case "charge": {
        aim.setY(0).normalize();
        b.setLinvel({ x: aim.x * 13, y: 0.5, z: aim.z * 13 }, true);
        charging.current = 0.7;
        spawnBurst({ position: origin, count: 18, color: COLOR, speed: 4, ttl: 0.5, size: 0.09 });
        break;
      }
      case "slam": {
        slamTelegraph.current = 0.6;
        flash.current = 1;
        gameEvents.emit("shake", 0.25);
        break;
      }
    }
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      gravityScale={0}
      linearDamping={0.8}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[1.15]} mass={30} collisionGroups={BOSS_GROUPS} />
      <group ref={shell}>
        <mesh castShadow>
          <icosahedronGeometry args={[1.15, 1]} />
          <meshStandardMaterial
            ref={mat}
            color="#1c0806"
            emissive={COLOR}
            emissiveIntensity={1.3}
            flatShading
            roughness={0.35}
            metalness={0.3}
          />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            position={[
              Math.cos((i / 3) * Math.PI * 2) * 1.7,
              Math.sin(i * 2.1) * 0.4,
              Math.sin((i / 3) * Math.PI * 2) * 1.7,
            ]}
          >
            <octahedronGeometry args={[0.22]} />
            <meshStandardMaterial
              color="#0c0402"
              emissive="#ff8b3d"
              emissiveIntensity={2.4}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <mesh>
        <sphereGeometry args={[0.42, 10, 10]} />
        <meshStandardMaterial color="#000" emissive="#ffd0b0" emissiveIntensity={3.4} toneMapped={false} />
      </mesh>
    </RigidBody>
  );
}

function pickAttack(dist: number): Attack {
  if (dist < 4.5) return Math.random() < 0.65 ? "slam" : "ring";
  if (dist > 12) return Math.random() < 0.6 ? "charge" : "volley";
  const r = Math.random();
  return r < 0.45 ? "volley" : r < 0.75 ? "ring" : "charge";
}
