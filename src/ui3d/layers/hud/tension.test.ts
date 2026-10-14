import { describe, expect, test } from "bun:test";
import { discBelow, heightForFill, levelToHeight } from "./orbMaterials";

describe("the orb tells the truth", () => {
  test("a disc's area below a chord: ends, middle, monotonic", () => {
    expect(discBelow(-1)).toBeCloseTo(0, 9);
    expect(discBelow(0)).toBeCloseTo(0.5, 9);
    expect(discBelow(1)).toBeCloseTo(1, 9);
    let prev = -1;
    for (let h = -1; h <= 1; h += 0.05) {
      expect(discBelow(h)).toBeGreaterThan(prev);
      prev = discBelow(h);
    }
  });

  test("exact at the ends, monotonic between", () => {
    expect(heightForFill(0)).toBe(levelToHeight(0));
    expect(heightForFill(1)).toBe(levelToHeight(1));
    expect(heightForFill(0.5)).toBeCloseTo(levelToHeight(0.5), 3);
    let prev = -Infinity;
    for (let f = 0.01; f < 1; f += 0.01) {
      expect(heightForFill(f)).toBeGreaterThan(prev);
      prev = heightForFill(f);
    }
  });

  test("30 % of the value covers 30 % of the orb (not a quarter)", () => {
    const bottom = -0.88;
    const top = 0.86;
    for (const f of [0.1, 0.3, 0.7]) {
      const h = heightForFill(f);
      // Back to the unit disc the area is judged on.
      const unit = ((h - bottom) / (top - bottom)) * 2 - 1;
      expect(discBelow(unit)).toBeCloseTo(f, 3);
    }
    // Low values stand higher than a straight level would put them.
    expect(heightForFill(0.3)).toBeGreaterThan(levelToHeight(0.3));
    expect(heightForFill(0.7)).toBeLessThan(levelToHeight(0.7));
  });
});
