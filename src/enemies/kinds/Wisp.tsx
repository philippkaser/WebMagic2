import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { ENEMY_GLOW, WispModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import {
  useContactDamage,
  useEnemy,
  type EnemyDeathFx,
} from "../useEnemy";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { ENEMY_BODIES } from "../../sim/bodies";
import { contactOf, WispController } from "../../sim/enemies/controllers";

const DEATH_FX: EnemyDeathFx = {
  // It comes apart as light: sparks flung wide, then the soul rises.
  burst: { count: 26, color: ["#b46bff", "#ffffff", "#8a4dff"], speed: 8, ttl: 0.7, size: 0.08, style: "spark", endColor: "#4a2a7a", upward: 2 },
  light: { color: "#b46bff", intensity: 22 },
  soul: "#c89cff",
};
const BODY = ENEMY_BODIES.wisp;

/** Wisp — a floating mote of hostile magic. Chases the nearest wizard and
 * burns on contact. The floor authority runs its brain (brains/wisp.ts);
 * replicas are driven by the replication framework. */
export function Wisp({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const e = useEnemy(
    { kind: "wisp", entityId, position, floor, deathFx: DEATH_FX, hitColor: "#d9a9ff" },
    (core) => new WispController(core),
  );
  const touch = useContactDamage({
    ...contactOf("wisp")!,
    floor,
    push: { force: 5, planar: 0.35, lift: 2 },
    burst: ["#ff5d5d", "#b46bff"],
  });

  useFrame(({ clock }, dt) => {
    const b = e.frame(dt, clock.elapsedTime);
    if (!b) return;
    if (mat.current) mat.current.emissiveIntensity = ENEMY_GLOW.wisp + e.core.flash * 6;
    touch(b.translation(), dt);
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(BODY)} type={e.net.bodyType}>
      <SpecCollider spec={BODY} />
      <WispModel materialRef={mat} />
    </RigidBody>
  );
}
