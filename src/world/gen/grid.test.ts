import { describe, expect, test } from "bun:test";
import { TILE } from "../../core/config";
import { FLOOR, Grid, SOLID, floodFill, tileToWorld, toWorld, worldToTile } from "./grid";

describe("grid", () => {
  test("tile ↔ world round-trips, including points pushed toward a wall", () => {
    for (const size of [37, 50, 64]) {
      for (const [tx, ty] of [
        [0, 0],
        [3, 17],
        [size - 1, size - 1],
      ] as [number, number][]) {
        const p = toWorld(tx, ty, size);
        expect(worldToTile(p, size)).toEqual([tx, ty]);
        // Wall-mounted things sit up to ~0.46 TILE off-centre; still this tile.
        for (const d of [-0.46, 0.46]) {
          expect(worldToTile([p[0] + d * TILE, 0, p[2]], size)).toEqual([tx, ty]);
          expect(worldToTile([p[0], 0, p[2] + d * TILE], size)).toEqual([tx, ty]);
        }
        expect(tileToWorld([tx, ty], size, 2.5)[1]).toBe(2.5);
      }
    }
  });

  test("carving never touches the two outer rings", () => {
    const grid = new Grid(10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) grid.carve(x, y);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const inner = x > 1 && y > 1 && x < 8 && y < 8;
        expect(grid.at(x, y)).toBe(inner ? FLOOR : SOLID);
      }
    }
    expect(grid.at(-1, 4)).toBe(SOLID);
    expect(grid.at(4, 10)).toBe(SOLID);
  });

  test("flood fill follows 4-connected floor only", () => {
    const grid = new Grid(12);
    for (let x = 2; x <= 5; x++) grid.carve(x, 3);
    grid.carve(6, 4); // diagonal only — not connected
    const seen = floodFill(grid.tiles, grid.size, [2, 3]);
    expect(seen[3 * 12 + 5]).toBe(1);
    expect(seen[4 * 12 + 6]).toBe(0);
  });
});
