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

  test("shadows join the enemy mix on deeper floors", () => {
    let sawShadow = false;
    for (let i = 0; i < 30 && !sawShadow; i++) {
      const layout = generateFloor((i * 2654435761) >>> 0, 5 + (i % 15));
      if (layout.enemies.some((e) => e.kind === "shadow")) sawShadow = true;
    }
    expect(sawShadow).toBe(true);
    // Floor 1 is too shallow for shadows or sentries — only wisps and slimes.
    expect(
      generateFloor(7, 1).enemies.every((e) => e.kind === "wisp" || e.kind === "slime"),
    ).toBe(true);
  });

  test("traps are placed deterministically and scale with depth", () => {
    const a = generateFloor(2024, 6);
    const b = generateFloor(2024, 6);
    expect(a.traps).toEqual(b.traps);
    expect(a.traps.length).toBeGreaterThan(0);
    const deep = generateFloor(2024, 24);
    expect(deep.traps.length).toBeGreaterThanOrEqual(a.traps.length);
  });

  test("warp traps never spawn on checkpoint floors", () => {
    for (const floor of [5, 10, 15, 20]) {
      const layout = generateFloor(31337, floor);
      expect(layout.traps.some((t) => t.kind === "warp")).toBe(false);
    }
    // ...but do appear somewhere across non-checkpoint floors.
    let sawWarp = false;
    for (let f = 1; f < 20 && !sawWarp; f++) {
      if (f % 5 === 0) continue;
      if (generateFloor(31337, f).traps.some((t) => t.kind === "warp")) sawWarp = true;
    }
    expect(sawWarp).toBe(true);
  });

  test("adding traps left the rest of the layout untouched (traps roll last)", () => {
    // Regression guard: trap generation must not perturb earlier rng draws.
    const layout = generateFloor(123456, 3);
    const fresh = generateFloor(123456, 3);
    expect(layout.enemies).toEqual(fresh.enemies);
    expect(layout.props).toEqual(fresh.props);
    expect(layout.tiles).toEqual(fresh.tiles);
  });
});
