import type { Rng } from "../../core/rng";
import type { Rect } from "../types";
import { type Grid, type Tile, dist2, roomCenter } from "./grid";

/** Stage 2 — corridors. Each room is joined to its nearest room placed before
 * it, which builds a spanning tree: every room is reachable from rooms[0]
 * (the spawn) by construction, with no dead-end islands. */

/** Share of corridors dug two tiles wide — variety, and room to dodge. */
const WIDE_CHANCE = 0.45;

export function connectRooms(grid: Grid, rng: Rng, rooms: Rect[]): void {
  for (let i = 1; i < rooms.length; i++) {
    const from = roomCenter(rooms[i]);
    let best = 0;
    let bestDist = Infinity;
    for (let j = 0; j < i; j++) {
      const d = dist2(from, roomCenter(rooms[j]));
      if (d < bestDist) {
        bestDist = d;
        best = j;
      }
    }
    const to = roomCenter(rooms[best]);
    const wide = rng.chance(WIDE_CHANCE);
    carveCorridor(grid, rng, from, to, wide);
  }
}

/** An L-shaped dig between two tile centres; which leg goes first is a coin
 * flip so corridors don't all bend the same way. */
function carveCorridor(grid: Grid, rng: Rng, from: Tile, to: Tile, wide: boolean): void {
  const horizontalFirst = rng.chance(0.5);
  const dig = (x: number, y: number) => {
    grid.carve(x, y);
    if (wide) {
      grid.carve(x + 1, y);
      grid.carve(x, y + 1);
    }
  };
  let [x, y] = from;
  if (horizontalFirst) {
    for (; x !== to[0]; x += Math.sign(to[0] - x)) dig(x, y);
    for (; y !== to[1]; y += Math.sign(to[1] - y)) dig(x, y);
  } else {
    for (; y !== to[1]; y += Math.sign(to[1] - y)) dig(x, y);
    for (; x !== to[0]; x += Math.sign(to[0] - x)) dig(x, y);
  }
  dig(x, y);
}
