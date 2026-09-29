import type { Rect, Vec3 } from "../types";
import { type Tile, dist2, roomCenter, tileToWorld } from "./grid";

/** Stage 4 — points of interest. Picks which rooms play which role and where
 * the landmarks stand. No rng: roles fall out of room geometry alone, so they
 * can never drift when later stages change how many numbers they draw.
 *
 * - spawn: rooms[0] (the corridor tree's root, so everything reaches it).
 * - exit: the room farthest from the spawn — the descent should be a trek.
 * - leave: the way home, two tiles (4 m) from the exit portal in the same
 *   room — far enough that the two rings and their prompts never overlap
 *   (a portal is 3.4 m wide). Every floor has one; whether it opens is a run
 *   rule decided elsewhere.
 * - treasure: the second-farthest room, so the pedestal pulls you off-path.
 * - boss: every 10th floor, the Warden holds the exit room's centre. */

export interface Pois {
  spawnRoom: Rect;
  exitRoom: Rect;
  treasureRoom: Rect;
  isBossFloor: boolean;
  spawnTile: Tile;
  exitTile: Tile;
  leaveTile: Tile;
  treasureTile: Tile;
  bossTile: Tile | null;
  spawn: Vec3;
  exit: Vec3;
  leave: Vec3;
  treasure: Vec3;
  boss: Vec3 | null;
}

/** Height the player capsule spawns at (just above the floor, so it settles). */
const SPAWN_HEIGHT = 1.1;
/** The Warden's body centre height. */
const BOSS_HEIGHT = 1.8;
/** Where the way home may stand relative to the descent portal, in order of
 * preference: beside it (portals are wide along x, so sideways needs the
 * room's interior columns), else in front of or behind it. */
const LEAVE_OFFSETS: readonly Tile[] = [
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
];

export function isBossFloor(floor: number): boolean {
  return floor % 10 === 0;
}

export function placePois(rooms: Rect[], size: number, floor: number): Pois {
  const spawnRoom = rooms[0];
  const spawnTile = roomCenter(spawnRoom);
  const byDistance = rooms
    .slice(1)
    .sort((a, b) => dist2(roomCenter(b), spawnTile) - dist2(roomCenter(a), spawnTile));
  const exitRoom = byDistance[0] ?? spawnRoom;
  const treasureRoom = byDistance[1] ?? exitRoom;

  const boss = isBossFloor(floor);
  const exitCenter = roomCenter(exitRoom);
  // On boss floors the boss holds the room centre and the portals retreat to
  // the room's north edge, so the fight happens between you and the way out.
  const exitTile: Tile = boss
    ? [exitCenter[0], Math.max(exitRoom.y + 1, exitCenter[1] - Math.floor(exitRoom.h / 2) + 1)]
    : exitCenter;
  const leaveTile = placeLeave(exitRoom, exitTile);
  const treasureTile = roomCenter(treasureRoom);
  const bossTile = boss ? exitCenter : null;

  return {
    spawnRoom,
    exitRoom,
    treasureRoom,
    isBossFloor: boss,
    spawnTile,
    exitTile,
    leaveTile,
    treasureTile,
    bossTile,
    spawn: tileToWorld(spawnTile, size, SPAWN_HEIGHT),
    exit: tileToWorld(exitTile, size, 0),
    leave: tileToWorld(leaveTile, size, 0),
    treasure: tileToWorld(treasureTile, size, 0),
    boss: bossTile ? tileToWorld(bossTile, size, BOSS_HEIGHT) : null,
  };
}

/** The first preferred offset that keeps the way home inside the exit room:
 * sideways offsets need an interior column (the portal's width must clear the
 * walls), front/back offsets any row of the room. Every room is at least 5×5,
 * so one of them always fits; the clamp is a last resort. */
function placeLeave(room: Rect, exit: Tile): Tile {
  for (const [dx, dy] of LEAVE_OFFSETS) {
    const x = exit[0] + dx;
    const y = exit[1] + dy;
    const xOk = dx === 0 || (x >= room.x + 1 && x <= room.x + room.w - 2);
    const yOk = y >= room.y && y <= room.y + room.h - 1;
    if (xOk && yOk) return [x, y];
  }
  return [Math.min(exit[0] + 2, room.x + room.w - 2), exit[1]];
}
