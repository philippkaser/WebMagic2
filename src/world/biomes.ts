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
 * are a contract with render/textures: every one must exist there. A
 * ceiling may be any of them — most halls are vaulted in their own stone. */
export const BIOME_SURFACE_IDS = [
  "tomb",
  "wetstone",
  "basalt",
  "slate",
  "palestone",
  "flagstone",
  "wetslab",
  "obsidian",
  "polished",
  "ashflag",
  "void",
] as const;
export type BiomeSurfaceId = (typeof BIOME_SURFACE_IDS)[number];

/** How a biome's architecture is weathered and lit, beyond its textures.
 * Colours are sRGB hex like everywhere else (multipliers included — three
 * linearises them, so "#c8c8c8" darkens by ~40%, not 20%). */
export interface BiomeLook {
  /** Wall-foot damp band and the fade toward the vault
   * (render/models/wallMaterial.ts). */
  stone: { dampTint: string; dampHeight: number; dampGloss: number; vaultShade: number };
  /** The floor mirror (render/models/DungeonGround.tsx): how strongly it
   * reflects and how much rough texels blur. null = a matte floor, which
   * skips the mirror pass entirely. */
  reflection: { strength: number; blur: number } | null;
  /** Light shafts through cracks in the vault — or, `rising`, heat haze. */
  shaft: { color: string; strength: number; rising?: boolean };
  /** Glowing seams at the foot of the walls: share of wall faces and their
   * colour. The only glow built into the architecture, kept rare and at
   * floor level. Absent = none. */
  seams?: { chance: number; color: string };
}

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
  /** Strength of the scene's procedural environment map on this band
   * (scene.environmentIntensity — three ignores a material's own
   * envMapIntensity when the env comes from the scene). The env is generic
   * warm/violet/blue panels: a wet sheen that suits the Drowned Halls, but
   * off-palette patches in a polished Crystal Deep floor. */
  envIntensity: number;
  /** Flame/light colour of wall torches. */
  torchColor: string;
  /** Scales torch light intensity (the flicker keeps its shape). */
  torchIntensityMult: number;
  /** The wizard's own light (player/StaffView) while on this band. It is
   * the strongest light on screen — everything near you is lit by it — so
   * it must agree with the band's palette: warm against the teal Drowned
   * Halls, silver in the Hollow's night. */
  lantern: { color: string; intensity: number };
  /** Texture ids for the three dungeon surfaces. */
  surfaces: { wall: BiomeSurfaceId; floor: BiomeSurfaceId; ceiling: BiomeSurfaceId };
  look: BiomeLook;
  /** Multipliers on the generator's per-kind enemy weights (missing = 1).
   * They reshape the mix of kinds already introduced at this depth; they
   * never introduce a kind early. */
  enemyWeights: Partial<Record<EnemyKind, number>>;
}

/** One material language for every band (see render/textures/painters):
 * calm, low-contrast stone whose detail lives in normals and roughness, and
 * a mood carried by LIGHT and FOG — the torch colour, the ambient, the fog
 * the distance dissolves into, the tint of the shafts. The Drowned Halls
 * were the reference: a restrained palette, wet surfaces that glint, and a
 * fog that turns everything far away into the biome's own colour. */
