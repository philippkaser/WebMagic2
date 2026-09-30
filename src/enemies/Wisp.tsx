import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import { spawnBurst } from "../fx/Particles";
import { playerPosition } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { getStats, useGame } from "../state/gameStore";
import { touchPlayer } from "./ai/contact";
import { MotionTracker, steer, turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { useGlow } from "./models/materials";
import { WispModel, type WispRig } from "./models/WispModel";
import { bandTint, devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const DASH_RANGE = 5.5;
const TELEGRAPH = 0.55;
const DASH_TIME = 0.35;

/** Wisp — a mote of grave-light that remembers being someone. It drifts
 * after the nearest wizard, and when close it swells, brightens — the tell —
 * and lunges. Burns on contact. Tinted by the depth it haunts. */
export function Wisp({ position, floor, entityId }: EnemyProps) {
  const tint = useMemo(() => bandTint(floor), [floor]);
  const glow = useGlow(tint, 1.8);
  const rig = useMemo<WispRig>(() => ({ body: null, motes: null }), []);
  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 30,
    hitColor: "#e9d9ff",
    death: {
      centerY: 0,
      burst: [tint, "#ffffff", "#2a1a44"],
      light: tint,
      gibs: GIBS.shadow,
      gibCount: 6,
      force: 4,
    },
  });
  const { body, host, scale, deadRef, flash, aggro, knockTimer, interpolate } = e;
  const contactTimer = useRef(0);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  /** >0 while winding up a lunge; <0 while lunging (counts up to 0). */
  const lunge = useRef(0);
  const lungeCooldown = useRef(2 + Math.random() * 2);
  const yaw = useRef(0);
  const trail = useRef(0);
  const motion = useMemo(() => new MotionTracker(), []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);

    // ── Look: flicker, swell before a lunge, stare at our wizard ────────────
    flash.current = Math.max(0, flash.current - dt * 5);
    if (host) e.tell.current = lunge.current > 0 ? 1 - lunge.current / TELEGRAPH : 0;
    const windup = e.tell.current; // replicated wind-up
    glow.emissiveIntensity =
      1.6 + Math.sin(time * 9 + phase) * 0.25 + flash.current * 6 + windup * 4;
    if (rig.body) {
      const s = 1 + windup * 0.35 + flash.current * 0.15;
      rig.body.scale.set(s, s * (1 + Math.sin(time * 6 + phase) * 0.06), s);
      yaw.current = turnToward(
        yaw.current,
        Math.atan2(playerPosition.x - t.x, playerPosition.z - t.z),
        dt * 5,
      );
      rig.body.rotation.set(Math.min(motion.speed * 0.05, 0.5), yaw.current, 0);
    }
    if (rig.motes) {
      rig.motes.rotation.y += dt * (2 + windup * 14);
      rig.motes.rotation.x = Math.sin(time * 1.3 + phase) * 0.4;
    }
    trail.current -= dt;
    if (trail.current <= 0 && Math.abs(playerPosition.x - t.x) + Math.abs(playerPosition.z - t.z) < 22) {
      trail.current = 0.09;
      spawnBurst({
        position: [t.x, t.y - 0.1, t.z],
        count: 1,
        color: tint,
        speed: 0.3,
        upward: 0.6,
        ttl: 0.6,
        size: 0.07,
        gravity: 0.5,
        drag: 1,
      });
    }

    contactTimer.current -= dt;
    touchPlayer(t.x, t.y, t.z, {
      reach: 1.45,
      damage: (lunge.current < 0 ? 13 : 9) * scale.enemyDamage,
      timer: contactTimer,
      cooldown: 0.7,
      knock: 5,
      color: tint,
    });

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain: threaten the NEAREST wizard on the floor ────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current || devStage.calm) {
      if (target.dist < 15 * getStats().aggroMult) aggro.current = true;
      b.setLinvel({ x: 0, y: Math.sin(time * 1.4 + phase) * 0.5, z: 0 }, true);
      return;
    }
    if (knockTimer.current > 0) return;

    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    lungeCooldown.current -= dt;

    if (lunge.current > 0) {
      // Wind-up: hang in the air, backing off a touch.
      lunge.current -= dt;
      steer(b, (-dx / flat) * 1.2, (-dz / flat) * 1.2, 6, dt, 0);
      if (lunge.current <= 0) {
        lunge.current = -DASH_TIME;
        const dy = target.pos.y + 0.3 - t.y;
        const d = Math.hypot(dx, dy, dz) || 1;
        const speed = 12 + floor * 0.05;
        b.setLinvel({ x: (dx / d) * speed, y: (dy / d) * speed, z: (dz / d) * speed }, true);
      }
      return;
    }
    if (lunge.current < 0) {
      lunge.current = Math.min(0, lunge.current + dt);
      return; // coast through the lunge
    }
    if (target.dist < DASH_RANGE && lungeCooldown.current <= 0) {
      lunge.current = TELEGRAPH;
      lungeCooldown.current = 3 + Math.random() * 1.5;
      return;
    }

    const speed = 4.3 + floor * 0.07;
    const targetY = target.pos.y + 0.5 + Math.sin(time * 2.1 + phase) * 0.4;
    steer(
      b,
      (dx / flat) * speed,
      (dz / flat) * speed,
      2.8,
      dt,
      Math.max(-3.5, Math.min(3.5, (targetY - t.y) * 2.4)),
    );
  });

  if (e.dead) return null;
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
      <WispModel rig={rig} glow={glow} />
    </RigidBody>
  );
}
