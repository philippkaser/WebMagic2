import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { ENEMY_GLOW, WispModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import { createChaseInput, createSteering } from "../brains/common";
import { tickWisp } from "../brains/wisp";
import {
  useContactDamage,
  useEnemy,
  type EnemyDeathFx,
  type EnemyDrops,
} from "../useEnemy";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { ENEMY_BODIES } from "../../sim/bodies";

const DEATH_FX: EnemyDeathFx = {
  // It comes apart as light: sparks flung wide, then the soul rises.
  burst: { count: 26, color: ["#b46bff", "#ffffff", "#8a4dff"], speed: 8, ttl: 0.7, size: 0.08, style: "spark", endColor: "#4a2a7a", upward: 2 },
  light: { color: "#b46bff", intensity: 22 },
  soul: "#c89cff",
};
const DROPS: EnemyDrops = { minY: 0.6 };
const BODY = ENEMY_BODIES.wisp;

/** Wisp — a floating mote of hostile magic. Chases the nearest wizard and
 * burns on contact. The floor authority runs its brain (brains/wisp.ts);
 * replicas are driven by the replication framework. */
export function Wisp({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const e = useEnemy({
    kind: "wisp",
    entityId,
    position,
    floor,
    deathFx: DEATH_FX,
    drops: DROPS,
    hitColor: "#d9a9ff",
  });
  const touch = useContactDamage({
    range: 1.45,
    damage: 9,
    floor,
    push: { force: 5, planar: 0.35, lift: 2 },
    burst: ["#ff5d5d", "#b46bff"],
  });
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const senses = useMemo(createChaseInput, []);
  const steering = useMemo(createSteering, []);

  useFrame(({ clock }, dt) => {
    const b = e.beginFrame(dt);
    if (!b) return;
    if (mat.current) mat.current.emissiveIntensity = ENEMY_GLOW.wisp + e.flash.current * 6;

    const t = b.translation();
    touch(t, dt);

    // Replicas are driven by the net layer; only the authority thinks.
    if (!e.net.isAuthority) return;
    e.steer(b, tickWisp(phase, e.sense(senses, b, t, clock.elapsedTime, dt), steering));
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(BODY)} type={e.net.bodyType}>
      <SpecCollider spec={BODY} />
      <WispModel materialRef={mat} />
    </RigidBody>
  );
}
