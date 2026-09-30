import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody } from "@react-three/rapier";
import { useCallback, useMemo, useRef } from "react";
import type { Group } from "three";
import { explode } from "../combat/damage";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { nearestPlayerTo } from "../game/targets";
import { session } from "../net/session";
import { getStats, useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { castEnemyBolt } from "./ai/cast";
import { touchPlayer } from "./ai/contact";
import { MotionTracker, steer, turnToward, wrapAngle } from "./ai/steering";
import { GIBS } from "./fx/gibs";
import { GolemModel, type GolemRig } from "./models/GolemModel";
import { useGlow } from "./models/materials";
import { devStage, ENEMY_GROUPS, type EnemyProps } from "./shared";
import { useEnemy } from "./useEnemy";

const CYAN = "#7fe8ff";
const STOMP_WINDUP = 0.9;
const VOLLEY_WINDUP = 0.6;
const STOMP_RADIUS = 3.6;
/** Damage multipliers by where a hit lands. */
const FRONT_MULT = 0.15;
const BACK_MULT = 1.75;

type Attack = "none" | "stomp" | "volley" | "recover";
type Impulse = { x: number; y: number; z: number };

/** Which side of a body facing `yaw` a hit came from: 1 = front, -1 = back,
 * 0 = flank. `impulse` points away from the source. */
function hitSide(yaw: number, impulse: Impulse): number {
  const len = Math.hypot(impulse.x, impulse.z);
  if (len < 1e-3) return 0;
  const d = -(impulse.x * Math.sin(yaw) + impulse.z * Math.cos(yaw)) / len;
  return d > 0.35 ? 1 : d < -0.35 ? -1 : 0;
}

/** Crystal golem — slow, massive, and armored in front: spells splash off
 * its crystal shield for a fraction of their damage. It turns ponderously,
 * so the answer is to get behind it, where its geode heart is exposed.
 * Up close it raises both fists (the tell) and stomps a shockwave; at range
 * its shoulder crystals kindle and it hurls shards. */
export function Golem({ position, floor, entityId }: EnemyProps) {
  const eye = useGlow(CYAN, 2.4);
  const heart = useGlow("#ff5ad0", 2.6);
  const rig = useMemo<GolemRig>(
    () => ({ torso: null, armL: null, armR: null, legL: null, legR: null }),
    [],
  );
  const facing = useRef<Group>(null);
  const yaw = useRef(Math.random() * 6);
  const heartFlash = useRef(0);

  const damageFilter = useCallback((damage: number, impulse: Impulse) => {
    const side = hitSide(yaw.current, impulse);
    return side === 1 ? damage * FRONT_MULT : side === -1 ? damage * BACK_MULT : damage;
  }, []);

  const onHitFx = useCallback((impulse: Impulse) => {
    // `e` is assigned below; this only runs once hits start landing.
    const b = e.body.current?.translation();
    if (!b) return;
    const side = hitSide(yaw.current, impulse);
    if (side === 1) {
      // Ricochet: bright sparks spray off the shield face.
      const fx = Math.sin(yaw.current);
      const fz = Math.cos(yaw.current);
      spawnBurst({
        position: [b.x + fx * 0.8, b.y + 0.1, b.z + fz * 0.8],
        count: 14,
        color: [CYAN, "#ffffff"],
        speed: 7,
        upward: 1,
        ttl: 0.35,
        size: 0.06,
      });
    } else if (side === -1) {
      heartFlash.current = 1;
    }
  }, []);

  const e = useEnemy({
    entityId,
    floor,
    position,
    baseHp: 150,
    hitColor: "#b8f4ff",
    knockbackScale: 0.15,
    lootChance: 0.4,
    damageFilter,
    onHitFx,
    death: {
      centerY: 0.2,
      burst: [CYAN, "#ffffff", "#232633"],
      light: CYAN,
      gibs: GIBS.crystal,
      gibCount: 18,
      force: 6,
    },
  });
  const { body, host, scale, deadRef, flash, aggro, knockTimer, interpolate } = e;
  const attack = useRef<Attack>("none");
  const attackTimer = useRef(0);
  const cooldown = useRef(2);
  const contactTimer = useRef(0);
  const gait = useRef(0);
  const motion = useMemo(() => new MotionTracker(), []);

  useFrame(({ clock }, dt) => {
    const b = body.current;
    if (!b || deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = b.translation();
    motion.update(t.x, t.y, t.z, dt);

    // Replicas face their own nearest wizard, like the host's brain does —
    // close enough for local ricochet sparks.
    if (!host) {
      const near = nearestPlayerTo(t.x, t.y, t.z);
      yaw.current = turnToward(yaw.current, Math.atan2(near.pos.x - t.x, near.pos.z - t.z), dt * 1.1);
    }

    // ── Look ────────────────────────────────────────────────────────────────
    flash.current = Math.max(0, flash.current - dt * 4);
    heartFlash.current = Math.max(0, heartFlash.current - dt * 3);
    // Replicated wind-up: positive = stomp, negative = shard volley.
    if (host) {
      e.tell.current =
        attack.current === "stomp"
          ? 1 - attackTimer.current / STOMP_WINDUP
          : attack.current === "volley"
            ? -(1 - attackTimer.current / VOLLEY_WINDUP)
            : 0;
    }
    const winding = Math.abs(e.tell.current);
    eye.emissiveIntensity = 2.2 + flash.current * 3 + winding * 5;
    heart.emissiveIntensity = 2.4 + Math.sin(time * 3) * 0.6 + heartFlash.current * 8;
    if (facing.current) facing.current.rotation.y = yaw.current;
    gait.current += dt * (1 + motion.speed * 2.2);
    const stride = Math.min(1, motion.speed / 1.2);
    const swing = Math.sin(gait.current);
    if (rig.legL) rig.legL.rotation.x = swing * 0.35 * stride;
    if (rig.legR) rig.legR.rotation.x = -swing * 0.35 * stride;
    const stomp = Math.max(0, e.tell.current);
    const volley = Math.max(0, -e.tell.current);
    if (rig.torso) {
      rig.torso.rotation.z = swing * 0.05 * stride;
      rig.torso.rotation.x = -stomp * 0.3 + (attack.current === "recover" ? 0.25 : 0);
      rig.torso.position.y = stomp * 0.15;
    }
    if (rig.armL) rig.armL.rotation.set(-0.15 - swing * 0.3 * stride - stomp * 2.6, 0, -volley * 0.6);
    if (rig.armR) rig.armR.rotation.set(-0.15 + swing * 0.3 * stride - stomp * 2.6, 0, volley * 0.6);

    contactTimer.current -= dt;
    touchPlayer(t.x, t.y, t.z, {
      reach: 1.5,
      damage: 8 * scale.enemyDamage,
      timer: contactTimer,
      cooldown: 1,
      knock: 6,
      color: CYAN,
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
      steer(b, 0, 0, 4, dt);
      return;
    }
    const dx = target.pos.x - t.x;
    const dz = target.pos.z - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(dx, dz);
    attackTimer.current -= dt;
    cooldown.current -= dt;

    switch (attack.current) {
      case "none": {
        // Ponderous turning is the whole point: flank it.
        yaw.current = turnToward(yaw.current, want, dt * 1.1);
        const facingErr = Math.abs(wrapAngle(want - yaw.current));
        if (cooldown.current <= 0 && flat < 3.4) {
          attack.current = "stomp";
          attackTimer.current = STOMP_WINDUP;
          return;
        }
        if (cooldown.current <= 0 && flat > 5 && flat < 16 && facingErr < 0.5) {
          attack.current = "volley";
          attackTimer.current = VOLLEY_WINDUP;
          return;
        }
        const speed = facingErr < 0.9 && flat > 2.2 ? 1.8 + floor * 0.008 : 0;
        steer(b, Math.sin(yaw.current) * speed, Math.cos(yaw.current) * speed, 3, dt);
        return;
      }
      case "stomp":
        steer(b, 0, 0, 8, dt);
        if (attackTimer.current <= 0) {
          const pos: Vec3 = [t.x, 0.2, t.z];
          const damage = 16 * scale.enemyDamage;
          explode({ position: pos, radius: STOMP_RADIUS, damage, impulse: 34, team: "enemy", color: CYAN, particles: 36, light: 30 });
          session.sendEntityEvent({ k: "boom", pos, radius: STOMP_RADIUS, damage, impulse: 34, color: CYAN });
          spawnBurst({ position: pos, count: 20, color: ["#3b4050", "#7fe8ff"], speed: 6, upward: 3, ttl: 0.8, size: 0.1 });
          attack.current = "recover";
          attackTimer.current = 1;
        }
        return;
      case "volley":
        yaw.current = turnToward(yaw.current, want, dt * 0.6);
        steer(b, 0, 0, 8, dt);
        if (attackTimer.current <= 0) {
          const speed = 17;
          for (let i = 0; i < 3; i++) {
            const side = i === 0 ? -1 : i === 1 ? 1 : 0;
            const ox = t.x + Math.cos(yaw.current) * 0.8 * side;
            const oz = t.z - Math.sin(yaw.current) * 0.8 * side;
            const oy = t.y + (side === 0 ? 0.9 : 0.8);
            const ax = target.pos.x - ox;
            const ay = target.pos.y - oy;
            const az = target.pos.z - oz;
            const d = Math.hypot(ax, ay, az) || 1;
            castEnemyBolt({
              origin: [ox, oy, oz],
              velocity: [(ax / d) * speed + side * 0.8, (ay / d) * speed, (az / d) * speed],
              damage: 9 * scale.enemyDamage,
              color: CYAN,
              size: 0.14,
              blastRadius: 1.5,
              blastImpulse: 9,
            });
          }
          flashLight([t.x, t.y + 0.8, t.z], CYAN, 14);
          attack.current = "recover";
          attackTimer.current = 0.6;
        }
        return;
      case "recover":
        steer(b, 0, 0, 6, dt);
        if (attackTimer.current <= 0) {
          attack.current = "none";
          cooldown.current = 2.4 + Math.random() * 1.2;
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
      linearDamping={0.8}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider args={[0.5, 0.65]} mass={30} friction={0.3} collisionGroups={ENEMY_GROUPS} />
      <group ref={facing}>
        <GolemModel rig={rig} eye={eye} heart={heart} />
      </group>
    </RigidBody>
  );
}
