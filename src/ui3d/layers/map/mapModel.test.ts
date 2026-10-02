import { describe, expect, test } from "bun:test";
import { TILE } from "../../../core/config";
import { generateFloor } from "../../../world/gen";
import { castSpot, dungeonModel, MAP_GAP, MAP_WIDTH, MIN_SPAN, padBounds, villageModel } from "./mapModel";

describe("the cast map's model", () => {
  const layout = generateFloor(4254, 12);
  const n = layout.size;
  const [sx, , sz] = layout.spawn;
  const stx = Math.floor(sx / TILE + n / 2);
  const stz = Math.floor(sz / TILE + n / 2);

  test("an unexplored floor draws nothing", () => {
    const m = dungeonModel(layout, () => false);
    expect(m.floor.length).toBe(0);
    expect(m.bounds).toBeNull();
    expect(m.markers.length).toBe(0);
  });

  test("a seen patch draws its floor and the walls that touch it, framed at least MIN_SPAN wide", () => {
    const seen = (x: number, z: number) => Math.abs(x - stx) <= 2 && Math.abs(z - stz) <= 2 && x >= 0 && z >= 0 && x < n && z < n && layout.tiles[z * n + x] === 1;
    const m = dungeonModel(layout, seen);
    expect(m.floor.length).toBeGreaterThan(0);
    for (const p of m.floor) expect(p.h).toBe(0);
    for (const w of m.raised) expect(w.h).toBeGreaterThan(0);
    const b = m.bounds!;
    expect(b.maxX - b.minX).toBeCloseTo(b.maxZ - b.minZ, 6);
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(MIN_SPAN - 1e-6);
  });

  test("markers appear only once their place is seen", () => {
    const all = dungeonModel(layout, (x, z) => x >= 0 && z >= 0 && x < n && z < n && layout.tiles[z * n + x] === 1);
    expect(all.markers.map((m) => m.key)).toEqual(expect.arrayContaining(["exit", "leave", "treasure"]));
  });

  test("the village is all there, with its paths brighter", () => {
    const v = villageModel();
    expect(v.floor.length).toBeGreaterThan(500);
    expect(v.floor.some((p) => p.bright > 1)).toBe(true);
    expect(v.raised.length).toBeGreaterThan(5);
    expect(v.markers.map((m) => m.key)).toEqual(["gate", "chest", "merchant"]);
  });

  test("padBounds squares and grows about the centre", () => {
    const b = padBounds({ minX: 0, maxX: 2, minZ: 10, maxZ: 11 }, 6);
    expect(b).toEqual({ minX: -2, maxX: 4, minZ: 7.5, maxZ: 13.5 });
  });

  test("the map lies a short step ahead, as wide as the hall ahead allows", () => {
    for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const { dist, width } = castSpot(layout, sx, sz, fx, fz);
      expect(width).toBeGreaterThanOrEqual(MAP_WIDTH.min);
      expect(width).toBeLessThanOrEqual(MAP_WIDTH.dungeon);
      // Its near edge is the gap ahead of the caster's feet.
      expect(dist - width / 2).toBeCloseTo(MAP_GAP, 6);
      // A shrunk map ends before the wall ahead.
      if (width < MAP_WIDTH.dungeon && width > MAP_WIDTH.min) {
        const far = dist + width / 2;
        const tx = Math.floor((sx + fx * (far - 0.05)) / TILE + n / 2);
        const tz = Math.floor((sz + fz * (far - 0.05)) / TILE + n / 2);
        expect(layout.tiles[tz * n + tx]).toBe(1);
      }
    }
  });

  test("in the village it is always full size", () => {
    expect(castSpot(null, 0, 5, 0, -1)).toEqual({ dist: MAP_GAP + MAP_WIDTH.village / 2, width: MAP_WIDTH.village });
  });
});
