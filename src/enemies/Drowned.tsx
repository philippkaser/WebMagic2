import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { explode } from "../combat/damage";
import { spawnBurst } from "../fx/Particles";
import { nearestPlayerTo } from "../game/targets";
import { session } from "../net/session";
import { getStats, useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { touchPlayer } from "./ai/contact";
import { MotionTracker, steer, turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { DrownedModel, type DrownedRig } from "./models/DrownedModel";
import { useGlow } from "./models/materials";
import { devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const SEA = "#3fe0c0";
const RAISE = 0.8;
const STRIKE = 0.12;
const RECOVER = 0.9;
const SLAM_REACH = 1.4;
const SLAM_RADIUS = 2.7;

type Attack = "none" | "raise" | "strike" | "recover";

/** The Drowned — a heavy, shambling brute of the flooded crypts. Shrugs off
 * most knockback (it's mostly water and iron), shoulders crates aside as it
 * walks, and when close it heaves its anchor overhead — the tell — and brings
 * it down in a slam that hurls wizards and props alike. */
export function Drowned({ position, floor, entityId }: EnemyProps) {
  const eyes = useGlow(SEA, 2.4);
  const lure = useGlow(SEA, 3);
  const rig = useMemo<DrownedRig>(
    () => ({ torso: null, armL: null, armR: null, legL: null, legR: null, lure: null }),
    [],
  );
  const facing = useRef<Group>(null);
  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 110,
    hitColor: "#9fe8d8",
    knockbackScale: 0.3,
    lootChance: 0.35,
    death: {
      centerY: 0.2,
      burst: [SEA, "#c8fff2", "#1e2a26"],
      light: SEA,
      gibs: GIBS.silt,
      gibCount: 16,
      force: 4.5,
    },
  });
  const { body, host, scale, deadRef, flash, aggro, knockTimer, interpolate } = e;
  const attack = useRef<Attack>("none");
  const attackTimer = useRef(0);
  const slamCooldown = useRef(1);
  const contactTimer = useRef(0);
  const yaw = useRef(Math.random() * 6);
  const gait = useRef(Math.random() * 6);
  const drip = useRef(0);
  const motion = useMemo(() => new MotionTracker(), []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);

    // ── Look ────────────────────────────────────────────────────────────────
    flash.current = Math.max(0, flash.current - dt * 4);
    const raising = attack.current === "raise" ? 1 - attackTimer.current / RAISE : 0;
    eyes.emissiveIntensity = 2.2 + flash.current * 5 + raising * 5;
    lure.emissiveIntensity = 2.6 + Math.sin(time * 2.3) * 0.8 + raising * 6;
    if (!host && motion.speed > 0.3) {
      yaw.current = turnToward(yaw.current, Math.atan2(motion.vx, motion.vz), dt * 2.5);
    }
    if (facing.current) facing.current.rotation.y = yaw.current;
    gait.current += dt * (1.5 + motion.speed * 2.2);
    const stride = Math.min(1, motion.speed / 1.5);
    const swing = Math.sin(gait.current);
    if (rig.legL) rig.legL.rotation.x = swing * 0.45 * stride;
    if (rig.legR) rig.legR.rotation.x = -swing * 0.45 * stride;
    if (rig.torso) {
      rig.torso.rotation.z = swing * 0.09 * stride + Math.sin(time * 0.7) * 0.03;
      rig.torso.rotation.x = -raising * 0.35 + (attack.current === "strike" || attack.current === "recover" ? 0.3 : 0);
      rig.torso.position.y = -0.2 + Math.abs(Math.cos(gait.current)) * 0.05 * stride;
    }
    let armX = -0.35 + Math.sin(gait.current + 0.6) * 0.25 * stride;
    if (attack.current === "raise") armX = -0.35 - raising * 2.5;
    else if (attack.current === "strike") armX = -1.1;
    else if (attack.current === "recover") armX = -1.1 + (1 - attackTimer.current / RECOVER) * 0.75;
    if (rig.armL) rig.armL.rotation.x = armX - Math.sin(gait.current) * 0.15 * stride;
    if (rig.armR) rig.armR.rotation.x = armX + Math.sin(gait.current) * 0.15 * stride;
    if (rig.lure) rig.lure.position.x = Math.sin(time * 1.6) * 0.08;

    drip.current -= dt;
    if (drip.current <= 0) {
      drip.current = 0.25 + Math.random() * 0.3;
      spawnBurst({
        position: [t.x + (Math.random() - 0.5) * 0.7, t.y + 0.3, t.z + (Math.random() - 0.5) * 0.7],
        count: 1,
        color: ["#6fd8c4", "#1e4a44"],
        speed: 0.2,
        upward: 0,
        ttl: 0.6,
        size: 0.05,
        gravity: -12,
      });
    }

    // A shove more than a wound: it walks *through* you.
    contactTimer.current -= dt;
    touchPlayer(t.x, t.y + 0.2, t.z, {
      reach: 1.35,
      damage: 6 * scale.enemyDamage,
      timer: contactTimer,
      cooldown: 0.9,
      knock: 7,
      lift: 2.5,
      color: SEA,
    });

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain ─────────────────────────────────────────────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current || devStage.calm) {
      if (target.dist < 12 * getStats().aggroMult) aggro.current = true;
      steer(b, 0, 0, 4, dt);
      return;
    }
    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    attackTimer.current -= dt;
    slamCooldown.current -= dt;

    switch (attack.current) {
      case "none": {
        yaw.current = turnToward(yaw.current, Math.atan2(dx, dz), dt * 2.2);
        if (flat < SLAM_REACH + 1.3 && slamCooldown.current <= 0) {
          attack.current = "raise";
          attackTimer.current = RAISE;
          return;
        }
        if (knockTimer.current > 0) return;
        // Lurching gait: surges on each step.
        const speed = (2.1 + floor * 0.015) * (0.6 + Math.abs(Math.sin(gait.current)) * 0.8);
        const fx = Math.sin(yaw.current);
        const fz = Math.cos(yaw.current);
        steer(b, fx * speed, fz * speed, 5, dt);
        return;
      }
      case "raise":
        // Committed: it can still turn a little to track you.
        yaw.current = turnToward(yaw.current, Math.atan2(dx, dz), dt * 0.9);
        steer(b, 0, 0, 8, dt);
        if (attackTimer.current <= 0) {
          attack.current = "strike";
          attackTimer.current = STRIKE;
        }
        return;
      case "strike":
        if (attackTimer.current <= 0) {
          const pos: Vec3 = [
            t.x + Math.sin(yaw.current) * SLAM_REACH,
            0.3,
            t.z + Math.cos(yaw.current) * SLAM_REACH,
          ];
          const damage = 15 * scale.enemyDamage;
          explode({ position: pos, radius: SLAM_RADIUS, damage, impulse: 30, team: "enemy", color: SEA, particles: 30, light: 24 });
          session.sendEntityEvent({ k: "boom", pos, radius: SLAM_RADIUS, damage, impulse: 30, color: SEA });
          spawnBurst({ position: pos, count: 24, color: ["#c8fff2", "#3fe0c0", "#1e2a26"], speed: 5, upward: 5, ttl: 0.8, size: 0.09 });
          attack.current = "recover";
          attackTimer.current = RECOVER;
        }
        return;
      case "recover":
        steer(b, 0, 0, 8, dt);
        if (attackTimer.current <= 0) {
          attack.current = "none";
          slamCooldown.current = 1.6 + Math.random();
        }
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
      linearDamping={0.6}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider args={[0.45, 0.45]} mass={14} friction={0.2} collisionGroups={ENEMY_GROUPS} />
      <group ref={facing}>
        <DrownedModel rig={rig} eyes={eyes} lure={lure} />
      </group>
    </RigidBody>
  );
}
