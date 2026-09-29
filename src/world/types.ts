export type Vec3 = [number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PropKind = "crate" | "barrel" | "pot";
export type EnemyKind = "wisp" | "sentry" | "shadow" | "slime";
export type TrapKind = "spike" | "dart" | "warp";

/** Depth bands with their own look, light and monster mix (world/biomes.ts). */
export type BiomeId = "catacombs" | "drowned" | "forge" | "crystal" | "hollow";

/** Seeded floor moods that bend the rules (world/omens.ts). */
export type OmenId = "weightless" | "lightless" | "crimson" | "manatide" | "volatile" | "teeming";

/** A readable lore rune carved into a room wall. */
export interface LoreSpawn {
  pos: Vec3;
  /** Yaw (radians) the rune faces — into the room, away from its wall. */
  facing: number;
  /** Fragment id from world/lore.ts. */
  fragmentId: string;
}

export interface PropSpawn {
  kind: PropKind;
  pos: Vec3;
}

export interface EnemySpawn {
  kind: EnemyKind;
  pos: Vec3;
}

export interface TrapSpawn {
  kind: TrapKind;
  pos: Vec3;
}

/** Axis-aligned merged wall collider (world units). */
export interface WallBox {
  center: Vec3;
  half: Vec3;
}

export interface FloorLayout {
  floor: number;
  seed: number;
  /** Grid dimension (tiles per side). */
  size: number;
  /** size*size grid, 1 = walkable floor, 0 = solid. */
  tiles: Uint8Array;
  rooms: Rect[];
  /** Depth band this floor belongs to — palette, textures, monster mix. */
  biome: BiomeId;
  /** This floor's omen, if the dungeon is in a mood (rolled from the seed). */
  omen: OmenId | null;
  /** Readable lore runes. */
  lore: LoreSpawn[];
  spawn: Vec3;
  exit: Vec3;
  /** The way home, beside the exit. Every floor has one; whether it OPENS
   * for a given wizard is a run rule (floors played), not a layout rule. */
  leave: Vec3;
  /** Guaranteed loot pedestal. */
  treasure: Vec3;
  /** Boss arena spawn — present every 10th floor. The floor's portals stay
   * sealed until the boss dies. */
  boss: Vec3 | null;
  torches: Vec3[];
  props: PropSpawn[];
  enemies: EnemySpawn[];
  traps: TrapSpawn[];
  /** One entry per visible wall cube (world position of cube center). */
  wallInstances: Vec3[];
  /** Greedy-merged physics colliders covering all wall tiles. */
  wallBoxes: WallBox[];
  /** World-space half-extent of the whole grid (for floor/ceiling planes). */
  extent: number;
}
