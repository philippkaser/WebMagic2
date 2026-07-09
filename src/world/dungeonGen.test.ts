import { describe, expect, test } from "bun:test";
import { TILE } from "../core/config";
import { generateFloor, isReachable } from "./dungeonGen";

describe("generateFloor", () => {
  test("is deterministic for the same seed", () => {
    const a = generateFloor(123456, 3);
    const b = generateFloor(123456, 3);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.enemies).toEqual(b.enemies);
    expect(a.props).toEqual(b.props);
  });

  test("differs across seeds", () => {
    const a = generateFloor(1, 3);
    const b = generateFloor(2, 3);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  test("spawn, exit and treasure are connected on many random floors", () => {
    for (let i = 0; i < 40; i++) {
      const seed = (i * 2654435761) >>> 0;
      const floor = 1 + (i % 20);
      const layout = generateFloor(seed, floor);
      expect(isReachable(layout, layout.spawn, layout.exit)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.treasure)).toBe(true);
      if (layout.leave) expect(isReachable(layout, layout.spawn, layout.leave)).toBe(true);
    }
  });

  test("checkpoint floors have a leave portal, others do not", () => {
    expect(generateFloor(99, 5).leave).not.toBeNull();
    expect(generateFloor(99, 10).leave).not.toBeNull();
    expect(generateFloor(99, 3).leave).toBeNull();
    expect(generateFloor(99, 7).leave).toBeNull();
  });

  test("merged wall colliders cover every visible wall cube", () => {
    const layout = generateFloor(777, 6);
    expect(layout.wallBoxes.length).toBeGreaterThan(0);
    // Far fewer colliders than rendered cubes — that's the point of merging.
    expect(layout.wallBoxes.length).toBeLessThan(layout.wallInstances.length / 2);
    for (const [wx, , wz] of layout.wallInstances) {
      const covered = layout.wallBoxes.some(
        (box) =>
          Math.abs(wx - box.center[0]) <= box.half[0] - TILE / 2 + 1e-6 &&
          Math.abs(wz - box.center[2]) <= box.half[2] - TILE / 2 + 1e-6,
      );
      expect(covered).toBe(true);
    }
  });

  test("boss floors (every 10th) spawn a boss in a reachable arena", () => {
    for (const floor of [10, 20, 30]) {
      const layout = generateFloor(4242, floor);
      expect(layout.boss).not.toBeNull();
      expect(isReachable(layout, layout.spawn, layout.boss!)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.exit)).toBe(true);
    }
    expect(generateFloor(4242, 9).boss).toBeNull();
    expect(generateFloor(4242, 11).boss).toBeNull();
    expect(generateFloor(4242, 5).boss).toBeNull();
  });

  test("enemies scale with depth", () => {
    const shallow = generateFloor(42, 1);
    const deep = generateFloor(42, 15);
    expect(deep.enemies.length).toBeGreaterThan(shallow.enemies.length);
  });
});
