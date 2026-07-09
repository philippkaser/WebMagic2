export type Vec3 = [number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PropKind = "crate" | "barrel" | "pot";
export type EnemyKind = "wisp" | "sentry";

export interface PropSpawn {
  kind: PropKind;
  pos: Vec3;
}

export interface EnemySpawn {
  kind: EnemyKind;
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
  spawn: Vec3;
  exit: Vec3;
  /** Present only on checkpoint floors (5, 10, 15, …). */
  leave: Vec3 | null;
  /** Guaranteed loot pedestal. */
  treasure: Vec3;
  torches: Vec3[];
  props: PropSpawn[];
  enemies: EnemySpawn[];
  /** One entry per visible wall cube (world position of cube center). */
  wallInstances: Vec3[];
  /** Greedy-merged physics colliders covering all wall tiles. */
  wallBoxes: WallBox[];
  /** World-space half-extent of the whole grid (for floor/ceiling planes). */
  extent: number;
}
