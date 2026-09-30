import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useMemo, useRef, useState } from "react";
import { MeshStandardMaterial, Vector3 } from "three";
import { floorScale, PLAYER } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { dropLoot } from "../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { getStats, useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { ENEMY_GROUPS, LOOT_DROP_CHANCE } from "./shared";
import { useEnemyNet } from "./useEnemyNet";

/** Wisp — a floating mote of hostile magic. Chases the player and burns on
 * contact. The floor host runs its AI; replicas interpolate. */
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
  const host = useNet(selectIsHost);
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
        if (isHost()) {
          dropLoot([t.x, Math.max(t.y, 0.6), t.z], floor, LOOT_DROP_CHANCE);
          session.sendEntityEvent({ k: "death", id: entityId });
        }
      }
      setDead(true);
    },
    [entityId, floor, position],
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

  const { interpolate } = useEnemyNet({
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
    if (useGame.getState().phase !== "dungeon") return;

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

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host AI: threaten the NEAREST wizard on the floor, not just ours ─────
    const target = nearestPlayerTo(t.x, t.y, t.z);
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
      type={host ? "dynamic" : "kinematicPosition"}
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
