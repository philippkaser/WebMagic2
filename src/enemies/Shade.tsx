import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody, useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, MeshStandardMaterial, type Group } from "three";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition, playerVelocity } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { getStats, useGame } from "../state/gameStore";
import { castEnemyBolt } from "./ai/cast";
import { MotionTracker, steer, turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { useGlow } from "./models/materials";
import { ShadeModel, type ShadeRig } from "./models/ShadeModel";
import { devStage, ENEMY_GROUPS, WALLS_ONLY, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const VIOLET = "#a77bff";
const FADE = 0.35;
const CAST = 0.65;
const HOVER = 1.5;

type Mode = "drift" | "fadeOut" | "fadeIn" | "cast";

/** Shade — what's left when a wizard's shadow outlives them. It never lets
 * you close in: it flickers out and reappears somewhere around you, then its
 * hands kindle (the tell) and it looses a slow fan of night-bolts. Weightless
 * — a blast flings it across the room. */
export function Shade({ position, floor, entityId }: EnemyProps) {
  const glow = useGlow(VIOLET, 2.4);
  const cloth = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#0e0a1a",
        emissive: "#241245",
        emissiveIntensity: 0.6,
        roughness: 0.9,
        flatShading: true,
        transparent: true,
        opacity: 0.86,
        side: DoubleSide,
      }),
    [],
  );
  useEffect(() => () => cloth.dispose(), [cloth]);
  const rig = useMemo<ShadeRig>(() => ({ robe: null, handL: null, handR: null }), []);
  const facing = useRef<Group>(null);
  const root = useRef<Group>(null);
  const { world, rapier } = useRapier();
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 42,
    hitColor: "#d7c2ff",
    knockbackScale: 1.3,
    death: {
      centerY: 0,
      burst: [VIOLET, "#2a1a44", "#000000"],
      light: VIOLET,
      gibs: GIBS.shadow,
      gibCount: 12,
      force: 3.5,
    },
  });
  const { body, host, scale, deadRef, flash, aggro, knockTimer, interpolate } = e;
  const mode = useRef<Mode>("drift");
  const modeTimer = useRef(0);
  const blinkCooldown = useRef(2 + Math.random() * 2);
  /** Local (every client) fade-in after a teleport. */
  const appear = useRef(1);
  const yaw = useRef(0);
  const orbit = useMemo(() => (Math.random() < 0.5 ? -1 : 1), []);
  const phase = useMemo(() => Math.random() * 6, []);
  const motion = useMemo(() => new MotionTracker(), []);

  const puff = (x: number, y: number, z: number) => {
    spawnBurst({ position: [x, y, z], count: 16, color: [VIOLET, "#1a0d33", "#000000"], speed: 3, upward: 0.5, ttl: 0.6, size: 0.1, gravity: 0 });
  };

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);

    // ── Look: flicker, fade on blink, hands kindle before a cast ───────────
    flash.current = Math.max(0, flash.current - dt * 5);
    appear.current = Math.min(1, appear.current + dt / FADE);
    let vis = appear.current;
    if (mode.current === "fadeOut") vis = Math.max(0, modeTimer.current / FADE);
    const flicker = Math.sin(time * 23 + phase) > 0.92 ? 0.4 : 1;
    cloth.opacity = 0.86 * vis * flicker;
    const casting = mode.current === "cast" ? 1 - modeTimer.current / CAST : 0;
    glow.emissiveIntensity = (2.2 + flash.current * 6 + casting * 6) * vis;
    if (root.current) root.current.scale.setScalar(0.6 + vis * 0.4);
    yaw.current = turnToward(yaw.current, Math.atan2(playerPosition.x - t.x, playerPosition.z - t.z), dt * 4);
    if (facing.current) facing.current.rotation.y = yaw.current;
    if (rig.robe) {
      rig.robe.rotation.x = Math.max(-0.4, Math.min(0.4, motion.speed * 0.06));
      rig.robe.position.y = Math.sin(time * 1.8 + phase) * 0.08;
    }
    const lift = casting * 0.35;
    if (rig.handL) {
      rig.handL.position.set(-0.6 + casting * 0.2, Math.sin(time * 2.4 + phase) * 0.1 + lift, 0.2 + casting * 0.3);
      rig.handL.rotation.z = time * 2;
    }
    if (rig.handR) {
      rig.handR.position.set(0.6 - casting * 0.2, Math.sin(time * 2.4 + phase + 1.5) * 0.1 + lift, 0.2 + casting * 0.3);
      rig.handR.rotation.z = -time * 2;
    }

    if (!host) {
      if (interpolate(dt)) {
        appear.current = 0;
        const p = b.translation();
        puff(p.x, p.y, p.z);
      }
      return;
    }

    // ── Host brain ─────────────────────────────────────────────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current || devStage.calm) {
      if (target.dist < 16 * getStats().aggroMult) aggro.current = true;
      steer(b, 0, 0, 3, dt, (position[1] + Math.sin(time + phase) * 0.2 - t.y) * 2);
      return;
    }
    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    modeTimer.current -= dt;
    blinkCooldown.current -= dt;
    const hoverVy = (target.pos.y - 0.9 + HOVER - t.y) * 2;

    switch (mode.current) {
      case "drift": {
        if (blinkCooldown.current <= 0 || (flat < 3 && blinkCooldown.current < 1.5)) {
          mode.current = "fadeOut";
          modeTimer.current = FADE;
          return;
        }
        if (knockTimer.current > 0) return;
        // Keep a wary 6–9m, circling.
        const radial = flat > 9 ? 1 : flat < 6 ? -1 : 0;
        const nx = dx / flat;
        const nz = dz / flat;
        const s = 3;
        steer(b, (nx * radial - nz * orbit * 0.8) * s, (nz * radial + nx * orbit * 0.8) * s, 2.5, dt, hoverVy);
        return;
      }
      case "fadeOut":
        steer(b, 0, 0, 6, dt, 0);
        if (modeTimer.current <= 0) {
          puff(t.x, t.y, t.z);
          blinkTo(target.pos.x, target.pos.y, target.pos.z);
          mode.current = "fadeIn";
          modeTimer.current = FADE;
          appear.current = 0;
        }
        return;
      case "fadeIn":
        steer(b, 0, 0, 6, dt, 0);
        if (modeTimer.current <= 0) {
          mode.current = "cast";
          modeTimer.current = CAST;
        }
        return;
      case "cast":
        steer(b, 0, 0, 6, dt, hoverVy);
        if (modeTimer.current <= 0) {
          fan(t.x, t.y, t.z, target.pos.x, target.pos.y, target.pos.z, target.isLocal);
          mode.current = "drift";
          blinkCooldown.current = 3 + Math.random() * 1.5;
        }
        return;
    }

    /** Reappear on a ring around the target, never inside a wall. */
    function blinkTo(px: number, py: number, pz: number) {
      const a = Math.random() * Math.PI * 2;
      let d = 5 + Math.random() * 3;
      const ox = px;
      const oy = py + 0.6;
      const oz = pz;
      ray.origin = { x: ox, y: oy, z: oz };
      ray.dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      const hit = world.castRay(ray, d, true, undefined, WALLS_ONLY);
      if (hit) d = Math.max(1.5, hit.timeOfImpact - 0.9);
      const nx = ox + Math.cos(a) * d;
      const nz = oz + Math.sin(a) * d;
      b!.setTranslation({ x: nx, y: py - 0.9 + HOVER, z: nz }, true);
      b!.setLinvel({ x: 0, y: 0, z: 0 }, true);
      puff(nx, py - 0.9 + HOVER, nz);
    }

    function fan(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, local: boolean) {
      let ax = tx - sx;
      let ay = ty - sy;
      let az = tz - sz;
      if (local) {
        // Gentle lead on our own wizard; peers' velocities are unknown.
        ax += playerVelocity.x * 0.5;
        az += playerVelocity.z * 0.5;
      }
      const d = Math.hypot(ax, ay, az) || 1;
      ax /= d;
      ay /= d;
      az /= d;
      const speed = 7.5 + floor * 0.03;
      for (let i = -1; i <= 1; i++) {
        const spread = i * 0.22;
        const c = Math.cos(spread);
        const s = Math.sin(spread);
        const vx = ax * c - az * s;
        const vz = ax * s + az * c;
        castEnemyBolt({
          origin: [sx + vx * 0.5, sy + 0.1, sz + vz * 0.5],
          velocity: [vx * speed, ay * speed, vz * speed],
          damage: 9 * scale.enemyDamage,
          color: VIOLET,
          size: 0.17,
          blastRadius: 1.6,
          blastImpulse: 8,
        });
      }
      flashLight([sx, sy, sz], VIOLET, 12);
    }
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      gravityScale={0}
      linearDamping={1.2}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[0.45]} mass={1} collisionGroups={ENEMY_GROUPS} />
      <group ref={root}>
        <group ref={facing}>
          <ShadeModel rig={rig} cloth={cloth} glow={glow} />
        </group>
      </group>
    </RigidBody>
  );
}
