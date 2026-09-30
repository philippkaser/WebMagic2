import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { fireProjectile } from "../combat/projectiles";
import { floorScale } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition, playerVelocity } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { dropLoot } from "../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { ENEMY_GROUPS, LOOT_DROP_CHANCE } from "./shared";
import { useEnemyNet } from "./useEnemyNet";

/** Sentry — a fixed warding crystal that lobs slow, dodgeable fire bolts when
 * it has line of sight. The host decides when it fires; replicas replay the
 * bolt (which still hurts *their* player if it connects). */
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
  const host = useNet(selectIsHost);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const hp = useRef(60 * scale.enemyHealth);
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
        if (isHost()) {
          dropLoot([t.x, t.y + 0.5, t.z], floor, LOOT_DROP_CHANCE);
          session.sendEntityEvent({ k: "death", id: entityId });
        }
      }
      setDead(true);
    },
    [entityId, floor, position],
  );

  useEnemyNet({ entityId, body, hp, deadRef, flash, dead, onKill: kill });

  useFrame((_, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;

    flash.current = Math.max(0, flash.current - dt * 5);
    const t = b.translation();
    const headPos = { x: t.x, y: t.y + 1.05, z: t.z };

    // Head tracking is cosmetic — every client tracks its own player.
    aim.set(playerPosition.x - headPos.x, playerPosition.y - headPos.y, playerPosition.z - headPos.z);
    if (head.current && aim.length() < 30) {
      const targetYaw = Math.atan2(aim.x, aim.z);
      head.current.rotation.y += (targetYaw - head.current.rotation.y) * Math.min(1, dt * 4);
    }

    if (!host) {
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
      // Fire at the nearest wizard on the floor, not just the host's.
      const target = nearestPlayerTo(headPos.x, headPos.y, headPos.z);
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
      // Lead the shot only for our own player — peer velocities are unknown.
      aim.multiplyScalar(dist);
      if (target.isLocal) {
        aim.addScaledVector(playerVelocity, Math.min(dist / speed, 1.2) * 0.45);
      }
      aim.normalize().multiplyScalar(speed);
      const origin: Vec3 = [
        headPos.x + aim.x * 0.06,
        headPos.y + aim.y * 0.06,
        headPos.z + aim.z * 0.06,
      ];
      const velocity: Vec3 = [aim.x, aim.y, aim.z];
      const damage = 11 * scale.enemyDamage;
      fireProjectile({
        team: "enemy",
        position: origin,
        velocity,
        damage,
        color: "#ff5136",
        size: 0.16,
        blastRadius: 1.9,
        blastImpulse: 11,
      });
      session.sendEntityEvent({
        k: "enemyCast",
        origin,
        velocity,
        damage,
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
