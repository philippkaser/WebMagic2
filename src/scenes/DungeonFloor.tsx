import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, interactionGroups, RigidBody } from "@react-three/rapier";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getEnemyDef } from "../enemies/registry";
import { SpawnedEnemies } from "../enemies/SpawnedEnemies";
import { ARCHITECTURE, GROUPS, WALL_HEIGHT } from "../core/config";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { resetRegistries } from "../game/registry";
import { hashSeed } from "../core/rng";
import { resetNetEntities, setExpectedEntities } from "../net/entities";
import { useNet } from "../net/netStore";
import { PlayerController } from "../player/PlayerController";
import { CRYSTAL_COLORS, CrystalClusters } from "../render/models/CrystalClusterModel";
import { DungeonGround } from "../render/models/DungeonGround";
import { DungeonStone } from "../render/models/DungeonStone";
import { LightShafts } from "../render/models/LightShaftModel";
import { floorsUntilExit } from "../run/rules";
import { useGame } from "../state/gameStore";
import { LoreRunes } from "../world/loreRunes";
import { Breakable, Portal, Torch, TreasurePedestal } from "../world/props";
import { Trap } from "../world/traps";
import { getBiomeDef } from "../world/biomes";
import type { FloorLayout } from "../world/types";
import { useFloorAtmosphere } from "./floorAtmosphere";

const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

/** Regular enemies never despawn through the registry's onDeath (they manage
 * their own death); only the boss, rendered separately below, needs it. */
const NOOP = () => {};

/** Renders one generated dungeon floor: instanced walls with greedy-merged
 * colliders, torches, physics props, enemies, treasure and portals. */
export function DungeonFloor({ layout }: { layout: FloorLayout }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [bossAlive, setBossAlive] = useState(layout.boss !== null);
  const floorsOwed = useGame((s) => floorsUntilExit(s.run?.floorsPlayed ?? 0));

  useFloorAtmosphere(layout);
  const biome = getBiomeDef(layout.biome);

  useEffect(() => {
    // Tell replication which entity ids this floor spawns, so the host can
    // compute the dead set for late joiners.
    setExpectedEntities([
      ...layout.enemies.map((_, i) => `e${i}`),
      ...layout.props.map((_, i) => `p${i}`),
      ...(layout.boss ? ["boss"] : []),
    ]);
    // Pre-compile every material against the floor's final light count now,
    // during the load moment, instead of stuttering on the first explosion.
    const warmup = requestAnimationFrame(() => gl.compile(scene, camera));
    return () => {
      cancelAnimationFrame(warmup);
      resetRegistries();
      resetNetEntities();
    };
  }, [scene, gl, camera]);

  // Fan players out around the spawn tile so floor-mates don't materialize
  // inside each other.
  const spawnPoint = useMemo<typeof layout.spawn>(() => {
    const angle = (hashSeed(useNet.getState().playerId || "solo") % 6283) / 1000;
    return [
      layout.spawn[0] + Math.cos(angle) * 1.1,
      layout.spawn[1],
      layout.spawn[2] + Math.sin(angle) * 1.1,
    ];
  }, [layout.spawn]);

  const descend = () => void useGame.getState().descend();
  const walkHome = () => {
    document.exitPointerLock();
    useGame.getState().walkHome();
  };

  return (
    <group>
      <ambientLight intensity={biome.ambient.intensity} color={biome.ambient.color} />

      <WallsAndFloor layout={layout} />

      {layout.torches.map((pos, i) => (
        <Torch key={i} position={pos} color={biome.torchColor} intensity={biome.torchIntensityMult} />
      ))}
      {layout.props.map((prop, i) => (
        <Breakable
          key={i}
          kind={prop.kind}
          position={prop.pos}
          floor={layout.floor}
          entityId={`p${i}`}
        />
      ))}
      {layout.enemies.map((enemy, i) => (
        <Fragment key={i}>
          {getEnemyDef(enemy.kind).render({
            entityId: `e${i}`,
            pos: enemy.pos,
            floor: layout.floor,
            onDeath: NOOP,
          })}
        </Fragment>
      ))}
      <LoreRunes runes={layout.lore} />
      {layout.traps.map((trap, i) => (
        <Trap key={i} kind={trap.kind} pos={trap.pos} floor={layout.floor} />
      ))}
      {/* Enemies spawned at runtime (slime splits). */}
      <SpawnedEnemies />

      <TreasurePedestal position={layout.treasure} floor={layout.floor} seed={layout.seed} />

      {layout.boss &&
        bossAlive &&
        getEnemyDef("boss").render({
          entityId: "boss",
          pos: layout.boss,
          floor: layout.floor,
          onDeath: () => setBossAlive(false),
        })}

      <Portal
        position={layout.exit}
        color="#46ffd0"
        prompt={`E — Descend to floor ${layout.floor + 1}`}
        onUse={descend}
        locked={bossAlive}
        lockedPrompt="Sealed — the Warden of the Deep still lives"
      />
      {/* The way home: on every floor, but sealed until this run has paid
          the Tithe of Five (run/rules.ts). */}
      <Portal
        position={layout.leave}
        color="#ffd44f"
        prompt="E — Walk home (everything you carry becomes safe)"
        onUse={walkHome}
        locked={bossAlive || floorsOwed > 0}
        lockedPrompt={
          bossAlive
            ? "Sealed — the Warden of the Deep still lives"
            : `The way home is sealed — the deep wants ${floorsOwed} more floor${floorsOwed === 1 ? "" : "s"}`
        }
      />

      <PlayerController spawn={spawnPoint} />
    </group>
  );
}

