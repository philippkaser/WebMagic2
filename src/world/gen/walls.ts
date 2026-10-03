import { TILE, WALL_HEIGHT } from "../../core/config";
import type { Vec3, WallBox } from "../types";
import { type Grid, FLOOR, SOLID, toWorld } from "./grid";

/** Stage 3 — walls. Only solid tiles that touch walkable space (8-connected,
 * so corners are closed too) become visible cubes; the rest of the rock is
 * never drawn. Colliders are then greedy-merged into far fewer boxes. No rng:
 * walls are a pure function of the carved grid. */

export interface Walls {
  /** One entry per visible wall cube (world position of cube centre). */
  wallInstances: Vec3[];
  /** Greedy-merged physics colliders covering every wall tile. */
  wallBoxes: WallBox[];
}

export function buildWalls(grid: Grid): Walls {
  const { size } = grid;
  const wallInstances: Vec3[] = [];
  const isWallTile = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid.at(x, y) !== SOLID) continue;
      let nearFloor = false;
      for (let dy = -1; dy <= 1 && !nearFloor; dy++)
        for (let dx = -1; dx <= 1 && !nearFloor; dx++)
          if (grid.at(x + dx, y + dy) === FLOOR) nearFloor = true;
      if (nearFloor) {
        isWallTile[y * size + x] = 1;
        const [wx, , wz] = toWorld(x, y, size);
        wallInstances.push([wx, WALL_HEIGHT / 2, wz]);
      }
    }
  }
  return { wallInstances, wallBoxes: mergeWallBoxes(isWallTile, size) };
}

/** Greedy rectangle merge: turns individual wall tiles into a much smaller
 * set of box colliders (important for physics cost as floors grow). Scans
 * row-major, grows each unclaimed tile as wide as it can, then as tall as
 * that full width allows. */
export function mergeWallBoxes(isWall: Uint8Array, size: number): WallBox[] {
  const used = new Uint8Array(size * size);
  const boxes: WallBox[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!isWall[idx] || used[idx]) continue;
      let w = 1;
      while (x + w < size && isWall[idx + w] && !used[idx + w]) w++;
      let h = 1;
      outer: while (y + h < size) {
        for (let i = 0; i < w; i++) {
          const j = (y + h) * size + x + i;
          if (!isWall[j] || used[j]) break outer;
        }
        h++;
      }
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) used[(y + dy) * size + x + dx] = 1;
      const [x0, , z0] = toWorld(x, y, size);
      const [x1, , z1] = toWorld(x + w - 1, y + h - 1, size);
      boxes.push({
        center: [(x0 + x1) / 2, WALL_HEIGHT / 2, (z0 + z1) / 2],
        half: [(w * TILE) / 2, WALL_HEIGHT / 2, (h * TILE) / 2],
      });
    }
  }
  return boxes;
}
