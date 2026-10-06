import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { playBossRoar } from "../../audio/sound";
import { gameEvents } from "../../core/events";
import {
  addLightSource,
  flashLight,
  removeLightSource,
  type DynamicLightSource,
} from "../../fx/DynamicLights";
import { castFlareFx, chargeBurstFx, explosionFx, soulDissolveFx, telegraphFx } from "../../fx/effects";
import { getFloorRules } from "../../game/floorRules";
import { nearestWizardTo } from "../../game/targets";
import { SAVE_FEATHER_ID } from "../../items/catalog";
import { dropGold, dropItem, dropLoot } from "../../items/LootOrbs";
import { ENEMY_GLOW, WARDEN_COLOR, WardenModel } from "../../render/models/enemies";
import { enemyBoom, enemyCast } from "../../weapons/hostileEffects";
import type { Vec3 } from "../../world/types";
import { createMove, type Vec } from "../brains/common";
import {
  createWardenBrain,
  createWardenMoveInput,
  isEnraged,
  tickWardenAttack,
  tickWardenMove,
  WARDEN,
  wardenChargeVelocity,
  wardenRingBolt,
  wardenRingCount,
  wardenVolleyAim,
  wardenVolleyBolt,
  wardenVolleyCount,
} from "../brains/warden";
import { useContactDamage, useEnemy } from "../useEnemy";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { ENEMY_BODIES } from "../../sim/bodies";

/** The boss is a singleton: its net id and HUD bar are fixed. */
const BOSS_ID = "boss";
const BOSS_NAME = "WARDEN OF THE DEEP";
const EMBER = "#ff8b3d";
/** The slam's blast radius (before the floor's explosion rule). */
const WARDEN_SLAM_RADIUS = 5.2;
const UP_AXIS: Vec3 = [0, 1, 0];
const BODY = ENEMY_BODIES.boss;

/** Warden of the Deep — the floor boss (every 10th floor). The authority runs
 * its brain (brains/warden.ts); the replication framework moves its body on
 * replicas, its attacks are host events replayed everywhere, and its health
 * mirrors via replicated fields into the HUD bar. The floor keeps its portals
 * sealed until onDeath fires. */
