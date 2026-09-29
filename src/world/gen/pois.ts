import type { Rect, Vec3 } from "../types";
import { type Tile, dist2, roomCenter, tileToWorld } from "./grid";

/** Stage 4 — points of interest. Picks which rooms play which role and where
 * the landmarks stand. No rng: roles fall out of room geometry alone, so they
 * can never drift when later stages change how many numbers they draw.
 *
 * - spawn: rooms[0] (the corridor tree's root, so everything reaches it).
 * - exit: the room farthest from the spawn — the descent should be a trek.
 * - leave: the way home, two tiles beside the exit portal in the same room.
 *   Every floor has one; whether it opens is a run rule decided elsewhere.
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
/** How far (tiles, along +x) the way home stands from the descent portal. */
const LEAVE_OFFSET = 2;

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
  // Beside the exit, but never past the room's last interior column.
  const leaveTile: Tile = [
    Math.min(exitTile[0] + LEAVE_OFFSET, exitRoom.x + exitRoom.w - 2),
    exitTile[1],
  ];
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
