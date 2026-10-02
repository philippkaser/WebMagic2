import { describe, expect, test } from "bun:test";
import { snapScale } from "./snap";

describe("pixel snapping", () => {
  test("lands every font pixel on a whole number of screen pixels", () => {
    for (const s of [1, 1.2, 1.49, 1.51, 2.03, 2.7, 3.65, 7.4]) {
      const k = s * snapScale(s);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      expect(k).toBeGreaterThanOrEqual(1);
    }
  });

  test("nudges, never jumps far, once text is two pixels a font pixel or more", () => {
    for (let s = 2; s < 8; s += 0.05) expect(Math.abs(snapScale(s) - 1)).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  test("leaves sub-pixel text alone", () => {
    expect(snapScale(0.5)).toBe(1);
    expect(snapScale(0)).toBe(1);
  });
});
