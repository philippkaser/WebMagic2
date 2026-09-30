/** Depth bands of the dungeon. Each biome restyles the same generated
 * architecture — surfaces, fog, light, dressing, color grade — so descending
 * *feels* like going somewhere. Pure data: the generator reads the decor
 * densities, the renderer reads the rest. */

export type BiomeId = "catacombs" | "drowned" | "forge" | "crystal" | "abyss";

/** How often each kind of dressing appears (0 = never, 1 = everywhere it fits). */
export interface DecorDensity {
  pillars: number;
  beams: number;
  arches: number;
  rubble: number;
  bones: number;
  webs: number;
  chains: number;
  growth: number;
  pools: number;
  braziers: number;
  runes: number;
  stalactites: number;
}

/** Split-tone grade applied in post (see render/Effects). */
export interface Grade {
  /** Tint pushed into the darks. */
  shadows: string;
  /** Tint pulled into the lights. */
  highlights: string;
  saturation: number;
  contrast: number;
}

export interface Biome {
  id: BiomeId;
  /** Shown on arrival ("The Catacombs"). */
  name: string;
  /** One line of lore for the arrival card. */
  lore: string;
  /** First floor of this band. */
  fromFloor: number;
  fog: { color: string; near: number; far: number };
  ambient: { color: string; intensity: number };
  torchColor: string;
  /** Emissive strength of the painted surfaces (cracks, veins, runes) and
   * how much it breathes over time (0 = steady). */
  glow: { intensity: number; pulse: number };
  grade: Grade;
  /** Ambient particles hanging in the air. */
  motes: { kind: "dust" | "spore" | "ember" | "glint" | "ash"; color: string };
  /** What the generic dressing slots turn into here. */
  style: {
    growth: "mushroom" | "crystal" | "slag" | "eye";
    pool: "water" | "magma" | "ichor";
    beam: "wood" | "iron" | "stone";
    /** Glow color of rune circles and growths. */
    accent: string;
  };
  decor: DecorDensity;
}

export const BIOMES: readonly Biome[] = [
  {
    id: "catacombs",
    name: "The Bone Catacombs",
    lore: "Here the first wizards buried their failures. Their failures do not sleep.",
    fromFloor: 1,
    fog: { color: "#0b0706", near: 8, far: 46 },
    ambient: { color: "#7080b0", intensity: 0.28 },
    torchColor: "#ff9a4d",
    glow: { intensity: 1.2, pulse: 0 },
    grade: { shadows: "#1c1030", highlights: "#ffd49a", saturation: 0.85, contrast: 1.08 },
    motes: { kind: "dust", color: "#d8c8a4" },
    style: { growth: "mushroom", pool: "water", beam: "wood", accent: "#e0b060" },
    decor: {
      pillars: 0.6, beams: 0.55, arches: 0.85, rubble: 0.6, bones: 0.9, webs: 0.9,
      chains: 0.35, growth: 0.25, pools: 0.15, braziers: 0.35, runes: 0.3, stalactites: 0,
    },
  },
  {
    id: "drowned",
    name: "The Drowned Crypts",
    lore: "The sea found these crypts an age ago, and it has been praying down here ever since.",
    fromFloor: 15,
    fog: { color: "#041110", near: 5, far: 34 },
    ambient: { color: "#3a8a80", intensity: 0.2 },
    torchColor: "#5cffc8",
    glow: { intensity: 1.6, pulse: 0.2 },
    grade: { shadows: "#002a2c", highlights: "#c0ffe8", saturation: 0.82, contrast: 1.05 },
    motes: { kind: "spore", color: "#7affd8" },
    style: { growth: "mushroom", pool: "water", beam: "wood", accent: "#5cffd8" },
    decor: {
      pillars: 0.5, beams: 0.3, arches: 0.6, rubble: 0.45, bones: 0.35, webs: 0.15,
      chains: 0.6, growth: 0.85, pools: 1, braziers: 0.15, runes: 0.2, stalactites: 0.6,
    },
  },
  {
    id: "forge",
    name: "The Ember Forge",
    lore: "Dwarf-kings forged the chains of a god in these halls. No one was ever told to let the fires die.",
    fromFloor: 30,
    fog: { color: "#0f0605", near: 8, far: 46 },
    ambient: { color: "#7a5a5a", intensity: 0.17 },
    torchColor: "#ff6a1a",
    glow: { intensity: 1.5, pulse: 0.25 },
    grade: { shadows: "#240a04", highlights: "#ffc07a", saturation: 1.05, contrast: 1.12 },
    motes: { kind: "ember", color: "#ff8a2a" },
    style: { growth: "slag", pool: "magma", beam: "iron", accent: "#ff7a1a" },
    decor: {
      pillars: 0.85, beams: 0.7, arches: 0.9, rubble: 0.6, bones: 0.2, webs: 0,
      chains: 0.9, growth: 0.5, pools: 0.55, braziers: 0.85, runes: 0.25, stalactites: 0,
    },
  },
  {
    id: "crystal",
    name: "The Crystal Hollows",
    lore: "Thought crystallizes this deep. Every shard hums with a mind that is not yours.",
    fromFloor: 50,
    fog: { color: "#08061c", near: 7, far: 50 },
    ambient: { color: "#6a5aff", intensity: 0.22 },
    torchColor: "#a58cff",
    glow: { intensity: 1.0, pulse: 0.15 },
    grade: { shadows: "#0c0634", highlights: "#d8f4ff", saturation: 1.1, contrast: 1.06 },
    motes: { kind: "glint", color: "#bfe8ff" },
    style: { growth: "crystal", pool: "water", beam: "stone", accent: "#7ad8ff" },
    decor: {
      pillars: 0.3, beams: 0, arches: 0.35, rubble: 0.5, bones: 0.15, webs: 0,
      chains: 0, growth: 1, pools: 0.25, braziers: 0.1, runes: 0.45, stalactites: 0.95,
    },
  },
  {
    id: "abyss",
    name: "The Abyssal Throne",
    lore: "At the bottom of the world something vast is dreaming the dungeon. Do not wake it.",
    fromFloor: 75,
    fog: { color: "#0c0205", near: 6, far: 38 },
    ambient: { color: "#8a2034", intensity: 0.2 },
    torchColor: "#ff3040",
    glow: { intensity: 1.6, pulse: 0.4 },
    grade: { shadows: "#1c0008", highlights: "#ffb4a0", saturation: 0.92, contrast: 1.15 },
    motes: { kind: "ash", color: "#ff6a50" },
    style: { growth: "eye", pool: "ichor", beam: "stone", accent: "#ff2a44" },
    decor: {
      pillars: 0.7, beams: 0.65, arches: 0.7, rubble: 0.3, bones: 1, webs: 0.1,
      chains: 0.8, growth: 0.7, pools: 0.6, braziers: 0.4, runes: 0.95, stalactites: 0.3,
    },
  },
];

export function biomeFor(floor: number): Biome {
  let current = BIOMES[0];
  for (const b of BIOMES) if (floor >= b.fromFloor) current = b;
  return current;
}
