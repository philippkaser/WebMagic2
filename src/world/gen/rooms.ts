import type { Rng } from "../../core/rng";
import type { Rect, Vec3 } from "../types";
import { type Grid, tileToWorld } from "./grid";

/** Stage 1 — rooms. Rejection-samples non-overlapping rectangles and carves
 * them. Room order matters downstream: rooms[0] is the spawn room and the
 * corridor stage links each room to one placed before it. */

/** Tiles of solid rock kept between any two rooms, so walls never merge and
 * corridors are the only way between them. */
const ROOM_GAP = 2;
const PLACEMENT_TRIES = 90;

/** More rooms as you descend, capped so deep floors stay navigable. */
function targetRoomCount(floor: number): number {
  return Math.min(7 + Math.floor(floor / 3), 14);
}

export function placeRooms(grid: Grid, rng: Rng, floor: number): Rect[] {
  const { size } = grid;
  const rooms: Rect[] = [];
  const target = targetRoomCount(floor);
  for (let tries = 0; tries < PLACEMENT_TRIES && rooms.length < target; tries++) {
    const w = rng.int(5, 10);
    const h = rng.int(5, 10);
    const x = rng.int(2, size - w - 3);
    const y = rng.int(2, size - h - 3);
    const cand: Rect = { x, y, w, h };
    if (rooms.some((r) => overlaps(r, cand, ROOM_GAP))) continue;
    rooms.push(cand);
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) grid.carve(tx, ty);
  }
  return rooms;
}

/** A random tile centre inside the room, keeping one tile off its edges so
 * spawned things never sit against (or clip into) a wall. */
export function randomInRoom(rng: Rng, room: Rect, size: number, y: number): Vec3 {
  const tx = rng.int(room.x + 1, room.x + room.w - 2);
  const ty = rng.int(room.y + 1, room.y + room.h - 2);
  return tileToWorld([tx, ty], size, y);
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}
