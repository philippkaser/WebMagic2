import type { BiomeId, EnemyKind } from "./types";

/** Depth biomes as pure data — the single table of how each band of the
 * dungeon looks, lights and who lives there. The generator reads the monster
 * mix; the renderer reads everything else. Bands are contiguous and cover
 * 1..100, so every floor belongs to exactly one biome.
 *
 * The fiction: the Catacombs are the builders' tombs, the Drowned Halls are
 * where the sea got in, the Ember Forge is where the Founders forged their
 * wards, the Crystal Deep is the dungeon's singing bones, and the Hollow —
 * near the bottom — is silence, crimson dark, and something listening. */

/** Procedural texture ids a biome may dress its surfaces with: the
 * architecture kinds of render/textures, `<set>-<part>`, one painted set
 * per artpass biome. These names are a contract with render/textures: every
 * one must exist there (tested). */
export const BIOME_SURFACE_IDS = [
  "catacombs-wall",
  "catacombs-floor",
  "catacombs-ceiling",
  "drowned-wall",
  "drowned-floor",
  "drowned-ceiling",
  "forge-wall",
  "forge-floor",
  "forge-ceiling",
  "crystal-wall",
  "crystal-floor",
  "crystal-ceiling",
  "abyss-wall",
  "abyss-floor",
  "abyss-ceiling",
] as const;
export type BiomeSurfaceId = (typeof BIOME_SURFACE_IDS)[number];
type Part<P extends string> = Extract<BiomeSurfaceId, `${string}-${P}`>;

/** Split-tone colour grade applied in post (render/Effects.tsx): the
 * band's mood pushed into the image itself. */
export interface Grade {
  /** Tint pushed into the darks. */
  shadows: string;
  /** Tint pulled into the lights. */
  highlights: string;
  saturation: number;
  contrast: number;
}

/** How the air of a place bends the image, beyond its colour (the post
 * chain, render/Effects.tsx, eases into it with the grade). */
export interface Air {
  /** Heat shimmer: the air wavers, more the further you look (0 = still). */
  haze: number;
  /** The lens's colour fringe toward the rim, at rest (1 = the usual). */
  dispersion: number;
  /** How much the rim of sight slowly breathes (0 = steady). */
  breath: number;
  /** Film grain (1 = the usual). */
  grain: number;
  /** Vignette strength (0 = none, 1 = heavy). */
  vignette: number;
  /** The light the eye is used to here: the log2 luminance of a typical
   * view. The eye adapts around it, so the band keeps the darkness it was
   * painted with, while a lit hall in it still dazzles and a black corridor
   * slowly opens up. */
  eye: number;
}

/** How a biome's architecture is lit beyond its textures. Colours are sRGB
 * hex like everywhere else. */
export interface BiomeLook {
  /** The floor mirror (render/models/DungeonGround.tsx) when the
   * `reflections` quality flag is on: how strongly it reflects and how much
   * rough texels blur. null = a matte floor even then. */
  reflection: { strength: number; blur: number } | null;
  /** Light shafts through cracks in the vault — or, `rising`, heat haze. */
  shaft: { color: string; strength: number; rising?: boolean };
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
   * envMapIntensity when the env comes from the scene): what the wet and
   * polished texels of the painted surfaces glint with. */
  envIntensity: number;
  /** Flame/light colour of wall torches. */
  torchColor: string;
  /** Scales torch light intensity (the flicker keeps its shape). */
  torchIntensityMult: number;
  /** The wizard's own light (player/StaffView) while on this band. It is
   * the strongest light on screen — everything near you is lit by it. */
  lantern: { color: string; intensity: number };
  /** Texture ids for the three dungeon surfaces. */
  surfaces: { wall: Part<"wall">; floor: Part<"floor">; ceiling: Part<"ceiling"> };
  /** The painted glow in the band's surfaces (lume specks, magma seams,
   * crystal veins, bleeding runes): emissive strength and how much it
   * breathes over time (0 = steady). */
  glow: { intensity: number; pulse: number };
  /** The band's colour grade (render/Effects.tsx eases into it on arrival). */
  grade: Grade;
  /** The band's air: shimmer, lens, breath, grain, vignette. */
  air: Air;
  /** Glow colour of the band's sigils — the arrival rune circle. */
  accent: string;
  look: BiomeLook;
  /** Multipliers on the generator's per-kind enemy weights (missing = 1).
   * They reshape the mix of kinds already introduced at this depth; they
   * never introduce a kind early. */
  enemyWeights: Partial<Record<EnemyKind, number>>;
}

