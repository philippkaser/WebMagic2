import { describe, expect, test } from "bun:test";
import { Color } from "three";
import { floorTint, turnHue } from "./floorTint";

describe("floor tint", () => {
  test("seeded: the same floor, the same light, for everyone on it", () => {
    expect(floorTint(1234)).toEqual(floorTint(1234));
  });

  test("a small turn of the wheel, different from floor to floor", () => {
    const hues = Array.from({ length: 200 }, (_, i) => floorTint(i * 7919 + 13).hue);
    for (const h of hues) expect(Math.abs(h)).toBeLessThanOrEqual(0.4);
    // Spread both ways, not stuck.
    expect(Math.min(...hues)).toBeLessThan(-0.15);
    expect(Math.max(...hues)).toBeGreaterThan(0.15);
    expect(new Set(hues.map((h) => h.toFixed(3))).size).toBeGreaterThan(150);
  });

  test("turnHue turns the hue and keeps saturation and lightness", () => {
    const a = { h: 0, s: 0, l: 0 };
    const b = { h: 0, s: 0, l: 0 };
    new Color("#ff9a4d").getHSL(a);
    new Color(turnHue("#ff9a4d", Math.PI / 3)).getHSL(b);
    expect(b.h - a.h).toBeCloseTo(1 / 6, 2);
    expect(b.s).toBeCloseTo(a.s, 2);
    expect(b.l).toBeCloseTo(a.l, 2);
    expect(turnHue("#336699", 0)).toBe("#336699");
  });
});
