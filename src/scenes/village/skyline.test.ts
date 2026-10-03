import { describe, expect, test } from "bun:test";
import { angleDiff, crestElevation, MOON_ANGULAR_RADIUS, MOON_ELEVATION, NORTH } from "./skyline";

const DEG = Math.PI / 180;

describe("skyline", () => {
  test("the moon rises clear of the far range, only its foot behind the crest", () => {
    const bottom = MOON_ELEVATION - MOON_ANGULAR_RADIUS;
    // Across the moon's width the crest stays below its middle...
    for (let off = -8; off <= 8; off += 0.5) {
      const crest = crestElevation("far", NORTH + off * DEG);
      expect(crest).toBeLessThan(MOON_ELEVATION - MOON_ANGULAR_RADIUS * 0.4);
    }
    // ...but straight under it the crest hides a sliver of the disc.
    expect(crestElevation("far", NORTH)).toBeGreaterThan(bottom);
  });

  test("two titans stand either side of the moon, taller than the range under it", () => {
    const under = crestElevation("far", NORTH);
    let west = 0;
    let east = 0;
    for (let off = 15; off <= 28; off += 0.5) {
      west = Math.max(west, crestElevation("far", NORTH - off * DEG));
      east = Math.max(east, crestElevation("far", NORTH + off * DEG));
    }
    expect(west).toBeGreaterThan(under + 4 * DEG);
    expect(east).toBeGreaterThan(under + 3 * DEG);
  });

  test("the ranges step down toward the valley, and are highest in the north", () => {
    for (let b = 0; b < Math.PI * 2; b += 0.05) {
      expect(crestElevation("mid", b)).toBeLessThan(crestElevation("far", b) + 2 * DEG);
      expect(crestElevation("near", b)).toBeGreaterThanOrEqual(0);
      expect(crestElevation("near", b)).toBeLessThan(5 * DEG);
    }
    const south = crestElevation("far", NORTH + Math.PI);
    expect(crestElevation("far", NORTH)).toBeGreaterThan(south);
  });

  test("bearings wrap", () => {
    expect(angleDiff(0, Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 9);
    expect(angleDiff(NORTH, NORTH + 0.2)).toBeCloseTo(0.2, 9);
    // The silhouette is continuous across the seam at bearing 0.
    expect(Math.abs(crestElevation("far", 1e-6) - crestElevation("far", Math.PI * 2 - 1e-6))).toBeLessThan(0.002);
  });
});
