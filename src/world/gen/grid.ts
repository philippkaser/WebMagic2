import { TILE } from "../../core/config";
import type { Vec3 } from "../types";

/** Tile-grid ↔ world conversions shared by the generator passes. Tile (0,0)
 * is the grid's north-west corner; the grid is centered on the origin. */

export const FLOOR = 1;
export const SOLID = 0;

/** World position of a tile's center (y = 0). */
export function toWorld(tx: number, ty: number, size: number): Vec3 {
  return [(tx - size / 2) * TILE + TILE / 2, 0, (ty - size / 2) * TILE + TILE / 2];
}

export function tileToWorld(t: [number, number], size: number, y: number): Vec3 {
  const [wx, , wz] = toWorld(t[0], t[1], size);
  return [wx, y, wz];
}

export function worldToTile(p: Vec3, size: number): [number, number] {
  return [Math.floor(p[0] / TILE + size / 2), Math.floor(p[2] / TILE + size / 2)];
}

/** World coordinate of a tile *boundary* (edge between tile t-1 and t). */
export function edgeToWorld(t: number, size: number): number {
  return (t - size / 2) * TILE;
}
