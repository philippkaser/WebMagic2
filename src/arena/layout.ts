import { TILE } from "../core/config";
import { Rng } from "../core/rng";
import { planArchitecture } from "../world/gen/architecture";
import { placeDoorways } from "../world/gen/doorways";
import { planDressing } from "../world/gen/dressing";
import { FLOOR, Grid, SOLID, roomCenter, tileToWorld, type Tile } from "../world/gen/grid";
import type { Pois } from "../world/gen/pois";
import { placeTorches } from "../world/gen/population";
import { streamSeed } from "../world/gen/seeds";
import { buildWalls } from "../world/gen/walls";
import type { BiomeId, FloorLayout, LoreSpawn, Rect, Vec3 } from "../world/types";

/** The Proving Ground: the Founders' old trial hall, where wizards duel to
 * the yield. Not a dungeon floor but built from the same stone — the same
 * grid, walls, doorways, colonnades, torches and dressing stages — so it
 * renders, sounds and collides like the rest of the world.
 *
 * The plan is fixed and FAIR: four-fold rotational symmetry, so no spawn
 * stone is better than another. A great hall in the middle; four alcoves
 * (the spawn stones) each with a spoke into the hall; and an outer ring
 * running alcove → corner chamber → alcove, so there's always a way round
 * behind someone. The seed only chooses the dress: which band's stone, and
 * how the hall breaks sightlines (open, four great blocks, or a cut-cornered
 * octagon with its own cover). */

/** The arena isn't a depth: its streams are salted with this floor number. */
export const ARENA_FLOOR = 0;
const SIZE = 44;
const SPAWN_HEIGHT = 1.1;

export type HallStyle = "open" | "blocks" | "octagon";
const HALL_STYLES: readonly HallStyle[] = ["open", "blocks", "octagon"];
const ARENA_BIOMES: readonly BiomeId[] = ["catacombs", "forge", "crystal", "drowned", "hollow"];

export interface ArenaLayout extends FloorLayout {
  /** Where wizards rise: the four alcoves, then the four corner chambers. */
  spawns: Vec3[];
  hall: HallStyle;
}

// One quadrant of the plan (the north), as tile rects; the rest is this
// turned three times about the grid's centre.
const HALL: Rect = { x: 15, y: 15, w: 14, h: 14 };
const ALCOVE: Rect = { x: 19, y: 3, w: 6, h: 6 };
const CORNER: Rect = { x: 3, y: 3, w: 5, h: 5 };
const QUADRANT_CORRIDORS: Rect[] = [
  { x: 21, y: 9, w: 2, h: 6 }, // the spoke: alcove → hall
  { x: 8, y: 5, w: 11, h: 2 }, // the ring, west: alcove → corner chamber
  { x: 25, y: 5, w: 11, h: 2 }, // the ring, east: alcove → the next corner
];

/** Turn a tile a quarter `turns` times about the grid's centre. */
function turn([x, y]: Tile, turns: number): Tile {
  let t: Tile = [x, y];
  for (let i = 0; i < turns; i++) t = [SIZE - 1 - t[1], t[0]];
  return t;
}

function turnRect(r: Rect, turns: number): Rect {
  const a = turn([r.x, r.y], turns);
  const b = turn([r.x + r.w - 1, r.y + r.h - 1], turns);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

const fourWays = (r: Rect): Rect[] => [0, 1, 2, 3].map((k) => turnRect(r, k));

function fill(grid: Grid, r: Rect, value: number): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (value === FLOOR) grid.carve(x, y);
      else grid.tiles[y * grid.size + x] = SOLID;
    }
  }
}

/** The hall's cover, for one quadrant (turned four ways like the rest). */
function hallCover(style: HallStyle): Rect[] {
  switch (style) {
    case "open":
      return [];
    case "blocks":
      // A great block off each diagonal: cover to duck behind, lanes between.
      return [{ x: 18, y: 18, w: 2, h: 2 }];
    case "octagon":
      // Cut the hall's corners, and stand a low wall across each spoke's
      // mouth so nobody can fire straight down it into an alcove.
      return [
        { x: 15, y: 15, w: 2, h: 2 },
        { x: 20, y: 18, w: 4, h: 1 },
      ];
  }
}

