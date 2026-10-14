import { describe, expect, test } from "bun:test";
import { CRIT, critMult, pathCrit, rayCrit, sweptCrit } from "./precision";

const head = { x: 0, y: 1.05, z: 5, r: 0.3 };
const fwd = { x: 0, y: 0, z: 1 };

describe("precision hits", () => {
  test("a ray through the weak point crits; one beside it doesn't", () => {
    expect(rayCrit({ x: 0, y: 1.05, z: 0 }, fwd, head, 10)).toBe(true);
    expect(rayCrit({ x: 0, y: 1.05 + 0.29, z: 0 }, fwd, head, 10)).toBe(true);
    expect(rayCrit({ x: 0, y: 1.05 + 0.31, z: 0 }, fwd, head, 10)).toBe(false);
    expect(rayCrit({ x: 0, y: 0.5, z: 0 }, fwd, head, 10)).toBe(false);
  });

  test("a ray crits only within its reach, and never behind it", () => {
    expect(rayCrit({ x: 0, y: 1.05, z: 0 }, fwd, head, 4.6)).toBe(false);
    expect(rayCrit({ x: 0, y: 1.05, z: 0 }, fwd, head, 4.75)).toBe(true);
    expect(rayCrit({ x: 0, y: 1.05, z: 10 }, fwd, head, 100)).toBe(false);
  });

  test("a bolt bursting on the skin crits a core it was flying into", () => {
    const core = { x: 0, y: 1.6, z: 5, r: 0.14 };
    // Burst on a 0.42 m body's skin, heading for its heart.
    const skin = { x: 0, y: 1.6, z: 5 - 0.42 - 0.13 };
    expect(pathCrit(skin, fwd, core, 0.13, 0.45)).toBe(true);
    // The same skin, but flying past the core's side.
    expect(pathCrit({ x: 0.35, y: 1.6, z: 4.6 }, fwd, core, 0.13, 0.45)).toBe(false);
  });

  test("a bolt's line is followed no deeper than the body: no crits out the far side", () => {
    const eyes = { x: 0, y: 1, z: 5.4, r: 0.14 };
    // Hit from behind the head (the eyes face away, 0.88 m beyond the skin).
    const back = { x: 0, y: 1, z: 6.3 };
    const away = { x: 0, y: 0, z: -1 };
    expect(pathCrit(back, away, eyes, 0.1, 0.44)).toBe(false);
    expect(pathCrit(back, away, eyes, 0.1, 1.2)).toBe(true);
  });

  test("a piercing bolt's sweep crits what it passes through", () => {
    const a = { x: 0, y: 1.05, z: 3 };
    const b = { x: 0, y: 1.05, z: 7 };
    expect(sweptCrit(a, b, head, 0.1)).toBe(true);
    expect(sweptCrit({ x: 0, y: 0.4, z: 3 }, { x: 0, y: 0.4, z: 7 }, head, 0.1)).toBe(false);
    // Stopped short of it this frame.
    expect(sweptCrit(a, { x: 0, y: 1.05, z: 4.2 }, head, 0.1)).toBe(false);
  });

  test("the multiplier: the standard, a spot's own, never past the cap or below 1", () => {
    expect(critMult(head)).toBe(CRIT.mult);
    expect(critMult({ ...head, mult: 2 })).toBe(2);
    expect(critMult({ ...head, mult: 9 })).toBe(CRIT.maxMult);
    expect(critMult({ ...head, mult: 0.2 })).toBe(1);
    expect(critMult({ ...head, mult: Number.NaN })).toBe(CRIT.mult);
    expect(critMult(null)).toBe(CRIT.mult);
  });
});
