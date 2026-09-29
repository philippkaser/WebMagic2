import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { flashLight } from "../../fx/DynamicLights";
import { playerPosition } from "../../game/player-state";
import { nearestWizardTo } from "../../game/targets";
import { ENEMY_GLOW, SentryModel } from "../../render/models/enemies";
import { enemyCast } from "../../weapons/hostileEffects";
import type { Vec3 } from "../../world/types";
import { aimDir, type Vec } from "../brains/common";
import { createSentryBrain, createSentryTick, SENTRY, sentryLead, sentryYaw, tickSentry } from "../brains/sentry";
import { ENEMY_GROUPS, ENEMY_LOOT_CHANCE, useEnemy, type EnemyDeathFx, type EnemyDrops } from "../useEnemy";

const BOLT_COLOR = "#ff5136";
const DEATH_FX: EnemyDeathFx = {
  burst: { count: 36, color: ["#ff7a4d", "#ffd9a8", "#3a2418"], speed: 6.5, ttl: 0.9, size: 0.11 },
  light: { color: "#ff7a4d", intensity: 26 },
  lift: 0.8,
};
const DROPS: EnemyDrops = { lootChance: ENEMY_LOOT_CHANCE, lift: 0.5 };

/** Sentry — a fixed warding crystal that lobs slow, dodgeable fire bolts when
 * it has line of sight. The authority runs its reload clock and aim
 * (brains/sentry.ts) and checks sight against the physics world; the shot
 * itself is an authoritative host event replayed everywhere. */
export function Sentry({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const head = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const { world, rapier } = useRapier();
  const e = useEnemy({
    kind: "sentry",
    entityId,
    position,
    floor,
    immobile: true,
    deathFx: DEATH_FX,
    drops: DROPS,
  });
  const brain = useMemo(() => createSentryBrain(), []);
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
    if (head.current) head.current.rotation.y = sentryYaw(head.current.rotation.y, headPos, playerPosition, dt);

    const glow = ENEMY_GLOW.sentry + e.flash.current * 6;
    if (!e.net.isAuthority) {
      if (mat.current) mat.current.emissiveIntensity = glow;
      return;
    }

    tickSentry(brain, dt, floor, tick);
    if (mat.current) mat.current.emissiveIntensity = glow + tick.charge;
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
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} type="fixed" colliders={false}>
      <CuboidCollider args={[0.42, 0.55, 0.42]} position={[0, 0.55, 0]} collisionGroups={ENEMY_GROUPS} />
      <SentryModel headRef={head} materialRef={mat} />
    </RigidBody>
  );
}
