import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { flashLight } from "../../fx/DynamicLights";
import { castFlareFx } from "../../fx/effects";
import { playerPosition } from "../../game/player-state";
import { ENEMY_GLOW, SentryModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import type { Vec } from "../brains/common";
import { SENTRY, sentryYaw } from "../brains/sentry";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { ENEMY_BODIES } from "../../sim/bodies";
import { SentryController } from "../../sim/enemies/controllers";
import { useEnemy, type EnemyDeathFx } from "../useEnemy";

const DEATH_FX: EnemyDeathFx = {
  // The warding crystal shatters into lit shards that bounce and settle.
  burst: { count: 26, color: ["#ff7a4d", "#ffd9a8", "#3a2418"], speed: 6, ttl: 1.8, size: 0.12, style: "shard" },
  light: { color: "#ff7a4d", intensity: 26 },
  lift: 0.8,
  soul: "#ff9a5a",
};

/** Sentry — a fixed warding crystal that lobs slow, dodgeable fire bolts when
 * it has line of sight. Its controller (sim/enemies/controllers.ts) runs the
 * reload clock, the aim and the sight check on the authority; the shot is an
 * authoritative host event replayed everywhere. This view tracks heads and
 * glows. */
export function Sentry({ position, floor, entityId }: { position: Vec3; floor: number; entityId: string }) {
  const head = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const e = useEnemy(
    {
      kind: "sentry",
      entityId,
      position,
      floor,
      immobile: true,
      deathFx: DEATH_FX,
      hitColor: "#ff9a5a",
      onCue: (cue) => {
        if (cue.type !== "flare") return;
        flashLight([cue.at.x, cue.at.y, cue.at.z], cue.color, 10);
        castFlareFx(cue.at, cue.dir, cue.color, undefined, 2);
      },
    },
    (core) => new SentryController(core),
  );
  const headPos = useMemo<Vec>(() => ({ x: 0, y: 0, z: 0 }), []);

  useFrame((_, dt) => {
    const b = e.frame(dt, 0);
    if (!b) return;
    const t = b.translation();
    headPos.x = t.x;
    headPos.y = t.y + SENTRY.headHeight;
    headPos.z = t.z;
    // Head tracking is cosmetic — every client tracks its own player.
    if (head.current) head.current.rotation.y = sentryYaw(head.current.rotation.y, headPos, playerPosition, dt);
    // The wind-up glow (the reload clock runs on the authority).
    const glow = ENEMY_GLOW.sentry + e.core.flash * 6;
    if (mat.current) mat.current.emissiveIntensity = e.net.isAuthority ? glow + e.ctl.tick.charge : glow;
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(ENEMY_BODIES.sentry)}>
      <SpecCollider spec={ENEMY_BODIES.sentry} />
      <SentryModel headRef={head} materialRef={mat} />
    </RigidBody>
  );
}
