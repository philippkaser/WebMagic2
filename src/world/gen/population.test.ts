import { describe, expect, test } from "bun:test";
import { Rng } from "../../core/rng";
import type { Rect } from "../types";
import { connectRooms } from "./corridors";
import { Grid, type Tile, gridSize } from "./grid";
import { placePois } from "./pois";
import { type PopulationMods, placeTorches, populateRooms } from "./population";
import { placeRooms } from "./rooms";

/** Runs the stages before population exactly as generateFloor does. Two
 * calls with the same seed return rngs at the same position, so the stage
 * under test sees identical draws under different mods. */
function stage(seed: number, floor: number) {
  const grid = new Grid(gridSize(floor));
  const rng = new Rng(seed);
  const rooms = placeRooms(grid, rng, floor);
  connectRooms(grid, rng, rooms);
  return { grid, rng, rooms, pois: placePois(rooms, grid.size, floor) };
}

function roomIndexOf(rooms: Rect[], [x, y]: Tile): number {
  return rooms.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

const CALM: PopulationMods = { barrelBias: 0, enemyCountMult: 1, enemyWeights: {} };

function populate(seed: number, floor: number, mods: PopulationMods) {
  const s = stage(seed, floor);
  return populateRooms(s.rng, s.rooms, s.pois, floor, s.grid.size, mods);
}

describe("population stage", () => {
  test("torchMult below 1 thins torches (never under 2), spreading what's left", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = stage(seed, 14);
      const b = stage(seed, 14);
      const full = placeTorches(a.grid, a.rng, a.rooms, 1);
      const dim = placeTorches(b.grid, b.rng, b.rooms, 0.35);
      const expected = Math.min(full.torches.length, Math.max(2, Math.round(full.torches.length * 0.35)));
      expect(dim.torches.length).toBe(expected);
      // The survivors are a subset of the normal torches...
      for (const t of dim.torches) expect(full.torches).toContainEqual(t);
      // ...one per room while there are lit rooms to go round.
      const litRooms = new Set(full.tiles.map((t) => roomIndexOf(a.rooms, t))).size;
      const dimRooms = new Set(dim.tiles.map((t) => roomIndexOf(b.rooms, t))).size;
      expect(dimRooms).toBe(Math.min(dim.torches.length, litRooms));
    }
  });

  test("torchMult above 1 adds torches", () => {
    const a = stage(99, 20);
    const b = stage(99, 20);
    const full = placeTorches(a.grid, a.rng, a.rooms, 1);
    const bright = placeTorches(b.grid, b.rng, b.rooms, 1.5);
    expect(bright.torches.length).toBeGreaterThan(full.torches.length);
  });

  test("barrel bias shifts the prop mix without moving a single prop", () => {
    let calmBarrels = 0;
    let biasedBarrels = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const calm = populate(seed, 9, CALM);
      const biased = populate(seed, 9, { ...CALM, barrelBias: 0.35 });
      expect(biased.props.map((p) => p.pos)).toEqual(calm.props.map((p) => p.pos));
      expect(biased.enemies).toEqual(calm.enemies);
      calmBarrels += calm.props.filter((p) => p.kind === "barrel").length;
      biasedBarrels += biased.props.filter((p) => p.kind === "barrel").length;
    }
    expect(biasedBarrels).toBeGreaterThan(calmBarrels * 1.5);
  });

  test("enemyCountMult scales the enemy budget", () => {
    for (const seed of [21, 22, 23]) {
      const calm = populate(seed, 12, CALM);
      const teeming = populate(seed, 12, { ...CALM, enemyCountMult: 1.5 });
      expect(teeming.enemies.length).toBeGreaterThan(calm.enemies.length);
    }
  });

  test("biome weights of zero remove a kind; neutral weights change nothing", () => {
    const calm = populate(31, 30, CALM);
    const ones = populate(31, 30, { ...CALM, enemyWeights: { wisp: 1, slime: 1, sentry: 1, shadow: 1 } });
    expect(ones.enemies).toEqual(calm.enemies);
    const noWisps = populate(31, 30, { ...CALM, enemyWeights: { wisp: 0 } });
    expect(noWisps.enemies.length).toBe(calm.enemies.length);
    expect(noWisps.enemies.some((e) => e.kind === "wisp")).toBe(false);
  });
});
