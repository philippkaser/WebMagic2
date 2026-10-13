import { describe, expect, test } from "bun:test";
import { type BounceLight, bakeBounce, linearRgb } from "./bounce";
import type { OccupancyGrid } from "./gridRay";

function grid(rows: string[]): OccupancyGrid {
  const size = rows.length;
  const tiles = new Uint8Array(size * size);
  rows.forEach((r, y) => {
    for (let x = 0; x < size; x++) tiles[y * size + x] = r[x] === "." ? 1 : 0;
  });
  return { tiles, size };
}

// Room A (top), a wall with a doorway at x = 8, room B (bottom), and a
// sealed room C on the right that nothing opens into.
const PLAN = grid([
  "################",
  "#.........#....#",
  "#.........#....#",
  "#.........#....#",
  "#.........#....#",
  "########.###...#",
  "#..........#...#",
  "#..........#...#",
  "#..........#####",
  "#..........#...#",
  "#..........#...#",
  "############...#",
  "#..............#",
  "#..............#",
  "#..............#",
  "################",
]);
const TILE = 2;
const world = (tx: number, ty: number) => ({ x: (tx - PLAN.size / 2) * TILE, z: (ty - PLAN.size / 2) * TILE });

/** Field value (sum of rgb) at the middle of tile (tx, ty). */
function at(f: { width: number; rgb: Float32Array }, tx: number, ty: number, res = 2): number {
  const i = tx * res + 1;
  const j = ty * res + 1;
  const k = (j * f.width + i) * 3;
  return f.rgb[k] + f.rgb[k + 1] + f.rgb[k + 2];
}

const torch = (tx: number, ty: number, color = "#ff9a4d"): BounceLight => {
  const w = world(tx + 0.5, ty + 0.5);
  return { x: w.x, y: 3.35, z: w.z, color: linearRgb(color), intensity: 7, range: 10 };
};

describe("bounce bake", () => {
  test("no lights, no bounce", () => {
    const f = bakeBounce(PLAN, []);
    expect(f.width).toBe(PLAN.size * 2);
    expect(f.rgb.every((v) => v === 0)).toBe(true);
  });

  test("lights its room, spills faintly through the door, never into a sealed room", () => {
    const f = bakeBounce(PLAN, [torch(4, 2)]);
    const inRoom = at(f, 4, 3);
    const throughDoor = at(f, 8, 6);
    const roundCorner = at(f, 3, 7);
    const sealed = at(f, 13, 2);
    expect(inRoom).toBeGreaterThan(0.05);
    expect(throughDoor).toBeGreaterThan(0);
    expect(throughDoor).toBeLessThan(inRoom);
    expect(roundCorner).toBeLessThan(throughDoor);
    // Beyond the wall from the torch, the spill is far fainter than in its room.
    expect(roundCorner).toBeLessThan(inRoom * 0.35);
    expect(sealed).toBe(0);
  });

  test("keeps the light's colour", () => {
    const teal = linearRgb("#5cffc8");
    const f = bakeBounce(PLAN, [torch(4, 2, "#5cffc8")]);
    const k = ((3 * 2 + 1) * f.width + 4 * 2 + 1) * 3;
    const [r, g, b] = [f.rgb[k], f.rgb[k + 1], f.rgb[k + 2]];
    expect(g / r).toBeCloseTo(teal[1] / teal[0], 3);
    expect(b / g).toBeCloseTo(teal[2] / teal[1], 3);
  });

  test("grows one cell into the rock, no further", () => {
    const f = bakeBounce(PLAN, [torch(4, 2)]);
    const n = f.width;
    const v = (i: number, j: number) => f.rgb[(j * n + i) * 3];
    // Tile (4, 0) is the wall above room A: its lower fine row borders the room.
    expect(v(9, 1)).toBeGreaterThan(0);
    expect(v(9, 0)).toBe(0);
  });

  test("deterministic", () => {
    const a = bakeBounce(PLAN, [torch(4, 2), torch(3, 9, "#a58cff")]);
    const b = bakeBounce(PLAN, [torch(4, 2), torch(3, 9, "#a58cff")]);
    expect(a.rgb).toEqual(b.rgb);
  });

  test("linearRgb decodes sRGB like three", () => {
    expect(linearRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(linearRgb("#000000")).toEqual([0, 0, 0]);
    expect(linearRgb("#808080")[0]).toBeCloseTo(0.2159, 3);
  });
});
