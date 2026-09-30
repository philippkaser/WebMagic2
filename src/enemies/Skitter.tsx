import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { spawnBurst } from "../fx/Particles";
import { playerPosition } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { getStats, useGame } from "../state/gameStore";
import { touchPlayer } from "./ai/contact";
import { ballistic, MotionTracker, steer, turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { useGlow } from "./models/materials";
import { SkitterModel, type SkitterRig } from "./models/SkitterModel";
import { devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const RADIUS = 0.35;
const CROUCH = 0.45;
const LEAP_TIME = 0.62;
const EYES = "#ff4a2a";

type Mode = "chase" | "crouch" | "air" | "recover";

/** Bone skitter — scuttles low and fast, zig-zagging, then crouches (the
 * tell: legs splay, sockets flare) and leaps in a real ballistic arc at the
 * nearest wizard. Light enough that a blast sends it cartwheeling; on death
 * it bursts into a spray of bones. */
export function Skitter({ position, floor, entityId }: EnemyProps) {
  const glow = useGlow(EYES, 2.2);
  const rig = useMemo<SkitterRig>(() => ({ body: null, jaw: null, legs: [] }), []);
  const facing = useRef<Group>(null);
  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 22,
    hitColor: "#efe6cc",
    death: {
      centerY: 0,
      burst: ["#d8cdb0", "#8d8266", EYES],
      light: EYES,
      gibs: GIBS.bone,
      gibCount: 14,
      force: 5.5,
    },
  });
  const { body, host, scale, deadRef, flash, aggro, knockTimer, interpolate } = e;
  const mode = useRef<Mode>("chase");
  const modeTimer = useRef(0);
  const leapCooldown = useRef(1.5 + Math.random() * 2);
  const contactTimer = useRef(0);
  const yaw = useRef(Math.random() * 6);
  const gait = useRef(Math.random() * 6);
  const zig = useMemo(() => Math.random() * 6, []);
  const motion = useMemo(() => new MotionTracker(), []);
  const launch = useMemo<[number, number, number]>(() => [0, 0, 0], []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);
    const airborne = t.y > RADIUS + 0.25;

    // ── Look ────────────────────────────────────────────────────────────────
    flash.current = Math.max(0, flash.current - dt * 5);
    const crouch = mode.current === "crouch" ? 1 - modeTimer.current / CROUCH : 0;
    glow.emissiveIntensity = 2 + flash.current * 6 + crouch * 5;
    if (motion.speed > 0.6) {
      yaw.current = turnToward(yaw.current, Math.atan2(motion.vx, motion.vz), dt * 10);
    } else {
      yaw.current = turnToward(yaw.current, Math.atan2(playerPosition.x - t.x, playerPosition.z - t.z), dt * 4);
    }
    if (facing.current) facing.current.rotation.y = yaw.current;
    gait.current += dt * (4 + motion.speed * 3.2);
    if (rig.body) {
      rig.body.position.y = -crouch * 0.14 + (airborne ? 0 : Math.abs(Math.sin(gait.current)) * 0.03);
      rig.body.rotation.x = airborne ? Math.max(-0.6, Math.min(0.6, -motion.vy * 0.06)) : crouch * 0.18;
      rig.body.rotation.z = Math.sin(gait.current * 0.5) * 0.05;
    }
    if (rig.jaw) rig.jaw.rotation.x = airborne || crouch > 0 ? 0.55 : Math.max(0, Math.sin(time * 11 + zig)) * 0.25;
    for (let i = 0; i < 6; i++) {
      const leg = rig.legs[i];
      if (!leg) continue;
      // Alternating tripods: legs 0,2,4 vs 1,3,5 (across both sides).
      const tri = (i + (i >= 3 ? 1 : 0)) % 2 === 0 ? 0 : Math.PI;
      const walk = Math.min(1, motion.speed / 3);
      leg.rotation.y = Math.sin(gait.current + tri) * 0.4 * walk;
      leg.rotation.z = airborne
        ? 0.7
        : crouch * -0.35 + Math.max(0, Math.cos(gait.current + tri)) * 0.35 * walk;
    }

    contactTimer.current -= dt;
    touchPlayer(t.x, t.y, t.z, {
      reach: 1.05,
      damage: (airborne ? 12 : 7) * scale.enemyDamage,
      timer: contactTimer,
      cooldown: 0.8,
      knock: airborne ? 7 : 4,
      color: "#d8cdb0",
    });

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain ─────────────────────────────────────────────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current || devStage.calm) {
      if (target.dist < 13 * getStats().aggroMult) aggro.current = true;
      return;
    }
    modeTimer.current -= dt;
    leapCooldown.current -= dt;
    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;

    switch (mode.current) {
      case "chase": {
        if (knockTimer.current > 0 || airborne) return;
        if (flat > 3 && flat < 7.5 && leapCooldown.current <= 0) {
          mode.current = "crouch";
          modeTimer.current = CROUCH;
          return;
        }
        // Zig-zag: weave sideways so it's a harder target.
        const weave = Math.sin(time * 3.2 + zig) * (flat > 3 ? 0.7 : 0.1);
        const speed = 5.2 + floor * 0.04;
        const nx = dx / flat;
        const nz = dz / flat;
        steer(b, (nx - nz * weave) * speed, (nz + nx * weave) * speed, 8, dt);
        return;
      }
      case "crouch":
        steer(b, 0, 0, 12, dt);
        if (modeTimer.current <= 0) {
          ballistic(t, { x: target.pos.x, y: target.pos.y - 0.4, z: target.pos.z }, LEAP_TIME, 1, launch);
          b.setLinvel({ x: launch[0], y: launch[1], z: launch[2] }, true);
          mode.current = "air";
          modeTimer.current = 0.25; // leave the ground before landing counts
          spawnBurst({ position: [t.x, 0.05, t.z], count: 8, color: "#6b6152", speed: 2, ttl: 0.5, size: 0.07 });
        }
        return;
      case "air":
        if (modeTimer.current <= 0 && !airborne) {
          mode.current = "recover";
          modeTimer.current = 0.5;
          leapCooldown.current = 2.2 + Math.random() * 1.5;
        }
        return;
      case "recover":
        steer(b, 0, 0, 6, dt);
        if (modeTimer.current <= 0) mode.current = "chase";
        return;
    }
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      linearDamping={0.2}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[RADIUS]} mass={1.5} friction={0.1} collisionGroups={ENEMY_GROUPS} />
      <group ref={facing}>
        <SkitterModel rig={rig} glow={glow} />
      </group>
    </RigidBody>
  );
}
