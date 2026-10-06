import { useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getEnemyDef } from "../enemies/registry";
import { SpawnedEnemies } from "../enemies/SpawnedEnemies";
import { TILE, WALL_HEIGHT } from "../core/config";
import { AmbientParticles } from "../fx/AmbientParticles";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
import { resetRegistries } from "../game/registry";
import { hashSeed } from "../core/rng";
import { resetNetEntities, setExpectedEntities } from "../net/entities";
import { useNet } from "../net/netStore";
import { PlayerController } from "../player/PlayerController";
import { floorTint, turnHue } from "../render/floorTint";
import { DungeonGround } from "../render/models/DungeonGround";
import { DungeonStone } from "../render/models/DungeonStone";
import { LightShafts } from "../render/models/LightShaftModel";
import { RuneCircleModel } from "../render/models/RuneCircleModel";
import { floorsUntilExit } from "../run/rules";
import { WORLD_GROUPS } from "../sim/bodies";
import { useGame } from "../state/gameStore";
import { LoreRunes } from "../world/loreRunes";
import { Breakable, Portal, Torch, TreasurePedestal } from "../world/props";
import { Trap } from "../world/traps";
import { getBiomeDef } from "../world/biomes";
import type { FloorLayout, Vec3 } from "../world/types";
import { useFloorAtmosphere } from "./floorAtmosphere";

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
  // The floor's tint (render/floorTint.ts): the ambient light turns with
  // the stone; torches take half the turn, each a little warmer or cooler.
  const { ambientColor, torchColors } = useMemo(() => {
    const turn = floorTint(layout.seed).hue;
    return {
      ambientColor: turnHue(biome.ambient.color, turn),
      torchColors: layout.torches.map((p) => turnHue(biome.torchColor, turn * 0.5 + (((hashSeed(p.join(",")) % 1000) / 1000) * 2 - 1) * 0.12)),
    };
  }, [layout, biome]);

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
      <ambientLight intensity={biome.ambient.intensity} color={ambientColor} />

      <WallsAndFloor layout={layout} />
      {/* The air itself: dust, spores, embers, glitter or ash per biome. */}
      <AmbientParticles biome={layout.biome} omen={layout.omen} ceiling={WALL_HEIGHT} />

      {layout.torches.map((pos, i) => (
        <Torch key={i} position={pos} color={torchColors[i]} intensity={biome.torchIntensityMult} />
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

/** The floor's architecture, dressed in its band's painted surfaces (the
 * artpass look): walls one painted face per tile under a 6 m vault, the
 * floor and ceiling world-mapped, light shafts falling through the vault,
 * the arrival sigil at the spawn — and every collider they need. The floor
 * mirror only runs when the `reflections` quality flag is on (default off).
 * The generator still plans arcades and crystal clusters
 * (layout.architecture); for now only the shafts render. */
function WallsAndFloor({ layout }: { layout: FloorLayout }) {
  const biome = getBiomeDef(layout.biome);
  const reflections = useGame((s) => s.reflections);
  const { shafts } = layout.architecture;
  const sigilRadius = useMemo(() => arrivalSigilRadius(layout), [layout]);

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
      </RigidBody>

      <DungeonStone
        tiles={layout.tiles}
        size={layout.size}
        extent={layout.extent}
        seed={layout.seed}
        wall={biome.surfaces.wall}
        ceiling={biome.surfaces.ceiling}
        glow={biome.glow}
      />
      <DungeonGround
        extent={layout.extent}
        surface={biome.surfaces.floor}
        reflection={reflections ? biome.look.reflection : null}
        glow={biome.glow}
      />
      {sigilRadius > 0 && <RuneCircleModel position={layout.spawn} radius={sigilRadius} accent={biome.accent} />}
      <LightShafts shafts={shafts} look={biome.look.shaft} />
      <ShaftLights layout={layout} />
    </group>
  );
}

/** The arrival sigil's radius: up to 2.4 m (the artpass circle), shrunk to
 * stay a little clear of the walls of the room the spawn stands in; 0 = no
 * room for one. */
function arrivalSigilRadius(layout: FloorLayout): number {
  const [sx, , sz] = layout.spawn;
  const half = layout.size / 2;
  let clearance = 0;
  for (const room of layout.rooms) {
    const x0 = (room.x - half) * TILE;
    const x1 = (room.x + room.w - half) * TILE;
    const z0 = (room.y - half) * TILE;
    const z1 = (room.y + room.h - half) * TILE;
    if (sx < x0 || sx > x1 || sz < z0 || sz > z1) continue;
    clearance = Math.max(clearance, Math.min(sx - x0, x1 - sx, sz - z0, z1 - sz));
  }
  const r = Math.min(2.4, clearance - 0.4);
  return r >= 1 ? r : 0;
}

/** A soft pooled light under each shaft, so the pool on the floor is real
 * light the painted stone picks up. Through fx/DynamicLights like torches —
 * never a real light of its own. */
function ShaftLights({ layout }: { layout: FloorLayout }) {
  const biome = getBiomeDef(layout.biome);
  useEffect(() => {
    const shaft = biome.look.shaft;
    const lights = layout.architecture.shafts.map((s) =>
      addLightSource({
        position: [s.pos[0], shaft.rising ? 0.6 : 2.2, s.pos[2]] as Vec3,
        color: shaft.color,
        intensity: (shaft.rising ? 10 : 16) * shaft.strength,
        distance: 6 + s.radius * 1.5,
        priority: 1,
      }),
    );
    return () => {
      for (const l of lights) removeLightSource(l);
    };
  }, [layout, biome]);
  return null;
}
