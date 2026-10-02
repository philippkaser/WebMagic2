import { describe, expect, test } from "bun:test";
import { BASE_FOV, pxFor } from "../anchors";
import { capFraction, FACE_CAP, nearestStep, typePx } from "./type";

/** Screen pixels per font pixel on an 800-px-high view for RuneText `px`. */
function drawn(px: number, cap: number, distance: number): number {
  const viewWorld = 2 * distance * Math.tan((BASE_FOV * Math.PI) / 360);
  return ((px * 7) / cap / viewWorld) * 800;
}

describe("type scale", () => {
  test("a step is exactly that many screen pixels per font pixel on the reference view", () => {
    for (const face of ["body", "label", "heading", "title"] as const)
      for (const n of [1, 2, 3, 5]) expect(drawn(typePx(1.6, n, face), FACE_CAP[face], 1.6)).toBeCloseTo(n, 6);
  });
  test("the same at any distance", () => {
    expect(drawn(typePx(0.7, 2), 5, 0.7)).toBeCloseTo(2, 6);
    expect(drawn(typePx(9, 2), 5, 9)).toBeCloseTo(2, 6);
  });
  test("agrees with pxFor's view-height fractions", () => {
    expect(typePx(1.5, 2)).toBeCloseTo(pxFor(1.5, capFraction(2)), 9);
    expect(capFraction(2)).toBeCloseTo(0.0125, 9);
    expect(capFraction(1, "heading")).toBeCloseTo(0.01875, 9);
  });
  test("nearest step never falls to zero", () => {
    expect(nearestStep(0.3)).toBe(1);
    expect(nearestStep(1.49)).toBe(1);
    expect(nearestStep(1.51)).toBe(2);
  });
});
