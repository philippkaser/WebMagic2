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

/** A free-standing column in a big room (world position of its foot). It
 * has a collider, so the generator keeps it off paths and landmarks. */
export interface PillarSpawn {
  pos: Vec3;
}

/** A transverse arch rib spanning a room wall to wall under the ceiling,
 * resting on an engaged pier at each end. */
export interface RibSpawn {
  /** Axis the rib spans along ("x": from the west wall to the east wall). */
  axis: "x" | "z";
  /** World coordinate of the rib's centre line on the OTHER axis. */
  at: number;
  /** World coordinates of the two wall faces it springs from (min, max). */
  from: number;
  to: number;
}

/** A shaft of light falling from a crack in the ceiling to the floor. */
export interface LightShaftSpawn {
  /** Where it lands (floor level). */
  pos: Vec3;
  /** Radius of the pool of light on the floor (m). */
  radius: number;
}

/** A cluster of glowing crystals growing out of a room corner (Crystal
 * Deep). Each one is a real light source. */
export interface CrystalSpawn {
  /** Foot of the cluster (floor level). */
  pos: Vec3;
  /** Yaw the cluster leans toward (radians) — out of its corner. */
  facing: number;
  /** Overall size multiplier. */
  scale: number;
  /** 0 = violet, 1 = cyan. */
  hue: 0 | 1;
}

/** The floor's architecture: what makes a room a hall. Purely a function of
 * the carved layout and its own seed stream (world/gen/architecture.ts), so
 * it can grow without moving a single room, prop or enemy. */
export interface FloorArchitecture {
  pillars: PillarSpawn[];
  ribs: RibSpawn[];
  shafts: LightShaftSpawn[];
  /** Only on Crystal Deep floors; empty elsewhere. */
  crystals: CrystalSpawn[];
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
  /** One entry per visible wall cube (world position of cube center). The
   * renderer no longer draws cubes — it builds world-mapped faces from
   * `tiles` (render/models/architectureMesh.ts) — but the list stays for
   * tools and tests that reason about wall tiles. */
  wallInstances: Vec3[];
  /** Greedy-merged physics colliders covering all wall tiles. */
  wallBoxes: WallBox[];
  /** World-space half-extent of the whole grid (for floor/ceiling planes). */
  extent: number;
  /** Pillars, arch ribs, light shafts and crystal clusters. */
  architecture: FloorArchitecture;
}