export function Warden({ position, floor, onDeath }: { position: Vec3; floor: number; onDeath: () => void }) {
  const shell = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const awake = useRef(false);
  const light = useRef<DynamicLightSource | null>(null);
  const brain = useMemo(() => createWardenBrain(), []);
  const move = useMemo(createWardenMoveInput, []);
  const moveOut = useMemo(createMove, []);
  const aim = useMemo<Vec>(() => ({ x: 0, y: 0, z: 0 }), []);
  const dir = useMemo<Vec>(() => ({ x: 0, y: 0, z: 0 }), []);
  const bolt = useMemo<Vec>(() => ({ x: 0, y: 0, z: 0 }), []);

  const e = useEnemy({
    kind: "boss",
    entityId: BOSS_ID,
    position,
    floor,
    hitColor: "#ff8a5a",
    knockbackScale: 0.25,
    flashDecay: 4,
    onDeathFx: (t) => {
      // The boss comes apart in stages: a rolling chain of blasts through
      // its shell, then its soul tears loose and rises.
      const at: Vec3 = [t.x, t.y, t.z];
      soulDissolveFx(at, WARDEN_COLOR, 2.6);
      for (let i = 0; i < 3; i++) {
        const p: Vec3 = [t.x + (Math.random() - 0.5) * 1.6, t.y + (Math.random() - 0.5) * 1.2, t.z + (Math.random() - 0.5) * 1.6];
        setTimeout(() => {
          explosionFx(p, 2.4, i === 1 ? "#ffd9a8" : WARDEN_COLOR, 1.2);
          flashLight(p, WARDEN_COLOR, 30);
        }, i * 170);
      }
      flashLight([t.x, t.y, t.z], WARDEN_COLOR, 60);
      playBossRoar([t.x, t.y + 1.5, t.z]);
      // Guaranteed rich drops for the whole party (host-rolled).
      dropLoot([t.x - 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor + 2);
      dropLoot([t.x + 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor + 2);
      dropGold([t.x, Math.max(t.y, 0.8), t.z - 0.6], floor, 1, "boss");
      // The Warden hoards escapes too — a feather drop is a real prize.
      if (Math.random() < 0.35) dropItem(SAVE_FEATHER_ID, [t.x, Math.max(t.y, 0.8), t.z + 1.4]);
      gameEvents.emit("message", "The Warden falls. The seal breaks.");
      gameEvents.emit("shake", 0.8);
    },
    onKilled: () => {
      gameEvents.emit("bossHp", null);
      onDeath(); // unseal the portals either way
    },
    // Damage (on the authority) or a snapshot (on a replica) also wakes it.
    onHp: (current, maxHp) => {
      if (!awake.current) {
        awake.current = true;
        gameEvents.emit("message", `${BOSS_NAME} wakes`);
      }
      gameEvents.emit("bossHp", { name: BOSS_NAME, frac: Math.max(current / maxHp, 0) });
    },
  });
  // Its bulk burns anyone pressed against it once it's awake (to OUR player).
  const touch = useContactDamage({ range: 2.3, damage: 16, floor, cooldown: 0.9, playerLift: WARDEN.aimLift });

  useEffect(() => {
    const src = addLightSource({ position, color: WARDEN_COLOR, intensity: 8, distance: 13, priority: 2 });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position]);

  // Hide the HUD bar if the floor unmounts mid-fight.
  useEffect(() => () => gameEvents.emit("bossHp", null), []);

  useFrame(({ clock }, dt) => {
    const b = e.beginFrame(dt);
    if (!b) return;
    const time = clock.elapsedTime;
    const enraged = isEnraged(e.hp.current, e.maxHp);
    const pulse = Math.sin(time * 8);
    if (mat.current) {
      mat.current.emissiveIntensity =
        ENEMY_GLOW.warden + e.flash.current * 5 + (enraged ? 0.8 + pulse * 0.4 : 0);
    }
    if (shell.current) shell.current.rotation.y += dt * (enraged ? 1.6 : 0.7);

    const t = b.translation();
    if (light.current) {
      light.current.position.set(t.x, t.y, t.z);
      light.current.intensity = 8 + e.flash.current * 10 + (enraged ? 2 + pulse * 1.5 : 0);
    }
    touch(t, dt, awake.current);

    // Replicas are moved by the net layer; only the authority thinks.
    if (!e.net.isAuthority) return;

    // Authority brain: fight the nearest wizard on the floor.
    const target = nearestWizardTo(t.x, t.y + WARDEN.aimLift, t.z);
    aim.x = target.pos.x - t.x;
    aim.y = target.pos.y + WARDEN.aimLift - t.y;
    aim.z = target.pos.z - t.z;
    const dist = target.dist;

    if (!awake.current) {
      if (dist < WARDEN.wakeRange) {
        awake.current = true;
        playBossRoar([t.x, t.y + 1.5, t.z]);
        gameEvents.emit("message", `${BOSS_NAME} wakes`);
        gameEvents.emit("bossHp", { name: BOSS_NAME, frac: 1 });
        gameEvents.emit("shake", 0.5);
      }
      return;
    }

    // ── Movement ─────────────────────────────────────────────────────────────
    const speedMult = getFloorRules().enemySpeedMult;
    move.pos = t;
    move.vel = b.linvel();
    move.aim = aim;
    move.dist = dist;
    move.homeY = position[1];
    move.time = time;
    move.dt = dt;
    move.enraged = enraged;
    move.speedMult = speedMult;
    if (tickWardenMove(brain, move, moveOut).apply) b.setLinvel(moveOut.vel, true);

    // ── Attacks ──────────────────────────────────────────────────────────────
    const action = tickWardenAttack(brain, dist, enraged, dt);
    if (!action) return;
    if (action === "boom") {
      enemyBoom.announce({ pos: [t.x, t.y, t.z], radius: WARDEN_SLAM_RADIUS, damage: e.damage(20), impulse: 46, color: WARDEN_COLOR });
      return;
    }
    const origin: Vec3 = [t.x, t.y + WARDEN.aimLift, t.z];
    const cast = (damage: number, color: string, size: number) =>
      enemyCast.announce({
        origin,
        velocity: [bolt.x, bolt.y, bolt.z],
        damage,
        color,
        size,
        blastRadius: size > 0.16 ? 1.9 : 1.5,
        blastImpulse: size > 0.16 ? 12 : 9,
      });
    switch (action) {
      case "volley": {
        // Lead the shot — peer poses carry velocity too.
        wardenVolleyAim(aim, dist, target.vel, dir);
        const damage = e.damage(10);
        for (let i = 0, n = wardenVolleyCount(enraged); i < n; i++) {
          wardenVolleyBolt(dir, brain.rand, bolt);
          cast(damage, WARDEN_COLOR, 0.17);
        }
        break;
      }
      case "ring": {
        const damage = e.damage(8);
        for (let i = 0, n = wardenRingCount(enraged); i < n; i++) {
          wardenRingBolt(i, n, bolt);
          cast(damage, EMBER, 0.15);
        }
        flashLight(origin, EMBER, 24);
        castFlareFx(origin, UP_AXIS, EMBER, undefined, 4);
        break;
      }
      case "charge": {
        b.setLinvel(wardenChargeVelocity(aim, speedMult, bolt), true);
        chargeBurstFx(origin, bolt, WARDEN_COLOR);
        break;
      }
      case "slam": {
        // Telegraph: flare up and rumble; the brain detonates it ("boom") later.
        // The warning circle on the floor is drawn at the blast's real
        // (omen-scaled) radius, so what you see is what hits.
        e.flash.current = 1;
        gameEvents.emit("shake", 0.25);
        telegraphFx(t, WARDEN_SLAM_RADIUS * getFloorRules().explosionRadiusMult, WARDEN_COLOR, WARDEN.slamTelegraph);
        break;
      }
    }
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(BODY)} type={e.net.bodyType}>
      <SpecCollider spec={BODY} />
      <WardenModel shellRef={shell} materialRef={mat} />
    </RigidBody>
  );
}
