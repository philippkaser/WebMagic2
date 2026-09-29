import type { BiomeId, EnemyKind } from "./types";

/** Depth biomes as pure data — the single table of how each band of the
 * dungeon looks, lights and who lives there. The generator reads the monster
 * mix; the renderer reads everything else. Bands are contiguous and cover
 * 1..100, so every floor belongs to exactly one biome.
 *
 * The fiction: the Catacombs are the builders' tombs, the Drowned Halls are
 * where the sea got in, the Ember Forge is where the Founders forged their
 * wards, the Crystal Deep is the dungeon's singing bones, and the Hollow —
 * near the bottom — is silence, pale light, and something listening. */

/** Procedural texture ids a biome may dress its surfaces with. These names
 * are a contract with render/textures: every one must exist there. */
export const BIOME_SURFACE_IDS = [
  "stone",
  "slab",
  "dark",
  "wetstone",
  "wetslab",
  "basalt",
  "ashslab",
  "crystal",
  "crystalslab",
  "bone",
  "boneslab",
  "void",
] as const;
export type BiomeSurfaceId = (typeof BIOME_SURFACE_IDS)[number];

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** One evocative line — arrival banners, the dev room, docs. */
  epithet: string;
  /** Inclusive floor band [from, to]. */
  floors: readonly [from: number, to: number];
  /** Scene fog (three.js linear Fog). Keep `color` equal to `background` so
   * distant walls dissolve into the backdrop instead of silhouetting. */
  fog: { color: string; near: number; far: number };
  background: string;
  ambient: { color: string; intensity: number };
  /** Flame/light colour of wall torches. */
  torchColor: string;
  /** Scales torch light intensity (the flicker keeps its shape). */
  torchIntensityMult: number;
  /** Texture ids for the three dungeon surfaces. */
  surfaces: { wall: BiomeSurfaceId; floor: BiomeSurfaceId; ceiling: BiomeSurfaceId };
  /** Multipliers on the generator's per-kind enemy weights (missing = 1).
   * They reshape the mix of kinds already introduced at this depth; they
   * never introduce a kind early. */
  enemyWeights: Partial<Record<EnemyKind, number>>;
}

export const BIOME_DEFS: readonly BiomeDef[] = [
  {
    // The look every floor had before biomes existed — keep it exact.
    id: "catacombs",
    name: "The Catacombs",
    epithet: "The builders' tombs, where every descent begins and many end.",
    floors: [1, 9],
    fog: { color: "#070409", near: 9, far: 50 },
    background: "#070409",
    ambient: { color: "#5a6a9a", intensity: 0.14 },
    torchColor: "#ff9a4d",
    torchIntensityMult: 1,
    surfaces: { wall: "stone", floor: "slab", ceiling: "dark" },
    enemyWeights: {},
  },
  {
    // Cold teal mist, brine on the stones: sight lines shorten, and the
    // slow, wet things thrive.
    id: "drowned",
    name: "The Drowned Halls",
    epithet: "Where the sea got in, and never found its way back out.",
    floors: [10, 19],
    fog: { color: "#08181c", near: 5, far: 36 },
    background: "#08181c",
    ambient: { color: "#4f9aa6", intensity: 0.18 },
    torchColor: "#8fe6d4",
    torchIntensityMult: 0.85,
    surfaces: { wall: "wetstone", floor: "wetslab", ceiling: "dark" },
    enemyWeights: { slime: 1.6, wisp: 1.1, sentry: 0.8, shadow: 0.8 },
  },
  {
    // Deep red-orange heat haze; the Founders' wardstones were cut here, so
    // sentries stand thickest.
    id: "forge",
    name: "The Ember Forge",
    epithet: "Where the Founders hammered out their wards, and the fires never cooled.",
    floors: [20, 34],
    fog: { color: "#1a0703", near: 8, far: 44 },
    background: "#1a0703",
    ambient: { color: "#b04a2a", intensity: 0.2 },
    torchColor: "#ff6a22",
    torchIntensityMult: 1.25,
    surfaces: { wall: "basalt", floor: "ashslab", ceiling: "dark" },
    enemyWeights: { sentry: 1.8, wisp: 0.9, slime: 0.6 },
  },
  {
    // Violet dark, cyan glints: the long sight lines of a cavern that sings,
    // and more drifting lights than anywhere else.
    id: "crystal",
    name: "The Crystal Deep",
    epithet: "The dungeon's singing bones, cold light caught in stone.",
    floors: [35, 54],
    fog: { color: "#0d0819", near: 10, far: 58 },
    background: "#0d0819",
    ambient: { color: "#7c5ccc", intensity: 0.2 },
    torchColor: "#8fe3ff",
    torchIntensityMult: 1.1,
    surfaces: { wall: "crystal", floor: "crystalslab", ceiling: "dark" },
    enemyWeights: { wisp: 1.5, sentry: 1.2, slime: 0.7, shadow: 0.9 },
  },
  {
    // Pale and drained of colour, near-silent; the few torches burn small and
    // warm against a grey that swallows distance. Oathbreakers' shadows.
    id: "hollow",
    name: "The Hollow",
    epithet: "Near the bottom the silence is so complete it listens back.",
    floors: [55, 100],
    fog: { color: "#23221f", near: 6, far: 34 },
    background: "#23221f",
    ambient: { color: "#a6a39a", intensity: 0.1 },
    torchColor: "#ffc98f",
    torchIntensityMult: 0.6,
    surfaces: { wall: "bone", floor: "boneslab", ceiling: "void" },
    enemyWeights: { shadow: 2, wisp: 1.3, sentry: 0.8, slime: 0.5 },
  },
];

const byId = new Map(BIOME_DEFS.map((d) => [d.id, d]));

export function getBiomeDef(id: BiomeId): BiomeDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown biome id: ${id}`);
  return def;
}

/** The biome a floor belongs to. Out-of-range floors clamp to the nearest
 * band (the dev room and tests sometimes ask about floor 0 or 101). */
export function biomeForFloor(floor: number): BiomeId {
  // Bands are sorted and contiguous, so the first band that hasn't ended yet
  // is the one this floor is in.
  for (const def of BIOME_DEFS) {
    if (floor <= def.floors[1]) return def.id;
  }
  return BIOME_DEFS[BIOME_DEFS.length - 1].id;
}