/** The floor's architecture, dressed in its biome's surfaces: world-mapped
 * stonework (walls, base course, arch ribs, pillars) under a 7 m vault, a
 * floor that mirrors the torches (quality flag `reflections`), light
 * shafts, the Crystal Deep's clusters — and every collider they need. */
function WallsAndFloor({ layout }: { layout: FloorLayout }) {
  const biome = getBiomeDef(layout.biome);
  const reflections = useGame((s) => s.reflections);
  const { pillars, crystals, shafts } = layout.architecture;
  const B = ARCHITECTURE.pillarBase;

  return (
    <group>
      {/* All static colliders in one fixed body. */}
      <RigidBody type="fixed" colliders={false}>
        {layout.wallBoxes.map((box, i) => (
          <CuboidCollider
            key={i}
            args={box.half}
            position={box.center}
            collisionGroups={WORLD_GROUPS}
          />
        ))}
        <CuboidCollider
          args={[layout.extent, 0.5, layout.extent]}
          position={[0, -0.5, 0]}
          collisionGroups={WORLD_GROUPS}
        />
        <CuboidCollider
          args={[layout.extent, 0.5, layout.extent]}
          position={[0, WALL_HEIGHT + 0.5, 0]}
          collisionGroups={WORLD_GROUPS}
        />
        {pillars.map((p, i) => (
          <CuboidCollider
            key={`p${i}`}
            args={[B, WALL_HEIGHT / 2, B]}
            position={[p.pos[0], WALL_HEIGHT / 2, p.pos[2]]}
            collisionGroups={WORLD_GROUPS}
          />
        ))}
        {crystals.map((c, i) => (
          <CuboidCollider
            key={`c${i}`}
            args={[0.42 * c.scale, 0.9 * c.scale, 0.42 * c.scale]}
            position={[c.pos[0], 0.9 * c.scale, c.pos[2]]}
            collisionGroups={WORLD_GROUPS}
          />
        ))}
      </RigidBody>

      <DungeonStone
        tiles={layout.tiles}
        size={layout.size}
        extent={layout.extent}
        architecture={layout.architecture}
        wall={biome.surfaces.wall}
        ceiling={biome.surfaces.ceiling}
        look={biome.look.stone}
        seamChance={biome.look.seams?.chance ?? 0}
        seamColor={biome.look.seams?.color ?? "#000000"}
      />
      <DungeonGround
        extent={layout.extent}
        surface={biome.surfaces.floor}
        reflection={reflections ? biome.look.reflection : null}
      />
      <LightShafts shafts={shafts} look={biome.look.shaft} />
      <CrystalClusters crystals={crystals} />
      <ArchitectureLights layout={layout} />
    </group>
  );
}

/** Pooled light sources for the architecture that glows: a soft light under
 * each shaft (so the pool on the floor is real light the reflector and the
 * stone pick up) and one per crystal cluster, breathing slowly. They go
 * through fx/DynamicLights like torches — never a real light of their own. */
function ArchitectureLights({ layout }: { layout: FloorLayout }) {
  const biome = getBiomeDef(layout.biome);
  const crystalLights = useRef<DynamicLightSource[]>([]);

  useEffect(() => {
    const { shafts, crystals } = layout.architecture;
    const shaft = biome.look.shaft;
    const shaftLights = shafts.map((s) =>
      addLightSource({
        position: [s.pos[0], shaft.rising ? 0.6 : 2.2, s.pos[2]],
        color: shaft.color,
        intensity: (shaft.rising ? 10 : 16) * shaft.strength,
        distance: 6 + s.radius * 1.5,
        priority: 1,
      }),
    );
    const crystalSources = crystals.map((c) =>
      addLightSource({
        position: [c.pos[0] + Math.sin(c.facing) * 0.4, 1 * c.scale, c.pos[2] + Math.cos(c.facing) * 0.4],
        color: CRYSTAL_COLORS[c.hue],
        intensity: 6 * c.scale,
        distance: 9,
        priority: 1,
      }),
    );
    crystalLights.current = crystalSources;
    return () => {
      crystalLights.current = [];
      for (const l of shaftLights) removeLightSource(l);
      for (const l of crystalSources) removeLightSource(l);
    };
  }, [layout, biome]);

  // The Deep sings: each cluster's light swells and fades on its own beat.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const { crystals } = layout.architecture;
    const lights = crystalLights.current;
    for (let i = 0; i < lights.length; i++) {
      const c = crystals[i];
      lights[i].intensity = 6 * c.scale * (0.8 + 0.2 * Math.sin(t * 0.9 + c.pos[0] * 1.7 + c.pos[2]));
    }
  });

  return null;
}
