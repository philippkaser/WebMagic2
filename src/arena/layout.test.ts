import { describe, expect, test } from "bun:test";
import { isReachable } from "../world/gen";
import { worldToTile } from "../world/gen/grid";
import { generateArena, pickSpawn } from "./layout";

describe("the Proving Ground", () => {
  test("the same seed builds the same hall", () => {
    const a = generateArena(1234);
    const b = generateArena(1234);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.biome).toBe(b.biome);
    expect(a.architecture).toEqual(b.architecture);
  });

  test("it's fair: the plan looks the same from every spawn stone", () => {
    for (const seed of [1, 2, 3, 77, 9001]) {
      const { tiles, size } = generateArena(seed);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // A quarter turn about the centre maps floor to floor.
          expect(tiles[x * size + (size - 1 - y)]).toBe(tiles[y * size + x]);
        }
      }
    }
  });

  test("every spawn stone reaches every other, and stands on open floor", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const a = generateArena(seed);
      seen.add(a.hall);
      expect(a.spawns).toHaveLength(8);
      for (const s of a.spawns) {
        const [x, y] = worldToTile(s, a.size);
        expect(a.tiles[y * a.size + x]).toBe(1);
        expect(isReachable(a, a.spawns[0]!, s)).toBe(true);
        expect(isReachable(a, s, a.treasure)).toBe(true);
        for (const p of a.architecture.pillars) expect((p.pos[0] - s[0]) ** 2 + (p.pos[2] - s[2]) ** 2).toBeGreaterThan(2);
      }
      expect(a.torches.length).toBeGreaterThan(6);
      expect(a.enemies).toHaveLength(0);
      expect(a.lore.map((l) => l.fragmentId)).toEqual(["trial-hall"]);
    }
    expect(seen.size).toBe(3);
  });

  test("a wizard rises at the stone farthest from every foe", () => {
    const { spawns } = generateArena(5);
    const foe = spawns[0]!;
    const rise = pickSpawn(spawns, [foe]);
    for (const s of spawns) {
      expect((rise[0] - foe[0]) ** 2 + (rise[2] - foe[2]) ** 2).toBeGreaterThanOrEqual((s[0] - foe[0]) ** 2 + (s[2] - foe[2]) ** 2);
    }
    expect(pickSpawn(spawns, [], 3)).toBe(spawns[3]!);
  });
});
