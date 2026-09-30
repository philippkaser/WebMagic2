/** Depth bands of the dungeon. Each biome restyles the same generated
 * architecture — textures, fog, light — so descending *feels* like going
 * somewhere. Pure data; the renderer and spawn table read it. */
export interface Biome {
  id: string;
  /** Shown on arrival ("The Catacombs"). */
  name: string;
  /** First floor of this band. */
  fromFloor: number;
  fog: { color: string; near: number; far: number };
  ambient: { color: string; intensity: number };
  torchColor: string;
}

export const BIOMES: readonly Biome[] = [
  {
    id: "catacombs",
    name: "The Catacombs",
    fromFloor: 1,
    fog: { color: "#070409", near: 9, far: 50 },
    ambient: { color: "#5a6a9a", intensity: 0.14 },
    torchColor: "#ff9a4d",
  },
];

export function biomeFor(floor: number): Biome {
  let current = BIOMES[0];
  for (const b of BIOMES) if (floor >= b.fromFloor) current = b;
  return current;
}
