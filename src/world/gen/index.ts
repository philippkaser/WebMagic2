import { TILE } from "../../core/config";
import { Rng } from "../../core/rng";
import { biomeForFloor, getBiomeDef } from "../biomes";
import { omenGenMods, rollOmen } from "../omens";
import type { FloorLayout, Vec3 } from "../types";
import { planArchitecture } from "./architecture";
import { connectRooms } from "./corridors";
import { Grid, floodFill, gridSize, worldToTile } from "./grid";
import { placeLore } from "./lorePlacement";
import { placePois } from "./pois";
import { placeTorches, populateRooms } from "./population";
import { placeRooms } from "./rooms";
import { layoutSeed } from "./seeds";
import { placeTraps } from "./trapPlacement";
import { buildWalls } from "./walls";

/** Procedural floor generator. Pure and deterministic: the same (seed, floor)
 * pair always yields an identical layout, which is what lets every player in
 * a shared floor instance generate the world locally from just a seed.
 *
 * Generation is a staged pipeline over one tile grid:
 *
 *   omen (own stream) → rooms → corridors → walls → points of interest
 *   → torches → props & enemies → traps → lore runes (own stream)
 *   → architecture (own stream)
 *
 * Stages sharing the layout stream run in a fixed order and each draws the
 * same numbers whatever the biome or omen (those only scale counts and
 * thresholds), so the stream stays stable as systems are added. Anything new
 * that needs randomness gets its own stream (see seeds.ts) rather than
 * borrowing from the layout's. */
export function generateFloor(seed: number, floor: number): FloorLayout {
  // The mood comes first: it bends how the floor is built.
  const omen = rollOmen(seed, floor);
  const mods = omenGenMods(omen);
  const biome = getBiomeDef(biomeForFloor(floor));

  const rng = new Rng(layoutSeed(seed, floor));
  const grid = new Grid(gridSize(floor));
  const { size } = grid;

  const rooms = placeRooms(grid, rng, floor);
  connectRooms(grid, rng, rooms);
  const { wallInstances, wallBoxes } = buildWalls(grid);
  const pois = placePois(rooms, size, floor);
  const torches = placeTorches(grid, rng, rooms, mods.torchMult);
  const { props, enemies } = populateRooms(rng, rooms, pois, floor, size, {
    barrelBias: mods.barrelBias,
    enemyCountMult: mods.enemyCountMult,
    enemyWeights: biome.enemyWeights,
  });
  const traps = placeTraps(rng, rooms, pois, floor, size);
  const lore = placeLore({ grid, seed, floor, rooms, pois, torchTiles: torches.tiles });
  const architecture = planArchitecture({
    grid,
    seed,
    floor,
    biome: biome.id,
    rooms,
    pois,
    torches: torches.torches,
    lore,
    props,
    enemies,
    traps,
    lightMult: mods.torchMult,
  });

  return {
    floor,
    seed,
    size,
    tiles: grid.tiles,
    rooms,
    biome: biome.id,
    omen,
    lore,
    spawn: pois.spawn,
    exit: pois.exit,
    leave: pois.leave,
    treasure: pois.treasure,
    boss: pois.boss,
    torches: torches.torches,
    props,
    enemies,
    traps,
    wallInstances,
    wallBoxes,
    extent: (size * TILE) / 2,
    architecture,
  };
}

/** BFS over walkable tiles — used by tests to prove every floor is traversable. */
export function isReachable(layout: FloorLayout, from: Vec3, to: Vec3): boolean {
  const { size, tiles } = layout;
  const [gx, gy] = worldToTile(to, size);
  if (gx < 0 || gy < 0 || gx >= size || gy >= size) return false;
  return floodFill(tiles, size, worldToTile(from, size))[gy * size + gx] === 1;
}
