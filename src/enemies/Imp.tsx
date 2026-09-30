import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition, playerVelocity } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { getStats, useGame } from "../state/gameStore";
import { castEnemyBolt } from "./ai/cast";
import { touchPlayer } from "./ai/contact";
import { ballistic, MotionTracker, turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { ImpModel, type ImpRig } from "./models/ImpModel";
import { useGlow } from "./models/materials";
import { devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const FIRE = "#ff7a2a";
const RADIUS = 0.3;
const WINDUP = 0.55;
const LOB_GRAVITY = 0.6;

/** Ember imp — a quick, fragile forge-sprite that hops about at a distance.
 * It conjures a fireball over its horns (the tell), then lobs it in a real
 * arc; where it lands the floor burns for a few seconds. Kill it and it pops
 * like a coal. */
export function Imp({ position, floor, entityId }: EnemyProps) {
  const eyes = useGlow("#ffd24a", 2.6);
  const ember = useGlow(FIRE, 2.4);
  const rig = useMemo<ImpRig>(
    () => ({ body: null, wingL: null, wingR: null, fireball: null, mouth: null }),
    [],
  );
  const facing = useRef<Group>(null);
  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 24,
    hitColor: "#ffd9a8",
    knockbackScale: 1.2,
    death: {
      centerY: 0,
      burst: [FIRE, "#ffe7a0", "#2a0d08"],
      light: FIRE,
      gibs: GIBS.ember,
      gibCount: 14,
      force: 5,
    },
  });
  const { body, host, scale, deadRef, flash, aggro, knockTimer, interpolate } = e;
  const hopTimer = useRef(Math.random());
  const castTimer = useRef(1.5 + Math.random() * 1.5);
  const windup = useRef(0);
  const contactTimer = useRef(0);
  const yaw = useRef(0);
  const orbit = useMemo(() => (Math.random() < 0.5 ? -1 : 1), []);
  const phase = useMemo(() => Math.random() * 6, []);
  const motion = useMemo(() => new MotionTracker(), []);
  const launch = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const aimPoint = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);
    const airborne = t.y > RADIUS + 0.12;

    // ── Look ────────────────────────────────────────────────────────────────
    flash.current = Math.max(0, flash.current - dt * 5);
    if (host) e.tell.current = windup.current > 0 ? 1 - windup.current / WINDUP : 0;
    const charge = e.tell.current; // replicated wind-up
    ember.emissiveIntensity = 2.2 + Math.sin(time * 10 + phase) * 0.4 + flash.current * 5 + charge * 3;
    eyes.emissiveIntensity = 2.4 + flash.current * 5;
    yaw.current = turnToward(yaw.current, Math.atan2(playerPosition.x - t.x, playerPosition.z - t.z), dt * 8);
    if (facing.current) facing.current.rotation.y = yaw.current;
    const flap = Math.sin(time * (airborne ? 26 : 9) + phase) * (airborne ? 0.9 : 0.35);
    if (rig.wingR) rig.wingR.rotation.set(0, -0.5 + flap, 0.3);
    if (rig.wingL) rig.wingL.rotation.set(0, 0.5 - flap, -0.3);
    if (rig.body) {
      rig.body.rotation.x = -charge * 0.35;
      const squash = airborne ? 1 : 1 - Math.max(0, Math.sin(time * 14 + phase)) * 0.06;
      rig.body.scale.set(1 + (1 - squash), squash, 1 + (1 - squash));
    }
    if (rig.fireball) {
      // Only visible while conjuring (host knows; replicas see the lob).
      rig.fireball.scale.setScalar(Math.max(0.001, charge * 1.2));
      rig.fireball.rotation.y = time * 8;
    }
    if (rig.mouth) rig.mouth.scale.y = 1 + charge * 2.5;

    contactTimer.current -= dt;
    touchPlayer(t.x, t.y, t.z, {
      reach: 0.95,
      damage: 5 * scale.enemyDamage,
      timer: contactTimer,
      cooldown: 0.8,
      knock: 4,
      color: FIRE,
    });

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain ─────────────────────────────────────────────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current || devStage.calm) {
      if (target.dist < 15 * getStats().aggroMult) aggro.current = true;
      return;
    }
    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    castTimer.current -= dt;

    if (windup.current > 0) {
      windup.current -= dt;
      if (windup.current <= 0) {
        // Aim at the feet, leading our own wizard a little.
        const flight = Math.max(0.6, Math.min(1.3, flat / 9));
        aimPoint.x = target.pos.x + (target.isLocal ? playerVelocity.x * flight * 0.6 : 0);
        aimPoint.y = target.pos.y - 0.85;
        aimPoint.z = target.pos.z + (target.isLocal ? playerVelocity.z * flight * 0.6 : 0);
        const from = { x: t.x, y: t.y + 0.55, z: t.z };
        ballistic(from, aimPoint, flight, LOB_GRAVITY, launch);
        castEnemyBolt({
          origin: [from.x, from.y, from.z],
          velocity: [launch[0], launch[1], launch[2]],
          damage: 8 * scale.enemyDamage,
          color: FIRE,
          size: 0.18,
          blastRadius: 1.7,
          blastImpulse: 8,
          gravity: LOB_GRAVITY,
          burn: 3.5,
        });
        flashLight([from.x, from.y, from.z], FIRE, 10);
        castTimer.current = 2.4 + Math.random() * 1.2;
      }
      return;
    }
    if (castTimer.current <= 0 && flat > 2.5 && flat < 14 && !airborne) {
      windup.current = WINDUP;
      b.setLinvel({ x: 0, y: b.linvel().y, z: 0 }, true);
      return;
    }

    // Hop about at a safe distance, circling.
    hopTimer.current -= dt;
    if (hopTimer.current <= 0 && !airborne && knockTimer.current <= 0) {
      hopTimer.current = 0.35 + Math.random() * 0.35;
      const radial = flat > 9 ? 1 : flat < 5 ? -1 : 0.1;
      const nx = dx / flat;
      const nz = dz / flat;
      const side = orbit * (Math.sin(time * 0.7 + phase) > -0.3 ? 1 : -1);
      const s = 4.6;
      b.setLinvel({ x: (nx * radial - nz * side) * s, y: 4.2, z: (nz * radial + nx * side) * s }, true);
      spawnBurst({ position: [t.x, 0.05, t.z], count: 2, color: ["#ff9a4d", "#3a2418"], speed: 1.2, ttl: 0.4, size: 0.05 });
    }
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      linearDamping={0.3}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[RADIUS]} mass={0.8} friction={0.6} collisionGroups={ENEMY_GROUPS} />
      <group ref={facing}>
        <ImpModel rig={rig} eyes={eyes} ember={ember} />
      </group>
    </RigidBody>
  );
}
