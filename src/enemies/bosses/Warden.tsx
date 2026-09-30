import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useCallback, useMemo, useRef } from "react";
import { Color, Vector3 } from "three";
import { explode } from "../../combat/damage";
import { gameEvents } from "../../core/events";
import { flashLight } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { playerPosition, playerVelocity } from "../../game/player-state";
import { nearestPlayerTo } from "../../game/targets";
import { session } from "../../net/session";
import { COLLISION } from "../../physics/groups";
import { useGame } from "../../state/gameStore";
import type { Vec3 } from "../../world/types";
import { castEnemyBolt } from "../ai/cast";
import { touchPlayer } from "../ai/contact";
import { GIBS, spawnGibs } from "../fx/gibs";
import { useGlow } from "../models/materials";
import { devStage } from "../shared";
import { useBoss } from "./useBoss";
import { SHARD_COUNT, shardSlot, WardenModel, type WardenRig } from "./WardenModel";

const NAME = "WARDEN OF THE DEEP";
const EMBER = "#ff3d2e";
const WHITE_HOT = "#ffd27a";
const SLAM_TELL = 0.7;

type Attack = "volley" | "ring" | "charge" | "slam" | "spiral";

const slot = { x: 0, y: 0, z: 0 };
const dir = new Vector3();
const seamTarget = new Color(WHITE_HOT);

/** The Warden of the Deep — the old boss of every tenth floor. It hovers,
 * watches you with one enormous eye and fights with volleys, fire rings,
 * charges and a telegraphed slam (its shards clamp shut around the core,
 * then blast out). Broken to half health, its shell bursts open: faster,
 * angrier, and it learns to spin a spiral of fire. */
