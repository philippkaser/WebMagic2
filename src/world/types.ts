export type Vec3 = [number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PropKind = "crate" | "barrel" | "pot";
export type EnemyKind = "wisp" | "sentry" | "skitter" | "drowned" | "shade" | "imp" | "golem" | "mimic";

export interface PropSpawn {
  kind: PropKind;
  pos: Vec3;
}

export interface EnemySpawn {
  kind: EnemyKind;
  pos: Vec3;
}

/** Non-gameplay dressing (see world/gen/decor + world/decor). Pillars and
 * braziers get static colliders; everything else is purely visual. */
export type DecorKind =
  | "pillar"
  | "beam" // ceiling beam spanning a room (scale.x = length)
  | "lintel" // arch over a corridor mouth (scale.x = opening width)
  | "pilaster" // arch jamb standing against the wall
  | "rubble"
  | "bones"
  | "web" // corner cobweb near the ceiling
  | "chain" // hangs from the ceiling (scale.y = length)
  | "growth" // mushrooms / crystals / slag / eyes by biome
  | "pool" // water / magma / ichor by biome
  | "brazier"
  | "runeCircle"
  | "stalactite";

export interface DecorItem {
  kind: DecorKind;
  pos: Vec3;
  /** Yaw in radians. */
  rot: number;
  scale: Vec3;
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
  spawn: Vec3;
  exit: Vec3;
  /** Where the homeward rift opens beside the exit — shown only to wizards
   * whose run has survived enough floors (see progression). */
  homeward: Vec3;
  /** Deterministic spots for inherited death chests ("remains"). */
  remainsSlots: Vec3[];
  /** Guaranteed loot pedestal. */
  treasure: Vec3;
  /** Boss arena spawn — present every 10th floor. The floor's portals stay
   * sealed until the boss dies. */
  boss: Vec3 | null;
  torches: Vec3[];
  props: PropSpawn[];
  enemies: EnemySpawn[];
  /** Deterministic set dressing — pure decoration, placed clear of spawn,
   * portals, treasure, props and enemies. */
  decor: DecorItem[];
  /** One entry per visible wall cube (world position of cube center). */
  wallInstances: Vec3[];
  /** Greedy-merged physics colliders covering all wall tiles. */
  wallBoxes: WallBox[];
  /** World-space half-extent of the whole grid (for floor/ceiling planes). */
  extent: number;
}
