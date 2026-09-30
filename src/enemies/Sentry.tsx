import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition, playerVelocity } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { castEnemyBolt } from "./ai/cast";
import { turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { useGlow } from "./models/materials";
import { SENTRY_HEAD_Y, SentryModel, type SentryRig } from "./models/SentryModel";
import { bandTint, devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const CHARGE = 0.7;
const MID = 0.8;

/** Sentry — a warding obelisk rooted to the floor. It watches with a floating
 * crystal eye and, with line of sight, lobs slow dodgeable bolts. The tell:
 * the iron ring whirls and motes stream into the eye. The host decides when
 * it fires; replicas replay the bolt. */
export function Sentry({ position, floor, entityId }: EnemyProps) {
  const tint = useMemo(() => bandTint(floor), [floor]);
  const glow = useGlow(tint, 1.4);
  const rig = useMemo<SentryRig>(() => ({ head: null, ring: null }), []);
  const { world, rapier } = useRapier();
  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 60,
    hitColor: "#d8d0e0",
    death: {
      centerY: 0,
      burst: [tint, "#ffffff", "#3a3442"],
      light: tint,
      gibs: GIBS.stone,
      gibCount: 12,
      force: 5,
    },
  });
  const { body, host, scale, deadRef, flash } = e;
  const fireTimer = useRef(2 + Math.random() * 1.5);
  const yaw = useRef(Math.random() * 6);
  const aim = useMemo(() => new Vector3(), []);
  const losRay = useMemo(
    () => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    [rapier],
  );
  const center = useMemo<Vec3>(() => [position[0], position[1] + MID, position[2]], [position]);
  const headPos = useMemo(
    () => ({ x: position[0], y: position[1] + SENTRY_HEAD_Y, z: position[2] }),
    [position],
  );

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;

    flash.current = Math.max(0, flash.current - dt * 5);
    if (host) fireTimer.current -= dt;
    // Replicas don't know the host's timer: they idle-glow and see the bolt.
    const charge = host && fireTimer.current < CHARGE ? 1 - Math.max(fireTimer.current, 0) / CHARGE : 0;
    glow.emissiveIntensity = 1.3 + Math.sin(time * 2.2) * 0.2 + flash.current * 6 + charge * 5;

    // Head tracking is cosmetic — every client tracks its own wizard.
    const dx = playerPosition.x - headPos.x;
    const dz = playerPosition.z - headPos.z;
    if (rig.head) {
      if (dx * dx + dz * dz < 900) yaw.current = turnToward(yaw.current, Math.atan2(dx, dz), dt * 3);
      rig.head.rotation.y = yaw.current;
      rig.head.position.y = Math.sin(time * 1.7) * 0.07;
      const s = 1 + charge * 0.25 + flash.current * 0.1;
      rig.head.scale.setScalar(s);
    }
    if (rig.ring) {
      rig.ring.rotation.y += dt * (0.8 + charge * 14);
      rig.ring.rotation.x = Math.sin(time * 0.9) * 0.3 + charge * 0.6;
    }
    if (charge > 0 && Math.random() < dt * 30) {
      // Motes stream into the eye.
      const a = Math.random() * Math.PI * 2;
      spawnBurst({
        position: [headPos.x + Math.cos(a) * 0.9, headPos.y + (Math.random() - 0.5), headPos.z + Math.sin(a) * 0.9],
        count: 1,
        color: tint,
        speed: 0.2,
        upward: 0,
        ttl: 0.3,
        size: 0.06,
        gravity: 0,
      });
    }

    if (!host || fireTimer.current > 0 || devStage.calm) return;
    fireTimer.current = Math.max(1.4, 2.6 - floor * 0.04);
    // Fire at the nearest wizard on the floor, not just the host's.
    const target = nearestPlayerTo(headPos.x, headPos.y, headPos.z);
    const dist = target.dist;
    if (dist > 26) return;
    aim.set(target.pos.x - headPos.x, target.pos.y - headPos.y, target.pos.z - headPos.z).normalize();
    losRay.origin = headPos;
    losRay.dir = { x: aim.x, y: aim.y, z: aim.z };
    const hit = world.castRay(losRay, dist - 0.6, true, undefined, undefined, undefined, b);
    if (hit !== null) return; // wall or prop in the way
    const speed = 15;
    // Lead the shot only for our own wizard — peer velocities are unknown.
    aim.multiplyScalar(dist);
    if (target.isLocal) aim.addScaledVector(playerVelocity, Math.min(dist / speed, 1.2) * 0.45);
    aim.normalize().multiplyScalar(speed);
    const origin: Vec3 = [headPos.x + aim.x * 0.06, headPos.y + aim.y * 0.06, headPos.z + aim.z * 0.06];
    castEnemyBolt({
      origin,
      velocity: [aim.x, aim.y, aim.z],
      damage: 11 * scale.enemyDamage,
      color: tint,
      size: 0.16,
      blastRadius: 1.9,
      blastImpulse: 11,
    });
    flashLight(origin, tint, 10);
  });

  if (e.dead) return null;
  return (
    // Body origin sits at the obelisk's middle so blasts measure from its mass.
    <RigidBody ref={body} position={center} type="fixed" colliders={false}>
      <CuboidCollider args={[0.45, 0.8, 0.45]} collisionGroups={ENEMY_GROUPS} />
      <group position={[0, -MID, 0]}>
        <SentryModel rig={rig} glow={glow} />
      </group>
    </RigidBody>
  );
}
