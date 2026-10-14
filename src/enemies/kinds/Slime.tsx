import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { ACCENT_GLOW, makeEnemyMaterial, SlimeModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import { createChaseInput, createSteering, type Vec } from "../brains/common";
import { createSlimeBrain, SLIME_MAX_GEN, slimeSquash, tickSlime } from "../brains/slime";
import { SQ } from "../puppet";
import { spawnEnemy } from "../spawnedStore";
import { ENEMY_GROUPS, ENEMY_LOOT_CHANCE, useContactDamage, useEnemy } from "../useEnemy";

/** Slime — a gelatinous melee blob that hops toward its prey and, on death,
 * SPLITS into two smaller, faster copies (down to a terminal generation; see
 * SLIME_GENERATIONS in brains/slime.ts). Children are spawned
 * host-authoritatively via spawnEnemy() and rendered by <SpawnedEnemies>;
 * they squeeze out of the parent's splat (they mount small and spring up).
 * Unlike the fliers it lives on the floor (gravity on). */
export function Slime({
  position,
  floor,
  entityId,
  generation = 0,
  onDeath,
}: {
  position: Vec3;
  floor: number;
  entityId: string;
  generation?: number;
  onDeath?: () => void;
}) {
  const gen = Math.min(generation, SLIME_MAX_GEN);
  const brain = useMemo(() => createSlimeBrain(gen), [gen]);
  const cfg = brain.gen;
  const radius = 0.5 * cfg.size;
  const last = gen >= SLIME_MAX_GEN;
  const mat = useRef<MeshStandardMaterial>(null);
  const eyeMat = useMemo(() => makeEnemyMaterial("slimeEye"), []);
  useEffect(() => () => eyeMat.dispose(), [eyeMat]);
  // Vertical speed last frame: the jelly's squash and stretch.
  const vy = useRef(0);

  const e = useEnemy({
    kind: "slime",
    entityId,
    position,
    floor,
    healthScale: cfg.hp,
    deathFx: {
      // Goo: opaque chunky blobs that splat and bounce (the "pixel" look).
      burst: { count: 20, color: ["#7fdc4a", "#2f5a1a", "#c8ff8a"], speed: 5, ttl: 0.9, size: 0.09 + cfg.size * 0.05 },
      light: { color: "#7fdc4a", intensity: 14 },
      soul: "#a8f06a",
      scale: 0.45 + cfg.size * 0.45,
    },
    // The whole slime's loot lands when its LAST piece dies, not on every split.
    drops: { lootChance: last ? ENEMY_LOOT_CHANCE : 0, minY: 0.4 },
    onDeathFx: (t: Vec) => {
      if (last) return;
      // Split into two smaller, faster children (host decides; all render).
      spawnEnemy("slime", gen + 1, [t.x - 0.7, t.y + 0.2, t.z], floor);
      spawnEnemy("slime", gen + 1, [t.x + 0.7, t.y + 0.2, t.z], floor);
    },
    onKilled: onDeath,
    // Squash & stretch from vertical motion — a kick on the jelly's springs,
    // so a hop and a hit wobble together instead of fighting.
    posture: (p) => {
      p.t[SQ] += slimeSquash(vy.current) - 1;
    },
    emerge: gen > 0,
  });
  const touch = useContactDamage({
    range: radius + 0.8,
    damage: cfg.contact,
    floor,
    push: { force: 4, planar: 0.3, lift: 1.5 },
  });
  const senses = useMemo(createChaseInput, []);
  const steering = useMemo(createSteering, []);

  useFrame((_, dt) => {
    const b = e.beginFrame(dt);
    if (!b) return;
    e.paint(mat.current);
    const w = e.live.wound;
    // Its eyes dim as it fades.
    eyeMat.emissiveIntensity = ACCENT_GLOW.slimeEye * (w.stage >= 2 ? 0.35 + 0.65 * w.glow : 1);

    const t = b.translation();
    const v = b.linvel();
    vy.current = v.y;
    touch(t, dt, e.armed());

    if (!e.net.isAuthority) return;
    e.steer(b, tickSlime(brain, e.sense(senses, b, t, 0, dt, v), steering));
  });

  if (e.dead) return null;
  return (
    <RigidBody
      ref={e.body}
      position={position}
      type={e.net.bodyType}
      colliders={false}
      gravityScale={1}
      linearDamping={0.1}
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[radius]} mass={1.2 * cfg.size} collisionGroups={ENEMY_GROUPS} />
      <group ref={e.view}>
        <SlimeModel size={cfg.size} materialRef={mat} eyeMaterial={eyeMat} />
      </group>
    </RigidBody>
  );
}