export function generateArena(seed: number): ArenaLayout {
  const rng = new Rng(streamSeed(seed, ARENA_FLOOR, ARENA_SALT));
  const biome = rng.pick(ARENA_BIOMES);
  const hall = rng.pick(HALL_STYLES);

  const grid = new Grid(SIZE);
  const alcoves = fourWays(ALCOVE);
  const corners = fourWays(CORNER);
  const rooms: Rect[] = [HALL, ...alcoves, ...corners];
  for (const r of rooms) fill(grid, r, FLOOR);
  for (const c of QUADRANT_CORRIDORS) for (const r of fourWays(c)) fill(grid, r, FLOOR);
  for (const c of hallCover(hall)) for (const r of fourWays(c)) fill(grid, r, SOLID);

  const { wallInstances, wallBoxes } = buildWalls(grid);
  const centre = roomCenter(HALL);
  const spawnTiles = [...alcoves, ...corners].map(roomCenter);
  const pois: Pois = {
    spawnRoom: alcoves[0]!,
    // The hall's heart stands in for the landmarks: colonnades and dressing
    // keep it open.
    exitRoom: HALL,
    treasureRoom: HALL,
    isBossFloor: false,
    spawnTile: spawnTiles[0]!,
    exitTile: centre,
    leaveTile: centre,
    treasureTile: centre,
    bossTile: null,
    spawn: tileToWorld(spawnTiles[0]!, SIZE, SPAWN_HEIGHT),
    exit: tileToWorld(centre, SIZE, 0),
    leave: tileToWorld(centre, SIZE, 0),
    treasure: tileToWorld(centre, SIZE, 0),
    boss: null,
  };

  // A well-lit hall: the Proving Ground is no place for ambushes in the dark.
  const torches = placeTorches(grid, new Rng(streamSeed(seed, ARENA_FLOOR, ARENA_SALT ^ 1)), rooms, 1.6);
  const lore: LoreSpawn[] = [trialHallInscription()];
  const doorways = placeDoorways({ grid, seed, floor: ARENA_FLOOR, rooms, torches: torches.torches, lore });
  const common = { grid, seed, floor: ARENA_FLOOR, biome, rooms, pois, torches: torches.torches, lore, props: [], enemies: [], traps: [] };
  const architecture = planArchitecture({ ...common, doorways, lightMult: 1 });
  const dressing = planDressing({ ...common, architecture, events: [], lightMult: 1 });

  return {
    floor: ARENA_FLOOR,
    seed,
    size: SIZE,
    tiles: grid.tiles,
    rooms,
    biome,
    omen: null,
    lore,
    spawn: pois.spawn,
    exit: pois.exit,
    leave: pois.leave,
    treasure: pois.treasure,
    events: [],
    boss: null,
    torches: torches.torches,
    props: [],
    enemies: [],
    traps: [],
    wallInstances,
    wallBoxes,
    extent: (SIZE * TILE) / 2,
    architecture,
    dressing,
    spawns: spawnTiles.map((t) => tileToWorld(t, SIZE, SPAWN_HEIGHT)),
    hall,
  };
}

/** The arena's own stream (it shares no floor's). */
const ARENA_SALT = 0x61726e61; // "arna"

/** The Founders' inscription, carved on the hall's north wall beside the
 * spoke. */
function trialHallInscription(): LoreSpawn {
  const [wx, , wz] = tileToWorld([HALL.x + 2, HALL.y], SIZE, 0);
  return { pos: [wx, 1.5, wz - TILE * 0.46], facing: 0, fragmentId: "trial-hall" };
}

/** Where a wizard should rise: the stone farthest from every foe (ties to
 * the earlier stone), so nobody respawns into a waiting staff. */
export function pickSpawn(spawns: readonly Vec3[], foes: readonly Vec3[], fallback = 0): Vec3 {
  if (foes.length === 0) return spawns[fallback % spawns.length]!;
  let best = spawns[0]!;
  let bestD = -1;
  for (const s of spawns) {
    let nearest = Infinity;
    for (const f of foes) nearest = Math.min(nearest, (s[0] - f[0]) ** 2 + (s[2] - f[2]) ** 2);
    if (nearest > bestD) {
      bestD = nearest;
      best = s;
    }
  }
  return best;
}
