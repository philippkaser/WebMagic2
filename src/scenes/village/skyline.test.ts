import { describe, expect, test } from "bun:test";
import { angleDiff, hillsCrest, MOON_ANGULAR_RADIUS, MOON_ELEVATION, NORTH, RANGE_FLOOR, rangeHeight, rangeSilhouette } from "./skyline";

const DEG = Math.PI / 180;

describe("skyline", () => {
  test("the moon rises out of the saddle: clear of the crest, its foot behind it", () => {
    const bottom = MOON_ELEVATION - MOON_ANGULAR_RADIUS;
    // Across the moon's width the saddle stays below its middle...
    for (let off = -5; off <= 5; off += 0.5) {
      expect(rangeSilhouette(NORTH + off * DEG)).toBeLessThan(MOON_ELEVATION - MOON_ANGULAR_RADIUS * 0.4);
    }
    // ...but straight under it the crest hides the bottom of the disc.
    expect(rangeSilhouette(NORTH)).toBeGreaterThan(bottom);
  });

  test("two titans stand either side of the moon, far above the saddle", () => {
    const under = rangeSilhouette(NORTH);
    let west = 0;
    let east = 0;
    for (let off = 12; off <= 30; off += 1) {
      west = Math.max(west, rangeSilhouette(NORTH - off * DEG));
      east = Math.max(east, rangeSilhouette(NORTH + off * DEG));
    }
    expect(west).toBeGreaterThan(under + 10 * DEG);
    expect(east).toBeGreaterThan(under + 10 * DEG);
    // Mountains, not hills: the titans fill a quarter of a 78° view.
    expect(Math.max(west, east)).toBeGreaterThan(25 * DEG);
  });

  test("the range is highest in the north and lower round the rest of the valley", () => {
    const north = rangeSilhouette(NORTH + 20 * DEG);
    for (let off = 90; off <= 270; off += 15) {
      const elsewhere = rangeSilhouette(NORTH + off * DEG);
      expect(elsewhere).toBeLessThan(north);
      expect(elsewhere).toBeGreaterThan(0); // but always above the horizon
    }
  });

  test("its feet are below the horizon (under the valley's forest)", () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) expect(rangeHeight(Math.cos(a) * 44, Math.sin(a) * 44)).toBeCloseTo(RANGE_FLOOR, 6);
  });

  test("the near hills are low, and continuous across the seam", () => {
    for (let b = 0; b < Math.PI * 2; b += 0.01) {
      expect(hillsCrest(b)).toBeGreaterThanOrEqual(0);
      expect(hillsCrest(b)).toBeLessThan(4 * DEG);
    }
    expect(angleDiff(0, Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 9);
    expect(angleDiff(NORTH, NORTH + 0.2)).toBeCloseTo(0.2, 9);
  });
});
