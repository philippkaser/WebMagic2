import { describe, expect, test } from "bun:test";
import { HEART, lowOf } from "../game/heart";
import { MUFFLE, muffleOf } from "./muffle";

describe("the world going under", () => {
  test("wide open while whole; closing as death nears", () => {
    const whole = muffleOf(0, 0, 0);
    expect(whole.cutoff).toBeCloseTo(MUFFLE.open, 6);
    expect(whole.gain).toBe(1);
    const line = muffleOf(HEART.onset, 0, 0);
    // Crossing the line is already a step you can hear…
    expect(line.cutoff).toBeLessThan(MUFFLE.open / 2.5);
    // …and it keeps closing to the deep at death's door.
    let prev = Infinity;
    for (let f = 0.29; f >= 0; f -= 0.01) {
      const m = muffleOf(lowOf(f), 0, 0);
      expect(m.cutoff).toBeLessThan(prev);
      prev = m.cutoff;
    }
    expect(muffleOf(1, 0, 0).cutoff).toBeCloseTo(MUFFLE.deep, 6);
    expect(muffleOf(1, 0, 0).gain).toBeLessThan(1);
  });

  test("the Brink punches the world out; a second wind throws it open", () => {
    const brink = muffleOf(1, 1, 0);
    expect(brink.cutoff).toBeCloseTo(MUFFLE.brink, 6);
    expect(brink.gain).toBeLessThan(0.4);
    const wind = muffleOf(0.8, 0, 1);
    expect(wind.cutoff).toBeCloseTo(MUFFLE.open, 6);
    expect(wind.gain).toBe(1);
  });

  test("writes into the object it's given", () => {
    const out = { cutoff: 0, gain: 0 };
    expect(muffleOf(0.5, 0.2, 0, out)).toBe(out);
    expect(out.cutoff).toBeGreaterThan(MUFFLE.brink);
  });
});
