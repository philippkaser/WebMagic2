import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { ENEMY_GLOW, SHADOW_OPACITY, ShadowModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import {
  useContactDamage,
  useEnemy,
  type EnemyDeathFx,
} from "../useEnemy";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { ENEMY_BODIES } from "../../sim/bodies";
import { ShadowController } from "../../sim/enemies/controllers";

const DEATH_FX: EnemyDeathFx = {
  // It unravels into the dark it came from: a slow bloom of shadow-smoke.
  burst: { count: 26, color: ["#2a1a44", "#1a0d2a", "#050208"], speed: 2.5, ttl: 1.6, size: 0.3, style: "smoke", endColor: "#050208", alpha: 0.85, gravity: 0.6 },
  light: { color: "#6a3d9a", intensity: 18 },
  soul: "#9a6aff",
};
const BODY = ENEMY_BODIES.shadow;

/** Shadow — a lurking stalker. Instead of the wisp's straight chase it plays
 * keep-away: prowls a ring around its target, then darts in for a strike and
 * recoils back into the dark (brains/shadow.ts). Floats like the wisp; the
 * authority runs the brain, replicas are driven by the net layer. */
export function Shadow({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const e = useEnemy(
    { kind: "shadow", entityId, position, floor, deathFx: DEATH_FX, hitColor: "#8a5cc0" },
    (core) => new ShadowController(core),
  );
  // Contact strike — lands mostly on a lunge; local, like the wisp's burn.
  const touch = useContactDamage({
    range: 1.5,
    damage: 12,
    floor,
    push: { force: 5, planar: 0.3, lift: 1.5 },
    burst: ["#2a1a44", "#6a3d9a"],
  });

  useFrame(({ clock }, dt) => {
    const b = e.frame(dt, clock.elapsedTime);
    if (!b) return;
    if (mat.current) {
      mat.current.emissiveIntensity = ENEMY_GLOW.shadow + e.core.flash * 6;
      // It solidifies to strike (the brain's mode only advances on the authority).
      mat.current.opacity = e.ctl.brain.mode === "lunge" ? SHADOW_OPACITY.lunging : SHADOW_OPACITY.lurking;
    }
    touch(b.translation(), dt);
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(BODY)} type={e.net.bodyType}>
      <SpecCollider spec={BODY} />
      <ShadowModel materialRef={mat} />
    </RigidBody>
  );
}