/** The artpass look, band by band: painted pixel-art surfaces with palette
 * ramps and tiny emissive specks, glow through bloom, and the mood carried
 * by fog, light and a split-tone grade. (Fog, light, torch, glow and grade
 * values are the artpass branch's, mapped onto our bands; the Hollow wears
 * its abyss.) */
export const BIOME_DEFS: readonly BiomeDef[] = [
  {
    // Warm sandstone ossuary brick in torchlight, cool violet in the shadow.
    id: "catacombs",
    name: "The Catacombs",
    epithet: "The builders' tombs, where every descent begins and many end.",
    floors: [1, 9],
    fog: { color: "#0b0706", near: 8, far: 46 },
    background: "#0b0706",
    ambient: { color: "#7080b0", intensity: 0.28 },
    envIntensity: 1,
    torchColor: "#ff9a4d",
    torchIntensityMult: 1,
    lantern: { color: "#ffb877", intensity: 26 },
    surfaces: { wall: "catacombs-wall", floor: "catacombs-floor", ceiling: "catacombs-ceiling" },
    glow: { intensity: 1.2, pulse: 0 },
    grade: { shadows: "#1c1030", highlights: "#ffd49a", saturation: 0.85, contrast: 1.08 },
    air: { haze: 0, dispersion: 0.5, breath: 0, grain: 1, vignette: 0.95, eye: -7.2 },
    accent: "#e0b060",
    look: {
      reflection: { strength: 0.75, blur: 1.2 },
      shaft: { color: "#ffd49a", strength: 0.2 },
    },
    enemyWeights: {},
  },
  {
    // Sea-green ashlar furred with moss from the vault, a black tide line,
    // lume specks, standing water — and teal fire. Sight lines shorten, and
    // the slow, wet things thrive.
    id: "drowned",
    name: "The Drowned Halls",
    epithet: "Where the sea got in, and never found its way back out.",
    floors: [10, 19],
    fog: { color: "#041110", near: 5, far: 34 },
    background: "#041110",
    ambient: { color: "#3a8a80", intensity: 0.2 },
    envIntensity: 1,
    torchColor: "#5cffc8",
    torchIntensityMult: 1,
    lantern: { color: "#ffb877", intensity: 26 },
    surfaces: { wall: "drowned-wall", floor: "drowned-floor", ceiling: "drowned-ceiling" },
    glow: { intensity: 1.6, pulse: 0.2 },
    grade: { shadows: "#002a2c", highlights: "#c0ffe8", saturation: 0.82, contrast: 1.05 },
    // Damp air: the rim of sight breathes faintly, like a tide.
    air: { haze: 0, dispersion: 0.6, breath: 0.35, grain: 0.85, vignette: 0.95, eye: -7.7 },
    accent: "#5cffd8",
    look: {
      reflection: { strength: 1.1, blur: 1.4 },
      shaft: { color: "#a6efe6", strength: 0.24 },
    },
    enemyWeights: { slime: 1.6, wisp: 1.1, sentry: 0.8, shadow: 0.8 },
  },
  {
    // Columnar basalt split by seams that still glow, magma-veined floors.
    // The Founders' wardstones were cut here, so sentries stand thickest.
    id: "forge",
    name: "The Ember Forge",
    epithet: "Where the Founders hammered out their wards, and the fires never cooled.",
    floors: [20, 34],
    fog: { color: "#0f0605", near: 8, far: 46 },
    background: "#0f0605",
    ambient: { color: "#7a5a5a", intensity: 0.17 },
    envIntensity: 1,
    torchColor: "#ff6a1a",
    torchIntensityMult: 1,
    lantern: { color: "#ffb877", intensity: 26 },
    surfaces: { wall: "forge-wall", floor: "forge-floor", ceiling: "forge-ceiling" },
    glow: { intensity: 1.5, pulse: 0.25 },
    grade: { shadows: "#240a04", highlights: "#ffc07a", saturation: 1.05, contrast: 1.12 },
    // The air over the magma shimmers.
    air: { haze: 1, dispersion: 0.5, breath: 0, grain: 1.1, vignette: 0.9, eye: -7.4 },
    accent: "#ff7a1a",
    look: {
      reflection: { strength: 0.95, blur: 1 },
      shaft: { color: "#ff7a30", strength: 0.06, rising: true },
    },
    enemyWeights: { sentry: 1.8, wisp: 0.9, slime: 0.6 },
  },
  {
    // Indigo strata threaded with glowing veins, geodes, a ceiling of
    // glints. The long sight lines of a cavern that sings.
    id: "crystal",
    name: "The Crystal Deep",
    epithet: "The dungeon's singing bones, cold light caught in stone.",
    floors: [35, 54],
    fog: { color: "#08061c", near: 7, far: 50 },
    background: "#08061c",
    ambient: { color: "#6a5aff", intensity: 0.22 },
    envIntensity: 1,
    torchColor: "#a58cff",
    torchIntensityMult: 1,
    lantern: { color: "#ffb877", intensity: 26 },
    surfaces: { wall: "crystal-wall", floor: "crystal-floor", ceiling: "crystal-ceiling" },
    glow: { intensity: 0.75, pulse: 0.15 },
    grade: { shadows: "#0c0634", highlights: "#d8f4ff", saturation: 1.1, contrast: 1.06 },
    // The cavern's light splits like it passed through a prism.
    air: { haze: 0, dispersion: 1, breath: 0, grain: 0.8, vignette: 0.9, eye: -7.0 },
    accent: "#7ad8ff",
    look: {
      reflection: { strength: 1.15, blur: 0.8 },
      shaft: { color: "#b690ff", strength: 0.2 },
    },
    enemyWeights: { wisp: 1.5, sentry: 1.2, slime: 0.7, shadow: 0.9 },
  },
  {
    // Near the bottom the stone has begun to become a body: flesh-stone,
    // bleeding runes, eyes in the walls, crimson dark. The one floor that
    // doesn't shine. Oathbreakers' shadows.
    id: "hollow",
    name: "The Hollow",
    epithet: "Near the bottom the silence is so complete it listens back.",
    floors: [55, 100],
    fog: { color: "#0c0205", near: 6, far: 38 },
    background: "#0c0205",
    ambient: { color: "#8a2034", intensity: 0.2 },
    envIntensity: 1,
    torchColor: "#ff3040",
    torchIntensityMult: 1,
    lantern: { color: "#ffb877", intensity: 26 },
    surfaces: { wall: "abyss-wall", floor: "abyss-floor", ceiling: "abyss-ceiling" },
    glow: { intensity: 1.6, pulse: 0.4 },
    grade: { shadows: "#1c0008", highlights: "#ffb4a0", saturation: 0.92, contrast: 1.15 },
    // The dark at the edge of sight breathes; the grain is heavier.
    air: { haze: 0, dispersion: 0.6, breath: 1, grain: 1.3, vignette: 1, eye: -7.9 },
    accent: "#ff2a44",
    look: {
      reflection: null,
      shaft: { color: "#ffc2b4", strength: 0.2 },
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
