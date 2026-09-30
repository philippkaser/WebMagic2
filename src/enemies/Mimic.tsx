import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { playHurt } from "../audio/sound";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition } from "../game/player-state";
import { nearestPlayerTo } from "../game/targets";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { touchPlayer } from "./ai/contact";
import { MotionTracker, turnToward } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { useGlow } from "./models/materials";
import { MimicModel, type MimicRig } from "./models/MimicModel";
import { devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const HALF_H = 0.3;
const REVEAL = 0.6;
/** How close a wizard must come before it springs. */
const TRIGGER = 3.2;
const MAW = "#ff2a3a";

/** Mimic — sits among the remains of the fallen, dressed as a death chest,
 * patient as furniture. Step close (or shoot it) and the lid splits into a
 * mouth, the box swells, and it comes bounding after you, lid chomping.
 * Worth it: it's stuffed with loot. */
export function Mimic({ position, floor, entityId }: EnemyProps) {
  const eye = useGlow(MAW, 3);
  const seam = useRef<MeshStandardMaterial>(null);
  const rig = useMemo<MimicRig>(() => ({ lid: null, fangs: null, tongue: null }), []);
  const facing = useRef<Group>(null);
  const center = useMemo<Vec3>(() => [position[0], position[1] + HALF_H, position[2]], [position]);
  const e = useEnemy({
    entityId,
    floor,
    position: center,
    baseHp: 70,
    hitColor: "#ffcf5a",
    lootChance: 0.9,
    death: {
      centerY: 0,
      burst: ["#c9a23a", "#5a3a22", MAW],
      light: "#ffcf5a",
      gibs: GIBS.wood,
      gibCount: 16,
      force: 5,
    },
  });
  const { body, host, scale, hp, maxHp, deadRef, flash, aggro, knockTimer, interpolate } = e;
  /** 0 = dormant; counts up through the reveal to 1 (every client). */
  const reveal = useRef(0);
  const hopTimer = useRef(0);
  const contactTimer = useRef(0);
  const yaw = useRef(Math.random() * 6);
  const motion = useMemo(() => new MotionTracker(), []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);
    flash.current = Math.max(0, flash.current - dt * 5);

    // Replicas can't see the host's aggro flag, but they see it move or bleed.
    if (!host && reveal.current === 0 && (motion.speed > 0.8 || hp.current < maxHp)) aggro.current = true;
    const awake = aggro.current;
    if (awake && reveal.current === 0) {
      reveal.current = 0.001;
      spawnBurst({ position: [t.x, t.y + 0.3, t.z], count: 20, color: ["#5a3a22", "#c9a23a", "#e9e1c8"], speed: 5, upward: 3, ttl: 0.7, size: 0.08 });
      flashLight([t.x, t.y + 0.4, t.z], MAW, 18);
      if (Math.hypot(playerPosition.x - t.x, playerPosition.z - t.z) < 10) {
        playHurt();
        gameEvents.emit("shake", 0.3);
      }
    }
    if (reveal.current > 0) reveal.current = Math.min(1, reveal.current + dt / REVEAL);
    const r = reveal.current;
    const airborne = t.y > HALF_H + 0.15;

    // ── Look: a chest, until it isn't ───────────────────────────────────────
    if (r > 0) {
      yaw.current = turnToward(yaw.current, Math.atan2(playerPosition.x - t.x, playerPosition.z - t.z), dt * 6);
    }
    if (facing.current) {
      facing.current.rotation.y = yaw.current;
      // Swells as it wakes; shudders on the reveal.
      const s = 1 + r * 0.3 + flash.current * 0.08;
      facing.current.scale.set(s, s, s);
      facing.current.position.x = r > 0 && r < 1 ? Math.sin(time * 70) * 0.04 : 0;
    }
    const chomp = r >= 1 ? (airborne ? 0.9 : 0.5 + Math.abs(Math.sin(time * 9)) * 0.6) : r * 1.2;
    if (rig.lid) rig.lid.rotation.x = -chomp;
    if (rig.fangs) rig.fangs.rotation.x = -chomp;
    if (rig.tongue) {
      rig.tongue.visible = r > 0;
      rig.tongue.rotation.x = 0.2 + Math.sin(time * 5) * 0.25 * r;
      rig.tongue.position.z = -0.1 + r * 0.12;
    }
    eye.emissiveIntensity = r * (3 + flash.current * 4);
    if (seam.current) {
      // Gold like treasure while dormant; a red throat once awake.
      seam.current.emissive.set(r > 0 ? MAW : "#ffcf5a");
      seam.current.emissiveIntensity = r > 0 ? 3 : 2 + Math.sin(time * 2) * 0.4;
    }

    if (r >= 1) {
      contactTimer.current -= dt;
      touchPlayer(t.x, t.y + 0.2, t.z, {
        reach: 1.3,
        damage: 14 * scale.enemyDamage,
        timer: contactTimer,
        cooldown: 0.9,
        knock: 6,
        color: MAW,
      });
    }

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain ─────────────────────────────────────────────────────────
    const target = nearestPlayerTo(t.x, t.y, t.z);
    knockTimer.current -= dt;
    if (!aggro.current || devStage.calm) {
      if (Math.hypot(target.pos.x - t.x, target.pos.z - t.z) < TRIGGER) aggro.current = true;
      return;
    }
    if (r < 1) return;
    hopTimer.current -= dt;
    if (hopTimer.current <= 0 && !airborne && knockTimer.current <= 0) {
      hopTimer.current = 0.5 + Math.random() * 0.2;
      const dx = target.pos.x - t.x;
      const dz = target.pos.z - t.z;
      const flat = Math.hypot(dx, dz) || 1;
      const s = Math.min(6.5, 3 + flat * 0.8);
      b.setLinvel({ x: (dx / flat) * s, y: 5, z: (dz / flat) * s }, true);
      spawnBurst({ position: [t.x, 0.05, t.z], count: 5, color: ["#5a3a22", "#2a1a10"], speed: 2, ttl: 0.4, size: 0.07 });
    }
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={body}
      position={center}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      linearDamping={0.2}
      enabledRotations={[false, false, false]}
    >
      <CuboidCollider args={[0.46, HALF_H, 0.32]} mass={5} friction={0.9} collisionGroups={ENEMY_GROUPS} />
      <group ref={facing} position={[0, -HALF_H, 0]}>
        <MimicModel rig={rig} seam={seam} eye={eye} />
      </group>
    </RigidBody>
  );
}
