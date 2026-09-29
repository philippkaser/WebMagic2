import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { ENEMY_GLOW, SHADOW_OPACITY, ShadowModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import { createChaseInput, createSteering } from "../brains/common";
import { createShadowBrain, tickShadow } from "../brains/shadow";
import {
  ENEMY_GROUPS,
  ENEMY_LOOT_CHANCE,
  useContactDamage,
  useEnemy,
  type EnemyDeathFx,
  type EnemyDrops,
} from "../useEnemy";

const DEATH_FX: EnemyDeathFx = {
  burst: { count: 26, color: ["#2a1a44", "#6a3d9a", "#050208"], speed: 6, ttl: 0.8, size: 0.1 },
  light: { color: "#6a3d9a", intensity: 18 },
};
const DROPS: EnemyDrops = { lootChance: ENEMY_LOOT_CHANCE, minY: 0.6 };

/** Shadow — a lurking stalker. Instead of the wisp's straight chase it plays
 * keep-away: prowls a ring around its target, then darts in for a strike and
 * recoils back into the dark (brains/shadow.ts). Floats like the wisp; the
 * authority runs the brain, replicas are driven by the net layer. */
export function Shadow({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const e = useEnemy({
    kind: "shadow",
    entityId,
    position,
    floor,
    deathFx: DEATH_FX,
    drops: DROPS,
    hitColor: "#8a5cc0",
  });
  // Contact strike — lands mostly on a lunge; local, like the wisp's burn.
  const touch = useContactDamage({
    range: 1.5,
    damage: 12,
    floor,
    push: { force: 5, planar: 0.3, lift: 1.5 },
    burst: ["#2a1a44", "#6a3d9a"],
  });
  const brain = useMemo(() => createShadowBrain(), []);
  const senses = useMemo(createChaseInput, []);
  const steering = useMemo(createSteering, []);

  useFrame(({ clock }, dt) => {
    const b = e.beginFrame(dt);
    if (!b) return;
    if (mat.current) {
      mat.current.emissiveIntensity = ENEMY_GLOW.shadow + e.flash.current * 6;
      // It solidifies to strike (the brain's mode only advances on the authority).
      mat.current.opacity = brain.mode === "lunge" ? SHADOW_OPACITY.lunging : SHADOW_OPACITY.lurking;
    }

    const t = b.translation();
    touch(t, dt);

    if (!e.net.isAuthority) return;
    e.steer(b, tickShadow(brain, e.sense(senses, b, t, clock.elapsedTime, dt), steering));
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={e.body}
      position={position}
      type={e.net.bodyType}
      colliders={false}
      gravityScale={0}
      linearDamping={0.6}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[0.44]} mass={2} collisionGroups={ENEMY_GROUPS} />
      <ShadowModel materialRef={mat} />
    </RigidBody>
  );
}
