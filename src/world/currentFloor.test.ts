import { describe, expect, test } from "bun:test";
import { TILE } from "../core/config";
import { exploredVersion, isExplored, markExplored } from "./currentFloor";
import { generateFloor } from "./gen";

describe("exploration", () => {
  const layout = generateFloor(4254, 12);
  const n = layout.size;
  const [sx, , sz] = layout.spawn;
  const tx = Math.floor(sx / TILE + n / 2);
  const tz = Math.floor(sz / TILE + n / 2);

  test("a fresh floor is unseen", () => {
    expect(isExplored(layout, tx, tz)).toBe(false);
  });

  test("standing somewhere reveals the floor around you, not the walls", () => {
    const before = exploredVersion();
    expect(markExplored(layout, sx, sz, 4)).toBe(true);
    expect(exploredVersion()).toBeGreaterThan(before);
    expect(isExplored(layout, tx, tz)).toBe(true);
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) if (isExplored(layout, x, z)) expect(layout.tiles[z * n + x]).toBe(1);
    // Far away stays dark.
    const far = layout.exit;
    const fx = Math.floor(far[0] / TILE + n / 2);
    const fz = Math.floor(far[2] / TILE + n / 2);
    if (Math.hypot(fx - tx, fz - tz) > 6) expect(isExplored(layout, fx, fz)).toBe(false);
  });

  test("seeing the same place again changes nothing", () => {
    const v = exploredVersion();
    expect(markExplored(layout, sx, sz, 4)).toBe(false);
    expect(exploredVersion()).toBe(v);
  });

  test("off the grid is never explored", () => {
    expect(isExplored(layout, -1, 0)).toBe(false);
    expect(isExplored(layout, n, n)).toBe(false);
  });
});
