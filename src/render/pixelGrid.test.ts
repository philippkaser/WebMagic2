import { describe, expect, test } from "bun:test";
import { pixelGrid, TARGET_LINES } from "./pixelGrid";

const SCREENS: [cssW: number, cssH: number, ratio: number][] = [
  [1920, 1080, 1],
  [1920, 950, 1], // a 1080p browser window
  [1366, 768, 1],
  [1280, 720, 1],
  [2560, 1440, 1],
  [2560, 1300, 1],
  [3840, 2160, 1],
  [1440, 900, 2], // a retina laptop
  [1512, 945, 2],
  [1536, 864, 1.25], // Windows display scaling
  [1280, 720, 1.5],
  [3440, 1440, 1], // ultrawide
];

describe("pixel grid", () => {
  test("every world pixel is a whole number of device pixels", () => {
    for (const [w, h, r] of SCREENS) {
      const g = pixelGrid(w, h, r);
      expect(Number.isInteger(g.scale)).toBe(true);
      expect(g.scale).toBeGreaterThanOrEqual(1);
      // The canvas box maps world pixels to `scale` device pixels each
      // (within the quarter-pixel slack across the whole box).
      expect(Math.abs(g.cssWidth * r - g.width * g.scale)).toBeLessThan(0.5);
      expect(Math.abs(g.cssHeight * r - g.height * g.scale)).toBeLessThan(0.5);
      // What the renderer will allocate: floor(css × dpr) is exactly the grid.
      expect(Math.floor(g.cssWidth * g.dpr)).toBe(g.width);
      expect(Math.floor(g.cssHeight * g.dpr)).toBe(g.height);
    }
  });

  test("players see nearly the same chunkiness on any monitor", () => {
    for (const [w, h, r] of SCREENS) {
      const { height } = pixelGrid(w, h, r);
      expect(height).toBeGreaterThan(TARGET_LINES * 0.8);
      expect(height).toBeLessThan(TARGET_LINES * 1.25);
    }
  });

  test("the box covers the window, overhanging by less than a world pixel, centred", () => {
    for (const [w, h, r] of SCREENS) {
      const g = pixelGrid(w, h, r);
      expect(g.cssLeft).toBeLessThanOrEqual(0);
      expect(g.cssTop).toBeLessThanOrEqual(0);
      expect(g.cssLeft + g.cssWidth).toBeGreaterThanOrEqual(w);
      expect(g.cssTop + g.cssHeight).toBeGreaterThanOrEqual(h);
      expect(g.cssWidth - w).toBeLessThan(g.scale / r + 0.01);
      // Offsets land on whole device pixels.
      expect(Number.isInteger(Math.round(g.cssLeft * r * 1e6) / 1e6)).toBe(true);
    }
  });

  test("a 1080p screen keeps about the old look", () => {
    expect(pixelGrid(1920, 1080, 1)).toMatchObject({ scale: 3, height: 360, width: 640 });
    expect(pixelGrid(3840, 2160, 1).height).toBe(360);
  });

  test("degenerate sizes don't break", () => {
    const g = pixelGrid(0, 0, 0);
    expect(g.scale).toBe(1);
    expect(g.width).toBeGreaterThanOrEqual(1);
  });
});
