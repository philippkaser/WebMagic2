import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { playBossRoar } from "../../audio/sound";
import { gameEvents } from "../../core/events";
import { presentScale } from "../../core/presentTime";
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
import { dropGold, dropItem, dropLoot, dropMaterials, dropUnique } from "../../items/LootOrbs";
import {
  ACCENT_GLOW,
  makeEnemyMaterial,
  WARDEN_COLOR,
  WARDEN_SHARDS,
  WardenModel,
} from "../../render/models/enemies";
import { enemyBoom, enemyCast } from "../../weapons/hostileEffects";
import type { Vec3 } from "../../world/types";
import { ACT, encodeAct } from "../anticipation";
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
  type WardenBrain,
} from "../brains/warden";
import { corpsesMounted } from "../corpses/Corpses";
import { OY } from "../puppet";
import { ENEMY_GROUPS, useContactDamage, useEnemy } from "../useEnemy";

/** The boss is a singleton: its net id and HUD bar are fixed. */
const BOSS_ID = "boss";
const BOSS_NAME = "WARDEN OF THE DEEP";
const EMBER = "#ff8b3d";
/** The slam's blast radius (before the floor's explosion rule). */
const WARDEN_SLAM_RADIUS = 5.2;
const UP_AXIS: Vec3 = [0, 1, 0];
/** It rises from this far below its hover when it wakes. */
const RISE_FROM = -1.4;

/** What the Warden is doing, on the wire: every client sees it brace,
 * charge and rise for a slam. */
function wardenAct(b: WardenBrain): number {
  if (b.slamTelegraph > 0) return encodeAct(ACT.slam, 1 - b.slamTelegraph / WARDEN.slamTelegraph);
  if (b.chargeWindup > 0) return encodeAct(ACT.brace, 1 - b.chargeWindup / WARDEN.chargeWindup);
  if (b.charging > 0) return encodeAct(ACT.charge, 1 - b.charging / WARDEN.chargeTime);
  return 0;
}

/** Warden of the Deep — the floor boss (every 10th floor). The authority runs
 * its brain (brains/warden.ts); the replication framework moves its body on
 * replicas, its attacks are host events replayed everywhere, and its health,
 * waking and wind-ups mirror via replicated fields (the HUD bar, the roar,
 * the brace and the slam circle play on every client). The floor keeps its
 * portals sealed until onDeath fires. */
