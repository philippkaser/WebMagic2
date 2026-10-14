import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { flashLight } from "../../fx/DynamicLights";
import { castFlareFx } from "../../fx/effects";
import { playerPosition } from "../../game/player-state";
import { nearestWizardTo } from "../../game/targets";
import { SentryModel } from "../../render/models/enemies";
import { enemyCast } from "../../weapons/hostileEffects";
import type { Vec3 } from "../../world/types";
import { ACT, encodeAct } from "../anticipation";
import { aimDir, type Vec } from "../brains/common";
import {
  createSentryBrain,
  createSentryTick,
  SENTRY,
  sentryLead,
  sentryWindup,
  sentryYaw,
  tickSentry,
} from "../brains/sentry";
import {
  ENEMY_GROUPS,
  ENEMY_LOOT_CHANCE,
  enemiesCalmed,
  useEnemy,
  type EnemyDeathFx,
  type EnemyDrops,
} from "../useEnemy";

const BOLT_COLOR = "#ff5136";
const DEATH_FX: EnemyDeathFx = {
  // The warding crystal shatters into lit shards that bounce and settle.
  burst: { count: 26, color: ["#ff7a4d", "#ffd9a8", "#3a2418"], speed: 6, ttl: 1.8, size: 0.12, style: "shard" },
  light: { color: "#ff7a4d", intensity: 26 },
  lift: 0.8,
  soul: "#ff9a5a",
};
const DROPS: EnemyDrops = { lootChance: ENEMY_LOOT_CHANCE, lift: 0.5 };

/** Sentry — a fixed warding crystal that lobs slow, dodgeable fire bolts when
 * it has line of sight. The authority runs its reload clock and aim
 * (brains/sentry.ts) and checks sight against the physics world; the shot
 * itself is an authoritative host event replayed everywhere. Its wind-up —
 * the crystal swelling, brightening and whining — rides the replicated act,
 * so every player sees the shot coming. */
export function Sentry({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const head = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const { world, rapier } = useRapier();
  const brain = useMemo(() => createSentryBrain(), []);
  const e = useEnemy({
    kind: "sentry",
    entityId,
    position,
    floor,
    immobile: true,
    deathFx: DEATH_FX,
    drops: DROPS,
    // The burning crystal head is what to aim for.
    weakSpot: { y: SENTRY.headHeight, r: 0.32 },
    // Its head comes off facing wherever it was tracking.
    faceYaw: () => head.current?.rotation.y ?? 0,
    act: () => {
      const w = sentryWindup(brain);
      return w > 0 ? encodeAct(ACT.aim, w) : 0;
    },
  });
  const tick = useMemo(createSentryTick, []);
  const headPos = useMemo<Vec>(() => ({ x: 0, y: 0, z: 0 }), []);
  const aim = useMemo<Vec>(() => ({ x: 0, y: 0, z: 0 }), []);
  const losRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);

  useFrame((_, dt) => {
    const b = e.beginFrame(dt);
    if (!b) return;
    const t = b.translation();
    headPos.x = t.x;
    headPos.y = t.y + SENTRY.headHeight;
    headPos.z = t.z;

    // Head tracking is cosmetic — every client tracks its own player.
    if (head.current) {
      head.current.rotation.y = sentryYaw(head.current.rotation.y, headPos, playerPosition, dt);
      // The crystal swells as it charges (on every client, from the act).
      head.current.scale.setScalar(1 + e.live.ant.accent);
    }
    const { act } = e.live;
    const charge = act.code === ACT.aim ? act.progress * SENTRY.chargeWindow * SENTRY.chargeGlow : 0;
    e.paint(mat.current, charge);

    if (!e.net.isAuthority || enemiesCalmed()) return;
    tickSentry(brain, dt, floor, tick, e.hp.current / e.maxHp);
    if (!tick.fire) return;

    // Fire at the nearest wizard on the floor, leading their motion — peer
    // poses carry velocity, so everyone gets led equally.
    const target = nearestWizardTo(headPos.x, headPos.y, headPos.z);
    const dist = target.dist;
    if (dist > SENTRY.range) return;
    aimDir(headPos, target.pos, aim);
    losRay.origin.x = headPos.x;
    losRay.origin.y = headPos.y;
    losRay.origin.z = headPos.z;
    losRay.dir.x = aim.x;
    losRay.dir.y = aim.y;
    losRay.dir.z = aim.z;
    const hit = world.castRay(losRay, dist - 0.6, true, undefined, undefined, undefined, b);
    if (hit !== null) return; // wall or prop in the way
    sentryLead(aim, dist, target.vel, aim);
    const muzzle = SENTRY.muzzleLead;
    enemyCast.announce({
      origin: [headPos.x + aim.x * muzzle, headPos.y + aim.y * muzzle, headPos.z + aim.z * muzzle],
      velocity: [aim.x, aim.y, aim.z],
      damage: e.damage(11),
      color: BOLT_COLOR,
      size: 0.16,
      blastRadius: 1.9,
      blastImpulse: 11,
    });
    flashLight([headPos.x, headPos.y, headPos.z], BOLT_COLOR, 10);
    castFlareFx(headPos, aim, BOLT_COLOR, undefined, 2);
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} type="fixed" colliders={false}>
      <CuboidCollider args={[0.42, 0.55, 0.42]} position={[0, 0.55, 0]} collisionGroups={ENEMY_GROUPS} />
      <group ref={e.view}>
        <SentryModel headRef={head} materialRef={mat} />
      </group>
    </RigidBody>
  );
}
