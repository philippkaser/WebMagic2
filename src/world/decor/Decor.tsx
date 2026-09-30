import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { WALL_HEIGHT } from "../../core/config";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { COLLISION } from "../../physics/groups";
import { setGrade } from "../../render/Effects";
import type { Biome } from "../biomes";
import type { DecorItem, DecorKind, FloorLayout } from "../types";
import { geometry } from "./geometries";
import { InstancedParts, trs, type Part } from "./Instanced";
import { biomeMaterials, type BiomeMaterials } from "./materials";
import { Motes } from "./Motes";

/** A floor's set dressing: every decor kind is one instanced draw call per
 * part, plus static colliders for pillars and braziers, brazier light
 * sources, the biome's floating motes and its color grade. */
export function Decor({ layout, biome }: { layout: FloorLayout; biome: Biome }) {
  const mats = biomeMaterials(biome);
  const byKind = useMemo(() => {
    const out = new Map<DecorKind, DecorItem[]>();
    for (const d of layout.decor) {
      const list = out.get(d.kind);
      if (list) list.push(d);
      else out.set(d.kind, [d]);
    }
    return out;
  }, [layout]);
  const matrices = useMemo(
    () => [...byKind].map(([kind, items]) => [kind, items.map((d) => trs(d.pos, d.rot, d.scale))] as const),
    [byKind],
  );
  const parts = useMemo(() => partsFor(biome, mats), [biome, mats]);

  useEffect(() => setGrade(biome.grade), [biome]);

  const solid = useMemo(() => layout.decor.filter((d) => d.kind === "pillar" || d.kind === "brazier"), [layout]);

  return (
    <group>
      {matrices.map(([kind, m]) => (
        <InstancedParts key={kind} matrices={m} parts={parts[kind]} />
      ))}
      {solid.length > 0 && (
        <RigidBody type="fixed" colliders={false}>
          {solid.map((d, i) =>
            d.kind === "pillar" ? (
              <CuboidCollider
                key={i}
                args={[0.45, WALL_HEIGHT / 2, 0.45]}
                position={[d.pos[0], WALL_HEIGHT / 2, d.pos[2]]}
                collisionGroups={COLLISION.world}
              />
            ) : (
              <CuboidCollider
                key={i}
                args={[0.3, 0.55, 0.3]}
                position={[d.pos[0], 0.55, d.pos[2]]}
                collisionGroups={COLLISION.world}
              />
            ),
          )}
        </RigidBody>
      )}
      <Braziers items={byKind.get("brazier") ?? []} color={biome.torchColor} />
      <RuneSpin mats={mats} />
      <Motes kind={biome.motes.kind} color={biome.motes.color} height={WALL_HEIGHT} />
    </group>
  );
}

function partsFor(biome: Biome, m: BiomeMaterials): Record<DecorKind, Part[]> {
  const stone = m.walls[0];
  const growth: Record<Biome["style"]["growth"], Part[]> = {
    mushroom: [
      [geometry.mushroomStems(), m.growthBody],
      [geometry.mushroomCaps(), m.growthGlow],
    ],
    crystal: [[geometry.crystals(), m.growthGlow]],
    slag: [
      [geometry.slagRocks(), m.growthBody],
      [geometry.slagEmbers(), m.growthGlow],
    ],
    eye: [
      [geometry.eyeStalks(), m.growthBody],
      [geometry.eyeBalls(), m.growthGlow],
    ],
  };
  return {
    pillar: [[geometry.pillar(), stone]],
    beam: [[geometry.beam(), m.beam]],
    lintel: [[geometry.lintel(), stone]],
    pilaster: [[geometry.pilaster(), stone]],
    rubble: [[geometry.rubble(), stone]],
    bones: [[geometry.bones(), m.bone]],
    web: [[geometry.web(), m.web]],
    chain: [[geometry.chain(), m.iron]],
    growth: growth[biome.style.growth],
    pool: [[geometry.pool(), m.pool]],
    brazier: [
      [geometry.brazierIron(), m.iron],
      [geometry.brazierCoals(), m.coals],
    ],
    runeCircle: [[geometry.runeCircle(), m.rune]],
    // Crystal caves drip glowing crystal instead of stone.
    stalactite: [[geometry.stalactite(), biome.style.growth === "crystal" ? m.growthGlow : stone]],
  };
}

/** Brazier fires: pooled light sources with a shared flicker, and a spark
 * now and then from a random bowl. */
function Braziers({ items, color }: { items: DecorItem[]; color: string }) {
  const lights = useRef<DynamicLightSource[]>([]);
  const sparkClock = useRef(0);
  useEffect(() => {
    lights.current = items.map((d) =>
      addLightSource({ position: [d.pos[0], 1.35, d.pos[2]], color, intensity: 6, distance: 9, priority: 1 }),
    );
    return () => {
      for (const l of lights.current) removeLightSource(l);
      lights.current = [];
    };
  }, [items, color]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    lights.current.forEach((l, i) => {
      l.intensity = 6 + Math.sin(t * 8.1 + i * 1.7) * 1.1 + Math.sin(t * 19.3 + i) * 0.7;
    });
    sparkClock.current -= dt;
    if (sparkClock.current <= 0 && items.length) {
      sparkClock.current = 0.12;
      const d = items[Math.floor(Math.random() * items.length)];
      spawnBurst({
        position: [d.pos[0], 1.15, d.pos[2]],
        count: 1,
        color: [color, "#ffd08a"],
        speed: 0.4,
        upward: 1.6,
        ttl: 0.9,
        size: 0.05,
        gravity: 0.4,
        drag: 0.5,
      });
    }
  });
  return null;
}

/** Rune circles turn slowly — one texture rotation serves them all. */
function RuneSpin({ mats }: { mats: BiomeMaterials }) {
  useFrame(({ clock }) => {
    const map = mats.rune.map;
    if (map) map.rotation = clock.elapsedTime * 0.08;
    mats.rune.opacity = 0.55 + Math.sin(clock.elapsedTime * 1.7) * 0.15;
  });
  return null;
}