export const BIOME_DEFS: readonly BiomeDef[] = [
  {
    // An ancient damp tomb in warm torchlight: dressed stone, worn flags
    // with glossy wet patches, dusty warm light through the vault.
    id: "catacombs",
    name: "The Catacombs",
    epithet: "The builders' tombs, where every descent begins and many end.",
    floors: [1, 9],
    fog: { color: "#110c0a", near: 6, far: 42 },
    background: "#110c0a",
    // Cool shadow against warm flame: the split that gives the tomb depth.
    ambient: { color: "#50608e", intensity: 0.15 },
    envIntensity: 0.35,
    torchColor: "#ff8f45",
    torchIntensityMult: 1.15,
    lantern: { color: "#ffb877", intensity: 24 },
    surfaces: { wall: "tomb", floor: "flagstone", ceiling: "tomb" },
    look: {
      stone: { dampTint: "#b8b0a8", dampHeight: 1.3, dampGloss: 0.45, vaultShade: 0.6 },
      reflection: { strength: 0.75, blur: 1.2 },
      shaft: { color: "#ffd49a", strength: 0.2 },
    },
    enemyWeights: {},
  },
  {
    // Cold teal mist, brine on the stones, standing water that mirrors the
    // torches: sight lines shorten, and the slow, wet things thrive.
    id: "drowned",
    name: "The Drowned Halls",
    epithet: "Where the sea got in, and never found its way back out.",
    floors: [10, 19],
    fog: { color: "#08181c", near: 5, far: 36 },
    background: "#08181c",
    ambient: { color: "#4f9aa6", intensity: 0.18 },
    envIntensity: 0.8,
    torchColor: "#8fe6d4",
    torchIntensityMult: 0.95,
    lantern: { color: "#ffb877", intensity: 24 },
    surfaces: { wall: "wetstone", floor: "wetslab", ceiling: "wetstone" },
    look: {
      stone: { dampTint: "#a4c2c2", dampHeight: 1.7, dampGloss: 0.3, vaultShade: 0.6 },
      reflection: { strength: 1.1, blur: 1.4 },
      shaft: { color: "#a6efe6", strength: 0.24 },
    },
    enemyWeights: { slime: 1.6, wisp: 1.1, sentry: 0.8, shadow: 0.8 },
  },
  {
    // Calm dark basalt; the heat is in the LIGHT — deep orange torches, a
    // red-brown haze — and in a few seams glowing where wall meets floor.
    // The Founders' wardstones were cut here, so sentries stand thickest.
    id: "forge",
    name: "The Ember Forge",
    epithet: "Where the Founders hammered out their wards, and the fires never cooled.",
    floors: [20, 34],
    fog: { color: "#2a0e06", near: 5, far: 38 },
    background: "#2a0e06",
    ambient: { color: "#a2421c", intensity: 0.22 },
    envIntensity: 0.25,
    torchColor: "#ff5e1c",
    torchIntensityMult: 1.45,
    lantern: { color: "#ff9a5c", intensity: 22 },
    surfaces: { wall: "basalt", floor: "obsidian", ceiling: "basalt" },
    look: {
      stone: { dampTint: "#a09088", dampHeight: 1.1, dampGloss: 0.85, vaultShade: 0.55 },
      reflection: { strength: 0.95, blur: 1 },
      shaft: { color: "#ff7a30", strength: 0.06, rising: true },
      seams: { chance: 0.13, color: "#ff7424" },
    },
    enemyWeights: { sentry: 1.8, wisp: 0.9, slime: 0.6 },
  },
  {
    // Dark slate and polished floors; the colour is in the crystals growing
    // from the corners and the violet light they cast. The long sight lines
    // of a cavern that sings, and more drifting lights than anywhere else.
    id: "crystal",
    name: "The Crystal Deep",
    epithet: "The dungeon's singing bones, cold light caught in stone.",
    floors: [35, 54],
    fog: { color: "#0d0a1e", near: 7, far: 48 },
    background: "#0d0a1e",
    ambient: { color: "#6a52cc", intensity: 0.28 },
    envIntensity: 0.15,
    torchColor: "#8fdcff",
    torchIntensityMult: 1.05,
    lantern: { color: "#cdb8ff", intensity: 22 },
    surfaces: { wall: "slate", floor: "polished", ceiling: "slate" },
    look: {
      stone: { dampTint: "#b8b0d4", dampHeight: 1, dampGloss: 0.5, vaultShade: 0.6 },
      reflection: { strength: 1.15, blur: 0.8 },
      shaft: { color: "#b690ff", strength: 0.2 },
    },
    enemyWeights: { wisp: 1.5, sentry: 1.2, slime: 0.7, shadow: 0.9 },
  },
  {
    // Pale bone-white stone at night: drained of colour, cold silver-blue
    // light, deep shadow, a thin mist — and the one floor that doesn't
    // shine. Near-silent. Oathbreakers' shadows.
    id: "hollow",
    name: "The Hollow",
    epithet: "Near the bottom the silence is so complete it listens back.",
    floors: [55, 100],
    fog: { color: "#1a1f2a", near: 5, far: 34 },
    background: "#1a1f2a",
    ambient: { color: "#94a4c8", intensity: 0.15 },
    envIntensity: 0.2,
    torchColor: "#bccfff",
    torchIntensityMult: 0.7,
    lantern: { color: "#c8d4f0", intensity: 12 },
    surfaces: { wall: "palestone", floor: "ashflag", ceiling: "void" },
    look: {
      stone: { dampTint: "#c4c8d0", dampHeight: 0.9, dampGloss: 1, vaultShade: 0.35 },
      reflection: null,
      shaft: { color: "#c9d6ff", strength: 0.22 },
    },
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