export function Warden({ position, floor, onDeath }: { position: Vec3; floor: number; onDeath: () => void }) {
  const seams = useGlow(EMBER, 1.6);
  const seamWire = useGlow(EMBER, 1.6, true);
  const iris = useGlow(EMBER, 3);
  const rig = useMemo<WardenRig>(() => ({ eye: null, shards: null, shardPieces: [], crown: null }), []);
  /** Shell-break animation clock (every client): 0 → 1 after the phase break. */
  const breakT = useRef(0);

  const onPhaseBreak = useCallback(() => {
    breakT.current = 0.001;
    const t = b.body.current?.translation();
    if (t) {
      spawnGibs({ position: [t.x, t.y, t.z], count: 16, palette: GIBS.ember, force: 7 });
      spawnBurst({ position: [t.x, t.y, t.z], count: 50, color: [WHITE_HOT, EMBER, "#2a0d0a"], speed: 9, ttl: 1, size: 0.12 });
      flashLight([t.x, t.y, t.z], WHITE_HOT, 50);
    }
    gameEvents.emit("message", "The Warden's shell cracks open!");
    gameEvents.emit("shake", 0.7);
  }, []);

  const b = useBoss({
    floor,
    position,
    name: NAME,
    color: EMBER,
    baseHp: 420,
    fallMessage: "The Warden falls. The seal breaks.",
    gibs: GIBS.stone,
    onDeath,
    onPhaseBreak,
  });
  const { body, host, scale, awake, phase2, flash, light, wake, interpolate } = b;
  const attackTimer = useRef(2.5);
  const charging = useRef(0);
  const slamTell = useRef(0);
  const spiral = useRef({ left: 0, timer: 0, angle: 0 });
  const contactTimer = useRef(0);
  const desired = useMemo(() => new Vector3(), []);
  const aim = useMemo(() => new Vector3(), []);
  const hot = useMemo(() => new Color(), []);

  useFrame(({ clock }, dt) => {
    const rb = body.current;
    if (!rb || b.deadRef.current) return;
    if (useGame.getState().phase !== "dungeon") return;
    const time = clock.elapsedTime;
    const t = rb.translation();
    const enraged = phase2.current;

    // ── Look ────────────────────────────────────────────────────────────────
    flash.current = Math.max(0, flash.current - dt * 4);
    if (breakT.current > 0) breakT.current = Math.min(1, breakT.current + dt * 1.2);
    const brk = breakT.current;
    const tell = slamTell.current > 0 ? 1 - slamTell.current / SLAM_TELL : 0;
    const pulse = enraged ? 0.5 + Math.sin(time * 8) * 0.4 : 0;
    hot.set(EMBER).lerp(seamTarget, brk);
    seams.emissive.copy(hot);
    seamWire.emissive.copy(hot);
    iris.emissive.copy(hot);
    seams.emissiveIntensity = 0.9 + brk * 0.8 + flash.current * 5 + pulse + tell * 4;
    seamWire.emissiveIntensity = seams.emissiveIntensity;
    iris.emissiveIntensity = 3 + flash.current * 4 + tell * 5;
    // The eye tracks OUR wizard on every client.
    if (rig.eye) {
      dir.set(playerPosition.x - t.x, playerPosition.y + 0.3 - t.y, playerPosition.z - t.z).normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)));
      rig.eye.rotation.set(pitch, yaw, 0);
    }
    // Shards orbit; they clamp in for the slam and fly wide once broken
    // (overshooting on the burst, then settling).
    const overshoot = brk > 0 && brk < 1 ? Math.sin(brk * Math.PI) * 1.6 : 0;
    const radius = 1.75 + brk * 1.0 + overshoot - tell * 0.6;
    if (rig.shards) {
      rig.shards.rotation.y += dt * (0.7 + brk * 1.2 + tell * 4);
      rig.shards.rotation.z = Math.sin(time * 0.4) * 0.15;
    }
    for (let i = 0; i < SHARD_COUNT; i++) {
      const piece = rig.shardPieces[i];
      if (!piece) continue;
      shardSlot(i, radius, slot);
      piece.position.set(slot.x, slot.y + Math.sin(time * 2 + i) * 0.08, slot.z);
      // Plates stand upright with their seamed face outward; broken, they
      // tumble end over end.
      piece.rotation.set(brk * (time * 2.5 + i), Math.atan2(slot.x, slot.z), brk * Math.sin(time + i) * 0.6);
    }
    if (rig.crown) rig.crown.scale.setScalar(Math.max(0.001, brk));
    if (light.current) {
      light.current.position.set(t.x, t.y, t.z);
      light.current.intensity = 8 + flash.current * 10 + pulse * 4 + tell * 8;
      light.current.color = enraged ? WHITE_HOT : EMBER;
    }

    contactTimer.current -= dt;
    if (awake.current) {
      touchPlayer(t.x, t.y - 0.4, t.z, {
        reach: 2.4,
        damage: 16 * scale.enemyDamage,
        timer: contactTimer,
        cooldown: 0.9,
        knock: 9,
        color: EMBER,
      });
    }

    if (!host) {
      interpolate(dt);
      return;
    }

    // ── Host brain: fight the nearest wizard on the floor ──────────────────
    const target = nearestPlayerTo(t.x, t.y + 0.4, t.z);
    aim.set(target.pos.x - t.x, target.pos.y + 0.4 - t.y, target.pos.z - t.z);
    const dist = target.dist;
    if (!awake.current) {
      if (dist < 13) wake();
      return;
    }

    // Movement.
    const speed = enraged ? 3.4 : 2.3;
    if (charging.current > 0) {
      charging.current -= dt;
    } else {
      desired.copy(aim).setY(0);
      if (desired.lengthSq() > 0.01) desired.normalize();
      const range = dist > 7.5 ? 1 : dist < 4 ? -0.55 : 0;
      desired.multiplyScalar(speed * range);
      desired.y = (position[1] + Math.sin(time * 1.3) * 0.5 - t.y) * 2;
      const v = rb.linvel();
      const k = 1 - Math.exp(-2 * dt);
      rb.setLinvel({ x: v.x + (desired.x - v.x) * k, y: v.y + (desired.y - v.y) * k, z: v.z + (desired.z - v.z) * k }, true);
    }

    const origin: Vec3 = [t.x, t.y + 0.4, t.z];
    const cast = (velocity: Vec3, damage: number, color: string, size: number) =>
      castEnemyBolt({
        origin,
        velocity,
        damage,
        color,
        size,
        blastRadius: size > 0.16 ? 1.9 : 1.5,
        blastImpulse: size > 0.16 ? 12 : 9,
      });

    // A spiral in progress keeps spinning out bolts.
    const sp = spiral.current;
    if (sp.left > 0) {
      sp.timer -= dt;
      while (sp.timer <= 0 && sp.left > 0) {
        sp.timer += 0.07;
        sp.left--;
        sp.angle += 0.52;
        for (let arm = 0; arm < 2; arm++) {
          const a = sp.angle + arm * Math.PI;
          cast([Math.cos(a) * 10, 0.3, Math.sin(a) * 10], 8 * scale.enemyDamage, WHITE_HOT, 0.14);
        }
      }
      return;
    }

    if (slamTell.current > 0) {
      slamTell.current -= dt;
      if (slamTell.current <= 0) {
        const pos: Vec3 = [t.x, t.y, t.z];
        const damage = 20 * scale.enemyDamage;
        explode({ position: pos, radius: 5.2, damage, impulse: 46, team: "enemy", color: EMBER, particles: 50, light: 50 });
        session.sendEntityEvent({ k: "boom", pos, radius: 5.2, damage, impulse: 46, color: EMBER });
      }
      return;
    }

    attackTimer.current -= dt;
    if (attackTimer.current > 0 || dist > 24 || devStage.calm) return;
    attackTimer.current = enraged ? 1.7 : 2.6;

    switch (pickAttack(dist, enraged)) {
      case "volley": {
        aim.normalize().multiplyScalar(dist);
        // Lead the shot only against our own wizard — peer velocity unknown.
        if (target.isLocal) aim.addScaledVector(playerVelocity, 0.4);
        aim.normalize();
        const projSpeed = 14;
        for (let i = 0; i < (enraged ? 6 : 4); i++) {
          cast(
            [
              (aim.x + (Math.random() - 0.5) * 0.16) * projSpeed,
              (aim.y + (Math.random() - 0.5) * 0.1) * projSpeed,
              (aim.z + (Math.random() - 0.5) * 0.16) * projSpeed,
            ],
            10 * scale.enemyDamage,
            EMBER,
            0.17,
          );
        }
        break;
      }
      case "ring": {
        const count = enraged ? 14 : 10;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          cast([Math.cos(a) * 9, 0.4, Math.sin(a) * 9], 8 * scale.enemyDamage, "#ff8b3d", 0.15);
        }
        flashLight(origin, "#ff8b3d", 24);
        break;
      }
      case "charge": {
        aim.setY(0).normalize();
        rb.setLinvel({ x: aim.x * 13, y: 0.5, z: aim.z * 13 }, true);
        charging.current = 0.7;
        spawnBurst({ position: origin, count: 18, color: EMBER, speed: 4, ttl: 0.5, size: 0.09 });
        break;
      }
      case "slam": {
        slamTell.current = SLAM_TELL;
        flash.current = 1;
        gameEvents.emit("shake", 0.25);
        break;
      }
      case "spiral": {
        sp.left = 22;
        sp.timer = 0.3;
        sp.angle = Math.random() * 6;
        flashLight(origin, WHITE_HOT, 20);
        attackTimer.current = 2.4;
        break;
      }
    }
  });

  if (b.dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
      colliders={false}
      gravityScale={0}
      linearDamping={0.8}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[1.15]} mass={30} collisionGroups={COLLISION.enemy} />
      <WardenModel rig={rig} seams={seams} seamWire={seamWire} iris={iris} />
    </RigidBody>
  );
}

function pickAttack(dist: number, enraged: boolean): Attack {
  if (enraged && Math.random() < 0.25) return "spiral";
  if (dist < 4.5) return Math.random() < 0.65 ? "slam" : "ring";
  if (dist > 12) return Math.random() < 0.6 ? "charge" : "volley";
  const r = Math.random();
  return r < 0.45 ? "volley" : r < 0.75 ? "ring" : "charge";
}
