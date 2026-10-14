import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { WALL_HEIGHT } from "../core/config";
import { hashSeed } from "../core/rng";
import { AmbientParticles } from "../fx/AmbientParticles";
import { FloorDecals } from "../fx/decals/FloorDecals";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
import { resetRegistries } from "../game/registry";
import { resetNetEntities, setExpectedEntities } from "../net/entities";
import { PlayerController } from "../player/PlayerController";
import { floorTint, turnHue } from "../render/floorTint";
import { FloorLighting } from "../render/lighting/FloorLighting";
import { RuneCircleModel } from "../render/models/RuneCircleModel";
import { useFloorAtmosphere } from "../scenes/floorAtmosphere";
import { WallsAndFloor } from "../scenes/DungeonFloor";
import { getBiomeDef } from "../world/biomes";
import { LoreRunes } from "../world/loreRunes";
import { Torch } from "../world/props";
import type { Vec3 } from "../world/types";
import { startingStone, VARR_GOLD } from "./arenaFlow";
import type { ArenaLayout } from "./layout";

/** The Proving Ground on screen: the dungeon's own shell (stone, light grid,
 * colonnades, dressing, torches, the Founders' inscription) with the hall's
 * own marks — a glowing stone at every place a wizard may rise, and Varr's
 * great sigil at the hall's heart. No monsters, no loot, no rift: the only
 * thing down here is each other. */
export function ArenaFloor({ layout }: { layout: ArenaLayout }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useFloorAtmosphere(layout);
  const biome = getBiomeDef(layout.biome);
  const { ambientColor, torchColors } = useMemo(() => {
    const turn = floorTint(layout.seed).hue;
    return {
      ambientColor: turnHue(biome.ambient.color, turn),
      // A warmer flame than the deep's: the hall is kept.
      torchColors: layout.torches.map((p) => turnHue("#ffae5a", (((hashSeed(p.join(",")) % 1000) / 1000) * 2 - 1) * 0.08)),
    };
  }, [layout, biome]);

  useEffect(() => {
    setExpectedEntities([]);
    const warmup = requestAnimationFrame(() => gl.compile(scene, camera));
    return () => {
      cancelAnimationFrame(warmup);
      resetRegistries();
      resetNetEntities();
    };
  }, [scene, gl, camera]);

  const spawn = useMemo(() => startingStone(layout), [layout]);

  return (
    <group>
      {/* A touch brighter than the deep: the hall is kept, and lit to fight in. */}
      <ambientLight intensity={biome.ambient.intensity * 1.35} color={ambientColor} />
      <WallsAndFloor layout={layout} sigil={false} />
      <FloorLighting layout={layout} torchColors={torchColors} />
      <FloorDecals />
      <AmbientParticles biome={layout.biome} omen={null} ceiling={WALL_HEIGHT} />
      {layout.torches.map((pos, i) => (
        <Torch key={i} position={pos} color={torchColors[i]} intensity={biome.torchIntensityMult * 1.15} />
      ))}
      <LoreRunes runes={layout.lore} />
      {layout.spawns.map((p, i) => (
        <SpawnStone key={i} position={p} />
      ))}
      <HallSigil position={layout.treasure} />
      <PlayerController spawn={spawn} />
    </group>
  );
}

/** Where a wizard rises: a ring of Varr's ember-gold on the flags, and a
 * low glow off it. */
function SpawnStone({ position }: { position: Vec3 }) {
  const at = useMemo<Vec3>(() => [position[0], 0.02, position[2]], [position]);
  useEffect(() => {
    const light = addLightSource({ position: [at[0], 0.5, at[2]], color: VARR_GOLD, intensity: 4, distance: 5, priority: 1 });
    return () => removeLightSource(light);
  }, [at]);
  return <RuneCircleModel position={at} radius={1.4} accent={VARR_GOLD} />;
}

/** Varr's mark at the hall's heart: the great circle every bout turns on. */
function HallSigil({ position }: { position: Vec3 }) {
  const at = useMemo<Vec3>(() => [position[0], 0.02, position[2]], [position]);
  useEffect(() => {
    const light = addLightSource({ position: [at[0], 0.8, at[2]], color: "#ff5a3c", intensity: 8, distance: 9, priority: 1 });
    return () => removeLightSource(light);
  }, [at]);
  return <RuneCircleModel position={at} radius={3.2} accent="#ff5a3c" />;
}
