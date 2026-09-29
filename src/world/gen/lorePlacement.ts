import { TILE } from "../../core/config";
import { Rng } from "../../core/rng";
import { pickLoreFragment } from "../lore";
import type { LoreSpawn, Rect } from "../types";
import { type Grid, type Tile, SOLID, floodFill, toWorld } from "./grid";
import type { Pois } from "./pois";
import { STREAM_SALT, streamSeed } from "./seeds";

/** Stage 7 — lore runes. Some floors carry a readable rune carved into a room
 * wall. Runs on its own seeded stream (never the layout's), so whether a floor
 * has lore — or what it says — can't shift a single room, prop or enemy.
 *
 * `facing` convention: the rune faces the world-XZ direction
 * (sin(facing), cos(facing)) — three.js's rotation.y — so a PlaneGeometry
 * (front face +Z) rotated by `facing` shows its carving to the room. */

/** Share of floors that carry any lore at all. */
const LORE_CHANCE = 0.55;
/** From this depth a floor with lore sometimes carries a second rune. */
const SECOND_RUNE_FROM = 25;
const SECOND_RUNE_CHANCE = 0.35;
/** Rune centre height: about eye level for a wizard. */
const RUNE_HEIGHT = 1.5;
/** Pushes the rune from its tile centre to just proud of the wall face
 * (the face is TILE/2 away). Stays inside the tile, so the rune's position
 * still maps back onto its own walkable tile. */
const RUNE_INSET = TILE * 0.46;
/** Runes keep this many tiles (Chebyshev) from portals, the treasure, the
 * spawn and the boss — landmarks read better without clutter. */
const LANDMARK_CLEARANCE = 1;

/** The walls a rune can hang on: the tile step toward the wall, and the yaw
 * that faces away from it, back into the room. */
const SIDES: readonly { wall: Tile; facing: number }[] = [
  { wall: [0, -1], facing: 0 }, // north wall (−Z): face +Z
  { wall: [0, 1], facing: Math.PI }, // south wall (+Z): face −Z
  { wall: [-1, 0], facing: Math.PI / 2 }, // west wall (−X): face +X
  { wall: [1, 0], facing: -Math.PI / 2 }, // east wall (+X): face −X
];

interface RuneSpot {
  tile: Tile;
  wall: Tile;
  facing: number;
  room: Rect;
}

export interface LoreInput {
  grid: Grid;
  seed: number;
  floor: number;
  rooms: Rect[];
  pois: Pois;
  /** Tiles already holding a torch — a rune never shares one. */
  torchTiles: Tile[];
}

export function placeLore({ grid, seed, floor, rooms, pois, torchTiles }: LoreInput): LoreSpawn[] {
  const rng = new Rng(streamSeed(seed, floor, STREAM_SALT.lore));
  if (!rng.chance(LORE_CHANCE)) return [];
  const count = floor >= SECOND_RUNE_FROM && rng.chance(SECOND_RUNE_CHANCE) ? 2 : 1;

  let spots = runeSpots(grid, rooms, pois, torchTiles);
  const carved = new Set<string>();
  const lore: LoreSpawn[] = [];
  for (let i = 0; i < count && spots.length > 0; i++) {
    const fragment = pickLoreFragment(rng, floor, carved);
    if (!fragment) break;
    const spot = rng.pick(spots);
    carved.add(fragment.id);
    const [wx, , wz] = toWorld(spot.tile[0], spot.tile[1], grid.size);
    lore.push({
      pos: [wx + spot.wall[0] * RUNE_INSET, RUNE_HEIGHT, wz + spot.wall[1] * RUNE_INSET],
      facing: spot.facing,
      fragmentId: fragment.id,
    });
    // A second rune speaks from a different room.
    spots = spots.filter((s) => s.room !== spot.room);
  }
  return lore;
}

/** Every room-edge tile (corners excluded) with solid rock behind it, open
 * floor in front, reachable from the spawn and clear of torches and
 * landmarks — in a fixed order, so the rng pick is deterministic. */
function runeSpots(grid: Grid, rooms: Rect[], pois: Pois, torchTiles: Tile[]): RuneSpot[] {
  const reach = floodFill(grid.tiles, grid.size, pois.spawnTile);
  const blocked = new Set(torchTiles.map(([x, y]) => y * grid.size + x));
  const landmarks = [pois.spawnTile, pois.exitTile, pois.leaveTile, pois.treasureTile];
  if (pois.bossTile) landmarks.push(pois.bossTile);
  const nearLandmark = (x: number, y: number) =>
    landmarks.some(
      ([lx, ly]) => Math.abs(lx - x) <= LANDMARK_CLEARANCE && Math.abs(ly - y) <= LANDMARK_CLEARANCE,
    );

  const spots: RuneSpot[] = [];
  for (const room of rooms) {
    for (const { wall, facing } of SIDES) {
      for (const [x, y] of edgeTiles(room, wall)) {
        if (!grid.isFloor(x, y) || !reach[y * grid.size + x]) continue;
        if (grid.at(x + wall[0], y + wall[1]) !== SOLID) continue; // a doorway, not a wall
        if (!grid.isFloor(x - wall[0], y - wall[1])) continue;
        if (blocked.has(y * grid.size + x) || nearLandmark(x, y)) continue;
        spots.push({ tile: [x, y], wall, facing, room });
      }
    }
  }
  return spots;
}

/** The tiles along one side of a room, excluding the two corners. */
function edgeTiles(room: Rect, wall: Tile): Tile[] {
  const tiles: Tile[] = [];
  if (wall[1] !== 0) {
    const y = wall[1] < 0 ? room.y : room.y + room.h - 1;
    for (let x = room.x + 1; x <= room.x + room.w - 2; x++) tiles.push([x, y]);
  } else {
    const x = wall[0] < 0 ? room.x : room.x + room.w - 1;
    for (let y = room.y + 1; y <= room.y + room.h - 2; y++) tiles.push([x, y]);
  }
  return tiles;
}
