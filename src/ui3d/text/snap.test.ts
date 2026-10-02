import { describe, expect, test } from "bun:test";
import { newSnapper, outlineAt, stepSnapper, type Snapper } from "./snap";

describe("outlineAt", () => {
  test("full outline from two screen pixels per font pixel", () => {
    expect(outlineAt(2)).toBe(1);
    expect(outlineAt(3)).toBe(1);
  });
  test("a trace at one screen pixel, where it would fill the gaps", () => {
    expect(outlineAt(1)).toBeLessThan(0.5);
    expect(outlineAt(0.7)).toBeLessThan(0.5);
  });
});

describe("snapping that never pops", () => {
  const run = (s: Snapper, raws: number[], t0: number, dt = 1 / 60) => {
    let t = t0;
    let k = 0;
    for (const r of raws) {
      k = stepSnapper(s, r, t, dt);
      t += dt;
    }
    return { k, t };
  };

  test("still text lands on whole pixels, never below one", () => {
    for (const raw of [0.8, 1, 1.2, 1.6, 2.3, 2.7, 3.65, 7.4]) {
      const s = newSnapper();
      const { k } = run(s, Array(60).fill(raw), 0);
      const drawn = raw * k;
      expect(Math.abs(drawn - Math.round(drawn))).toBeLessThan(1e-3);
      expect(drawn).toBeGreaterThanOrEqual(1 - 1e-3);
    }
  });

  test("while it moves, the scale holds — no jump at a rounding point", () => {
    const s = newSnapper();
    run(s, Array(120).fill(1.4), 0); // settled on step 1
    const k0 = s.k;
    // Moving steadily from 1.4 to 1.8 (crosses 1.5): k never changes.
    const raws = Array.from({ length: 30 }, (_, i) => 1.4 + (0.4 * i) / 29);
    let t = 1;
    for (const r of raws) {
      expect(stepSnapper(s, r, t, 1 / 60)).toBe(k0);
      t += 1 / 60;
    }
  });

  test("once settled after moving, it eases (not jumps) onto the new step", () => {
    const s = newSnapper();
    run(s, Array(30).fill(1.0), 0);
    run(s, [1.3, 1.6, 1.9, 2.2], 1); // moved (each frame > drift)
    const before = s.k;
    const next = stepSnapper(s, 2.2, 1.2, 1 / 60);
    expect(next).toBe(before); // not settled yet
    const { k } = run(s, Array(60).fill(2.2), 1.5);
    expect(2.2 * k).toBeCloseTo(2, 2);
  });

  test("resting near a boundary keeps its step (hysteresis)", () => {
    const s = newSnapper();
    run(s, Array(40).fill(1.45), 0);
    expect(s.step).toBe(1);
    // Small wobble across 1.5 never changes the step.
    run(s, Array.from({ length: 120 }, (_, i) => 1.5 + 0.03 * Math.sin(i)), 1);
    expect(s.step).toBe(1);
  });

  test("text too small to snap is left at scale 1", () => {
    const s = newSnapper();
    const { k } = run(s, Array(30).fill(0.4), 0);
    expect(k).toBe(1);
  });
});
