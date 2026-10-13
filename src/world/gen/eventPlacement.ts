import { TILE } from "../../core/config";
import { Rng } from "../../core/rng";
import { ROOM_EVENT_RULES, ROOM_EVENTS, type RoomEventDef } from "../../roomEvents/catalog";
import type { Rect, RoomEventSpawn, Vec3 } from "../types";
import { type Grid, type Tile, roomCenter, tileToWorld, worldToTile } from "./grid";
import type { Pois } from "./pois";
import { STREAM_SALT, streamSeed } from "./seeds";

/** Stage 9 — room events. Most floors hold a vault, a ward circle, a shrine
 * or a fountain (roomEvents/catalog.ts) in a room off the beaten path: never
 * the spawn, the exit or the treasure room, never two of a kind. Runs last,
 * on its own seeded stream, and stands clear of everything already placed —
 * so it can't shift a room, a prop or a pillar, and nothing stands in it. */

export interface EventInput {
  grid: Grid;
  seed: number;
  floor: number;
  rooms: Rect[];
  pois: Pois;
  /** Everything already standing on the floor (props, foes, traps, torches,
   * runes, pillars…) — an event keeps its tile and the ring round it clear. */
  occupied: Vec3[];
}

const key = (x: number, y: number) => `${x},${y}`;
const sameRoom = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const side = (r: Rect) => Math.min(r.w, r.h);

export function placeRoomEvents({ grid, seed, floor, rooms, pois, occupied }: EventInput): RoomEventSpawn[] {
  const rng = new Rng(streamSeed(seed, floor, STREAM_SALT.events));
  if (!rng.chance(ROOM_EVENT_RULES.anyChance)) return [];
  const count = floor >= ROOM_EVENT_RULES.secondFrom && rng.chance(ROOM_EVENT_RULES.secondChance) ? 2 : 1;

  const taken = new Set<string>();
  for (const p of occupied) {
    const [tx, ty] = worldToTile(p, grid.size);
    // The thing's own tile and its ring: an event needs room to be walked round.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) taken.add(key(tx + dx, ty + dy));
  }
  const reserved = [pois.spawnRoom, pois.exitRoom, pois.treasureRoom];
  let free = rooms.filter((r) => !reserved.some((q) => sameRoom(q, r)));
  const used = new Set<string>();
  const events: RoomEventSpawn[] = [];

  while (events.length < count) {
    const fits = ROOM_EVENTS.filter((d) => floor >= d.minFloor && !used.has(d.kind) && free.some((r) => side(r) >= d.minRoom));
    if (fits.length === 0) break;
    const def = pickWeighted(rng, fits);
    used.add(def.kind);
    const room = rng.pick(free.filter((r) => side(r) >= def.minRoom));
    free = free.filter((r) => r !== room);
    const tile = freeTileNear(grid, room, taken);
    if (!tile) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) taken.add(key(tile[0] + dx, tile[1] + dy));
    const half = grid.size / 2;
    events.push({
      id: `e${events.length}`,
      kind: def.kind,
      pos: tileToWorld(tile, grid.size, 0),
      facing: rng.int(0, 3) * (Math.PI / 2),
      area: [(room.x - half) * TILE, (room.y - half) * TILE, (room.x + room.w - half) * TILE, (room.y + room.h - half) * TILE],
      variant: rng.int(0, 9999),
    });
  }
  return events;
}

function pickWeighted(rng: Rng, defs: readonly RoomEventDef[]): RoomEventDef {
  const total = defs.reduce((s, d) => s + d.weight, 0);
  let roll = rng.next() * total;
  for (const d of defs) if ((roll -= d.weight) < 0) return d;
  return defs[defs.length - 1]!;
}

/** The free floor tile nearest the room's heart, a tile in from its walls. */
function freeTileNear(grid: Grid, room: Rect, taken: Set<string>): Tile | null {
  const [cx, cy] = roomCenter(room);
  let best: Tile | null = null;
  let bestD = Infinity;
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      if (!grid.isFloor(x, y) || taken.has(key(x, y))) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}
