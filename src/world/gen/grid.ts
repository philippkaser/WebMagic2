import { DUNGEON, TILE } from "../../core/config";
import type { Rect, Vec3 } from "../types";

/** The tile grid every generation stage reads and writes, plus the coordinate
 * helpers that translate between tiles and world space.
 *
 * Tile coordinates are [x, y]; grid y maps to world Z. The grid is centred on
 * the world origin so the floor/ceiling planes can be a single square of
 * half-extent `size * TILE / 2`. */

/** A tile coordinate [x, y] on the generator grid (y maps to world Z). */
export type Tile = [number, number];

export const FLOOR = 1;
export const SOLID = 0;

/** The four orthogonal steps, in a fixed order so every walk is deterministic. */
export const DIRS4: readonly Tile[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Grid side length for a depth: floors widen as you descend, up to a cap
 * that keeps wall instance and collider counts sane. */
export function gridSize(floor: number): number {
  return Math.min(Math.floor(DUNGEON.baseSize + floor * DUNGEON.sizePerFloor), DUNGEON.maxSize);
}

export class Grid {
  /** size*size, 1 = walkable floor, 0 = solid (the FloorLayout contract). */
  readonly tiles: Uint8Array;

  constructor(readonly size: number) {
    this.tiles = new Uint8Array(size * size);
  }

  /** Tile value, with everything outside the grid reading as solid rock —
   * lets neighbour scans run off the edge without bounds checks. */
  at(x: number, y: number): number {
    return this.inBounds(x, y) ? this.tiles[y * this.size + x] : SOLID;
  }

  isFloor(x: number, y: number): boolean {
    return this.at(x, y) === FLOOR;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  /** Carves a walkable tile, but never within the outer two rings: the
   * border stays rock so every carved tile is guaranteed a wall cube beside
   * it and nothing can walk off the edge of the world. */
  carve(x: number, y: number): void {
    if (x > 1 && y > 1 && x < this.size - 2 && y < this.size - 2) {
      this.tiles[y * this.size + x] = FLOOR;
    }
  }
}

/** World-space centre of a tile at ground level. */
export function toWorld(tx: number, ty: number, size: number): Vec3 {
  return [(tx - size / 2) * TILE + TILE / 2, 0, (ty - size / 2) * TILE + TILE / 2];
}

/** World-space centre of a tile at a chosen height. */
export function tileToWorld(t: Tile, size: number, y: number): Vec3 {
  const [wx, , wz] = toWorld(t[0], t[1], size);
  return [wx, y, wz];
}

/** The tile a world position stands on (height is ignored). */
export function worldToTile(p: Vec3, size: number): Tile {
  return [Math.floor(p[0] / TILE + size / 2), Math.floor(p[2] / TILE + size / 2)];
}

export function roomCenter(r: Rect): Tile {
  return [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)];
}

export function dist2(a: Tile, b: Tile): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

/** Horizontal (XZ) squared distance — height never matters for spacing. */
export function dist2World(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Flood fill over walkable tiles from `start` (4-connected). The start tile
 * is always marked, even if solid, matching how a wizard standing anywhere
 * can still step onto the floor around them. Returns a size*size mask. */
export function floodFill(tiles: Uint8Array, size: number, start: Tile): Uint8Array {
  const seen = new Uint8Array(size * size);
  const [sx, sy] = start;
  if (sx < 0 || sy < 0 || sx >= size || sy >= size) return seen;
  const queue: number[] = [sy * size + sx];
  seen[queue[0]] = 1;
  // Index-walked queue: Array#shift is O(n) and floors can hold ~4k tiles.
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const x = idx % size;
    const y = (idx - x) / size;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nidx = ny * size + nx;
      if (seen[nidx] || tiles[nidx] !== FLOOR) continue;
      seen[nidx] = 1;
      queue.push(nidx);
    }
  }
  return seen;
}
