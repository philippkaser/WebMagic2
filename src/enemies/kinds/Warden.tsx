import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
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
import { spawnBurst } from "../../fx/Particles";
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
import { ENEMY_GROUPS, useContactDamage, useEnemy } from "../useEnemy";

/** The boss is a singleton: its net id and HUD bar are fixed. */
const BOSS_ID = "boss";
const BOSS_NAME = "WARDEN OF THE DEEP";
const EMBER = "#ff8b3d";

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
    knockbackScale: 0.25,
    flashDecay: 4,
    onDeathFx: (t) => {
      for (let i = 0; i < 3; i++) {
        spawnBurst({
          position: [t.x + (Math.random() - 0.5), t.y + (Math.random() - 0.5), t.z + (Math.random() - 0.5)],
          count: 40,
          color: [WARDEN_COLOR, "#ffd9a8", "#2a0d0a"],
          speed: 8,
          ttl: 1.1,
          size: 0.13,
        });
      }
      flashLight([t.x, t.y, t.z], WARDEN_COLOR, 60);
      playBossRoar();
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
        playBossRoar();
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
      enemyBoom.announce({ pos: [t.x, t.y, t.z], radius: 5.2, damage: e.damage(20), impulse: 46, color: WARDEN_COLOR });
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
        break;
      }
      case "charge": {
        b.setLinvel(wardenChargeVelocity(aim, speedMult, bolt), true);
        spawnBurst({ position: origin, count: 18, color: WARDEN_COLOR, speed: 4, ttl: 0.5, size: 0.09 });
        break;
      }
      case "slam": {
        // Telegraph: flare up and rumble; the brain detonates it ("boom") later.
        e.flash.current = 1;
        gameEvents.emit("shake", 0.25);
        break;
      }
    }
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={e.body}
      position={position}
      type={e.net.bodyType}
      colliders={false}
      gravityScale={0}
      linearDamping={0.8}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[1.15]} mass={30} collisionGroups={ENEMY_GROUPS} />
      <WardenModel shellRef={shell} materialRef={mat} />
    </RigidBody>
  );
}
