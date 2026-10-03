import { describe, expect, test } from "bun:test";
import { aimDir, blendFactor, blendVelocity, wakes, wrapAngle } from "./common";

describe("brain helpers", () => {
  test("blendFactor is 0 for no time and approaches 1 as time grows", () => {
    expect(blendFactor(3, 0)).toBe(0);
    expect(blendFactor(3, 1 / 60)).toBeGreaterThan(0);
    expect(blendFactor(3, 1 / 60)).toBeLessThan(0.1);
    expect(blendFactor(3, 10)).toBeCloseTo(1, 6);
  });

  test("blendFactor is frame-rate independent", () => {
    // Two 1/60 s steps close the same gap as one 1/30 s step.
    const k60 = blendFactor(2.8, 1 / 60);
    const twoSteps = 1 - (1 - k60) * (1 - k60);
    expect(twoSteps).toBeCloseTo(blendFactor(2.8, 1 / 30), 10);
  });

  test("blendVelocity moves part-way and may write in place", () => {
    const v = { x: 0, y: 10, z: -4 };
    const desired = { x: 10, y: 0, z: 4 };
    blendVelocity(v, desired, 0.25, desired);
    expect(desired).toEqual({ x: 2.5, y: 7.5, z: -2 });
  });

  test("aimDir is a unit vector, and zero (not NaN) for a zero span", () => {
    const out = { x: 0, y: 0, z: 0 };
    aimDir({ x: 1, y: 1, z: 1 }, { x: 4, y: 5, z: 1 }, out);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.8);
    expect(out.z).toBeCloseTo(0);
    aimDir({ x: 2, y: 2, z: 2 }, { x: 2, y: 2, z: 2 }, out);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("wrapAngle folds into [−π, π] without changing the direction", () => {
    for (const a of [0, 1, -1, 3.5, -3.5, 10, -10, 7 * Math.PI]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 10);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 10);
    }
  });

  test("wakes latches: in range wakes, out of range keeps the current state", () => {
    expect(wakes(false, 20, 15)).toBe(false);
    expect(wakes(false, 14.9, 15)).toBe(true);
    expect(wakes(true, 100, 15)).toBe(true);
  });
});
