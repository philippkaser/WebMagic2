import { describe, expect, test } from "bun:test";
import { DIRT_H, DIRT_W, paintLensDirt } from "./lensDirt";

describe("lens dirt", () => {
  test("seeded: the same glass every time", () => {
    expect(paintLensDirt(7)).toEqual(paintLensDirt(7));
  });

  test("mostly clean glass with marks on it, never a fog", () => {
    const px = paintLensDirt();
    expect(px.length).toBe(DIRT_W * DIRT_H * 4);
    let sum = 0;
    let marked = 0;
    for (let i = 0; i < DIRT_W * DIRT_H; i++) {
      const v = px[i * 4 + 1] / 255;
      sum += v;
      if (v > 0.15) marked++;
    }
    const mean = sum / (DIRT_W * DIRT_H);
    expect(mean).toBeGreaterThan(0.01);
    expect(mean).toBeLessThan(0.25);
    expect(marked / (DIRT_W * DIRT_H)).toBeGreaterThan(0.01);
    expect(marked / (DIRT_W * DIRT_H)).toBeLessThan(0.5);
  });
});