export function Warden({ position, floor, onDeath }: { position: Vec3; floor: number; onDeath: () => void }) {
  const shell = useRef<Group>(null);
  const shards = useRef<(Mesh | null)[]>([]);
  const mat = useRef<MeshStandardMaterial>(null);
  const core = useMemo(() => makeEnemyMaterial("wardenCore"), []);
  useEffect(() => () => core.dispose(), [core]);
  /** The wake has been shown on this client (roar, bar, rise). */
  const woke = useRef(false);
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
    // The blazing core, through the shell.
    weakSpot: { y: 0, r: 0.5 },
    knockbackScale: 0.25,
    flashDecay: 4,
    act: () => wardenAct(brain),
    onAct: (code, progress, at) => {
      if (code !== ACT.slam) return;
      // The slam's warning, on every client: it flares, the floor rumbles,
      // and the circle is drawn at the blast's real (omen-scaled) radius —
      // what you see is what hits.
      e.flash.current = 1;
      gameEvents.emit("shake", 0.25);
      telegraphFx(
        at,
        WARDEN_SLAM_RADIUS * getFloorRules().explosionRadiusMult,
        WARDEN_COLOR,
        WARDEN.slamTelegraph * (1 - progress),
      );
    },
    onDeathFx: (t) => {
      // The boss comes apart in stages — its corpse hangs, sheds its shards
      // in blasts, then its core goes critical (corpses/corpseScripts.ts,
      // on the presentation clock). Without the corpse layer: the old
      // rolling chain of blasts.
      if (!corpsesMounted()) {
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
      }
      playBossRoar([t.x, t.y + 1.5, t.z]);
      // Guaranteed rich drops for the whole party (host-rolled).
      dropLoot([t.x - 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor + 2);
      dropLoot([t.x + 0.7, Math.max(t.y, 0.8), t.z + 0.6], floor + 2);
      dropGold([t.x, Math.max(t.y, 0.8), t.z - 0.6], floor, 1, "boss");
      // The Warden's own: sigils for the Great Work, riftglass, and now and
      // then a legendary of its own.
      dropMaterials([t.x, Math.max(t.y, 0.8), t.z], floor, "boss");
      if (Math.random() < 0.18) dropUnique([t.x, Math.max(t.y, 0.8), t.z - 1.4], floor + 2);
      // The Warden hoards escapes too — a feather drop is a real prize.
      if (Math.random() < 0.35) dropItem(SAVE_FEATHER_ID, [t.x, Math.max(t.y, 0.8), t.z + 1.4]);
      gameEvents.emit("message", "The Warden falls. The seal breaks.");
      gameEvents.emit("shake", corpsesMounted() ? 0.4 : 0.8); // the big one comes when it goes critical
    },
    onKilled: () => {
      gameEvents.emit("bossHp", null);
      onDeath(); // unseal the portals either way
    },
    onHp: (current, maxHp) => {
      if (woke.current) gameEvents.emit("bossHp", { name: BOSS_NAME, frac: Math.max(current / maxHp, 0) });
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
    const t = b.translation();
    const awake = e.aggro.current;

    // Woken (by a wizard coming close or by a blow — the host's call, sent
    // as the wake bit): it rises from below its hover and roars, everywhere.
    if (awake && !woke.current) {
      woke.current = true;
      e.live.puppet.x[OY] = RISE_FROM;
      playBossRoar([t.x, t.y + 1.5, t.z]);
      gameEvents.emit("message", `${BOSS_NAME} wakes`);
      gameEvents.emit("bossHp", { name: BOSS_NAME, frac: Math.max(e.hp.current / e.maxHp, 0) });
      gameEvents.emit("shake", 0.5);
    }

    const enraged = isEnraged(e.hp.current, e.maxHp);
    const pulse = Math.sin(time * 8);
    const { ant, wound } = e.live;
    e.paint(mat.current, enraged ? 0.8 + pulse * 0.4 : 0, 5);
    // Its core heats through a wind-up and beats like a heart near the end.
    core.emissiveIntensity = (ACCENT_GLOW.wardenCore + ant.glow * 1.5) * (wound.stage >= 2 ? 0.5 + 0.5 * wound.glow : 1);
    const pdt = dt * presentScale();
    if (shell.current) shell.current.rotation.y += pdt * (enraged ? 1.6 : 0.7) * ant.spin;
    // Shards fold in as it braces; past the knee they gutter out one by one.
    const ring = 1 + ant.accent;
    for (let i = 0; i < WARDEN_SHARDS.length; i++) {
      const m = shards.current[i];
      if (!m) continue;
      const s = WARDEN_SHARDS[i];
      m.position.set(s[0] * ring, s[1], s[2] * ring);
      const dim = wound.stage >= 3 ? i >= 1 : wound.stage >= 2 ? i >= 2 : false;
      m.scale.setScalar(dim ? 0.55 * (0.6 + 0.4 * wound.glow) : 1);
    }

    if (light.current) {
      light.current.position.set(t.x, t.y, t.z);
      light.current.intensity = (8 + e.flash.current * 10 + ant.glow * 3 + (enraged ? 2 + pulse * 1.5 : 0)) * (0.6 + 0.4 * wound.glow);
    }
    touch(t, dt, awake && e.armed());

    // Replicas are moved by the net layer; only the authority thinks.
    if (!e.net.isAuthority) return;

    // Authority brain: fight the nearest wizard on the floor.
    const target = nearestWizardTo(t.x, t.y + WARDEN.aimLift, t.z);
    aim.x = target.pos.x - t.x;
    aim.y = target.pos.y + WARDEN.aimLift - t.y;
    aim.z = target.pos.z - t.z;
    const dist = target.dist;

    if (!awake) {
      if (dist < WARDEN.wakeRange) e.aggro.current = true;
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
      case "launch": {
        // The brace (the act every client poses) is over: away it goes.
        b.setLinvel(wardenChargeVelocity(aim, speedMult, bolt), true);
        chargeBurstFx(origin, bolt, WARDEN_COLOR);
        break;
      }
      // "charge" and "slam" only arm the brain's wind-ups; their tells play
      // from the replicated act on every client (onAct, the puppet).
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
      <group ref={e.view}>
        <WardenModel shellRef={shell} shardRefs={shards} materialRef={mat} coreMaterial={core} />
      </group>
    </RigidBody>
  );
}
