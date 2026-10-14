import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { ACCENT_GLOW, makeEnemyMaterial, SHADOW_OPACITY, ShadowModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import { ACT, encodeAct } from "../anticipation";
import { createChaseInput, createSteering } from "../brains/common";
import { createShadowBrain, SHADOW, tickShadow, type ShadowBrain } from "../brains/shadow";
import {
  ENEMY_GROUPS,
  ENEMY_LOOT_CHANCE,
  useContactDamage,
  useEnemy,
  type EnemyDeathFx,
  type EnemyDrops,
} from "../useEnemy";

const DEATH_FX: EnemyDeathFx = {
  // It unravels into the dark it came from: a slow bloom of shadow-smoke.
  burst: { count: 26, color: ["#2a1a44", "#1a0d2a", "#050208"], speed: 2.5, ttl: 1.6, size: 0.3, style: "smoke", endColor: "#050208", alpha: 0.85, gravity: 0.6 },
  light: { color: "#6a3d9a", intensity: 18 },
  soul: "#9a6aff",
};
const DROPS: EnemyDrops = { lootChance: ENEMY_LOOT_CHANCE, minY: 0.6 };

/** What the shadow is doing, on the wire (anticipation.ts): every client
 * sees it coil, strike and shrink back. */
function shadowAct(b: ShadowBrain): number {
  switch (b.mode) {
    case "coil":
      return encodeAct(ACT.coil, 1 - b.modeTimer / b.coilTime);
    case "lunge":
      return encodeAct(ACT.lunge, 1 - b.modeTimer / SHADOW.lungeTime);
    case "recoil":
      return encodeAct(ACT.recoil, 1 - b.modeTimer / SHADOW.recoilTime);
    default:
      return 0;
  }
}

/** Shadow — a lurking stalker. Instead of the wisp's straight chase it plays
 * keep-away: prowls a ring around its target, then coils and darts in for a
 * strike and recoils back into the dark (brains/shadow.ts). Floats like the
 * wisp; the authority runs the brain, replicas are driven by the net layer
 * and pose its wind-ups from the replicated act. */
export function Shadow({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  // Its own eyes, so they can flare as it coils (and gutter as it dies).
  const eyeMat = useMemo(() => makeEnemyMaterial("shadowEye"), []);
  useEffect(() => () => eyeMat.dispose(), [eyeMat]);
  const brain = useMemo(() => createShadowBrain(), []);
  const e = useEnemy({
    kind: "shadow",
    entityId,
    position,
    floor,
    deathFx: DEATH_FX,
    drops: DROPS,
    // Between its eyes.
    weakSpot: { y: 0.06, r: 0.2, fwd: 0.34 },
    act: () => shadowAct(brain),
  });
  // Contact strike — lands mostly on a lunge; local, like the wisp's burn.
  const touch = useContactDamage({
    range: 1.5,
    damage: 12,
    floor,
    push: { force: 5, planar: 0.3, lift: 1.5 },
    burst: ["#2a1a44", "#6a3d9a"],
  });
  const senses = useMemo(createChaseInput, []);
  const steering = useMemo(createSteering, []);

  useFrame(({ clock }, dt) => {
    const b = e.beginFrame(dt);
    if (!b) return;
    e.paint(mat.current);
    const { act, ant, wound } = e.live;
    if (mat.current) {
      // It solidifies to strike — gathering itself through the coil.
      mat.current.opacity =
        act.code === ACT.lunge
          ? SHADOW_OPACITY.lunging
          : act.code === ACT.coil
            ? SHADOW_OPACITY.lurking + (SHADOW_OPACITY.lunging - SHADOW_OPACITY.lurking) * act.progress * 0.8
            : SHADOW_OPACITY.lurking;
    }
    // Eyes flare as it coils; near death they gutter with its glow.
    eyeMat.emissiveIntensity = ACCENT_GLOW.shadowEye * ant.eye * (wound.stage >= 2 ? 0.4 + 0.6 * wound.glow : 1);

    const t = b.translation();
    touch(t, dt, e.armed());

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
      <group ref={e.view}>
        <ShadowModel materialRef={mat} eyeMaterial={eyeMat} />
      </group>
    </RigidBody>
  );
}
