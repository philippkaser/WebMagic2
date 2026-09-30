import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Mesh, MeshStandardMaterial } from "three";
import { ENEMY_GLOW, SlimeModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import { createChaseInput, createSteering, type Vec } from "../brains/common";
import { createSlimeBrain, SLIME_MAX_GEN, slimeSquash, tickSlime } from "../brains/slime";
import { spawnEnemy } from "../spawnedStore";
import { ENEMY_GROUPS, ENEMY_LOOT_CHANCE, useContactDamage, useEnemy } from "../useEnemy";

/** Slime — a gelatinous melee blob that hops toward its prey and, on death,
 * SPLITS into two smaller, faster copies (down to a terminal generation; see
 * SLIME_GENERATIONS in brains/slime.ts). Children are spawned
 * host-authoritatively via spawnEnemy() and rendered by <SpawnedEnemies>.
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
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);

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
    hitColor: "#a8f06a",
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
    if (mat.current) mat.current.emissiveIntensity = ENEMY_GLOW.slime + e.flash.current * 6;

    const t = b.translation();
    const v = b.linvel();
    // Squash & stretch from vertical motion — reads as a bouncing blob.
    if (mesh.current) {
      const sy = slimeSquash(v.y);
      const sxz = 1 / Math.sqrt(sy);
      mesh.current.scale.set(cfg.size * sxz, cfg.size * sy, cfg.size * sxz);
    }
    touch(t, dt);

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
      <SlimeModel size={cfg.size} meshRef={mesh} materialRef={mat} />
    </RigidBody>
  );
}
