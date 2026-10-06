import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import type { Mesh, MeshStandardMaterial } from "three";
import { ENEMY_GLOW, SlimeModel } from "../../render/models/enemies";
import type { Vec3 } from "../../world/types";
import { SLIME_MAX_GEN, slimeGeneration, slimeSquash } from "../brains/slime";
import { bodyProps, SpecCollider } from "../../game/bodies";
import { slimeBody } from "../../sim/bodies";
import { SlimeController } from "../../sim/enemies/controllers";
import { useContactDamage, useEnemy } from "../useEnemy";

/** Slime — a gelatinous melee blob that hops toward its prey and, on death,
 * SPLITS into two smaller, faster copies (down to a terminal generation; see
 * SLIME_GENERATIONS in brains/slime.ts). Its controller spawns the children
 * on the authority (sim/enemies/controllers.ts); <SpawnedEnemies> renders them.
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
  const cfg = slimeGeneration(gen);
  const body = useMemo(() => slimeBody(gen), [gen]);
  const radius = 0.5 * cfg.size;
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);

  // Its split (two smaller, faster children) is the controller's, on the
  // authority; the children render through <SpawnedEnemies>.
  const e = useEnemy(
    {
      kind: "slime",
      entityId,
      position,
      floor,
      deathFx: {
        // Goo: opaque chunky blobs that splat and bounce (the "pixel" look).
        burst: { count: 20, color: ["#7fdc4a", "#2f5a1a", "#c8ff8a"], speed: 5, ttl: 0.9, size: 0.09 + cfg.size * 0.05 },
        light: { color: "#7fdc4a", intensity: 14 },
        soul: "#a8f06a",
        scale: 0.45 + cfg.size * 0.45,
      },
      generation: gen,
      onKilled: onDeath,
      hitColor: "#a8f06a",
    },
    (core) => new SlimeController(core, gen),
  );
  const touch = useContactDamage({
    range: radius + 0.8,
    damage: cfg.contact,
    floor,
    push: { force: 4, planar: 0.3, lift: 1.5 },
  });

  useFrame((_, dt) => {
    const b = e.frame(dt, 0);
    if (!b) return;
    if (mat.current) mat.current.emissiveIntensity = ENEMY_GLOW.slime + e.core.flash * 6;
    // Squash & stretch from vertical motion — reads as a bouncing blob.
    if (mesh.current) {
      const sy = slimeSquash(b.linvel().y);
      const sxz = 1 / Math.sqrt(sy);
      mesh.current.scale.set(cfg.size * sxz, cfg.size * sy, cfg.size * sxz);
    }
    touch(b.translation(), dt);
  });

  if (e.dead) return null;
  return (
    <RigidBody ref={e.body} position={position} {...bodyProps(body)} type={e.net.bodyType}>
      <SpecCollider spec={body} />
      <SlimeModel size={cfg.size} meshRef={mesh} materialRef={mat} />
    </RigidBody>
  );
}
