import { useEffect, useMemo } from "react";
import { WALL_HEIGHT } from "../../core/config";
import { CEIL_SPAN, type CeilingSurface, type WallSurface } from "../textures";
import { MeshBuilder, buildWallMesh } from "./architectureMesh";
import { toGeometry } from "./meshGeometry";
import { type SurfaceGlow, dungeonMaterial, useBreathingGlow } from "./wallMaterial";

/** The floor's walls and vault, dressed in the band's painted surfaces:
 * every wall face that borders floor in one mesh (one draw, the variant
 * atlas picks each face's look), and the ceiling as one world-mapped quad.
 * Painted glow breathes with the band. Presentational: colliders and
 * lights are the scene's (scenes/DungeonFloor.tsx). */

export interface DungeonStoneProps {
  tiles: Uint8Array;
  size: number;
  extent: number;
  /** Floor seed: which wall faces get which variant. */
  seed: number;
  wall: WallSurface;
  ceiling: CeilingSurface;
  glow: SurfaceGlow;
}

export function DungeonStone({ tiles, size, extent, seed, wall, ceiling, glow }: DungeonStoneProps) {
  const geo = useMemo(() => {
    const vault = new MeshBuilder(CEIL_SPAN);
    vault.quad(
      [-extent, WALL_HEIGHT, -extent],
      [extent, WALL_HEIGHT, -extent],
      [extent, WALL_HEIGHT, extent],
      [-extent, WALL_HEIGHT, extent],
      [0, -1, 0],
    );
    return { walls: toGeometry(buildWallMesh({ tiles, size, seed })), ceiling: toGeometry(vault.build()) };
  }, [tiles, size, extent, seed]);
  useEffect(
    () => () => {
      geo.walls.dispose();
      geo.ceiling.dispose();
    },
    [geo],
  );

  const mats = useMemo(() => [dungeonMaterial(wall), dungeonMaterial(ceiling)], [wall, ceiling]);
  useBreathingGlow(mats, glow);

  return (
    <group>
      <mesh geometry={geo.walls} material={mats[0]} castShadow receiveShadow />
      <mesh geometry={geo.ceiling} material={mats[1]} />
    </group>
  );
}
