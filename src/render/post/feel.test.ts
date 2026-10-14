import { describe, expect, test } from "bun:test";
import { heartbeat, kickDash, kickHurt, kickImpact, kickKill, lowOf, newFeel, stepFeel, stepKill } from "./feel";

describe("post feel", () => {
  test("kicks land and fall away to nothing", () => {
    const f = newFeel();
    kickImpact(f, 0.7);
    kickHurt(f, 20);
    kickDash(f);
    expect(f.impact).toBeGreaterThan(0.7);
    expect(f.hurt).toBeGreaterThan(0.5);
    expect(f.dash).toBe(1);
    for (let i = 0; i < 300; i++) stepFeel(f, 1 / 60, 1);
    expect(f.impact).toBe(0);
    expect(f.hurt).toBe(0);
    expect(f.dash).toBe(0);
  });

  test("stacked kicks never pass the top", () => {
    const f = newFeel();
    for (let i = 0; i < 20; i++) {
      kickImpact(f, 1);
      kickHurt(f, 999);
    }
    expect(f.impact).toBe(1);
    expect(f.hurt).toBe(1);
  });

  test("a blast's punch is shorter than a blow's sting", () => {
    const f = newFeel();
    kickImpact(f, 0.6);
    f.hurt = f.impact;
    stepFeel(f, 0.25, 1);
    expect(f.impact).toBeLessThan(f.hurt);
  });

  test("near death: nothing above a third, everything at zero", () => {
    expect(lowOf(1)).toBe(0);
    expect(lowOf(0.4)).toBe(0);
    expect(lowOf(0)).toBe(1);
    expect(lowOf(0.1)).toBeGreaterThan(lowOf(0.25));
  });

  test("the grey eases in, and the heart beats only near death", () => {
    const f = newFeel();
    stepFeel(f, 1 / 60, 0.05);
    expect(f.low).toBeGreaterThan(0);
    expect(f.low).toBeLessThan(0.5);
    let maxBeat = 0;
    for (let i = 0; i < 240; i++) {
      stepFeel(f, 1 / 60, 0.05);
      maxBeat = Math.max(maxBeat, f.beat);
    }
    expect(f.low).toBeGreaterThan(0.9);
    expect(maxBeat).toBeGreaterThan(0.8);
    for (let i = 0; i < 240; i++) stepFeel(f, 1 / 60, 1);
    expect(f.low).toBeLessThan(0.01);
  });

  test("heartbeat is a lub-dub in 0…1", () => {
    let peak = 0;
    for (let p = 0; p < 1; p += 0.01) {
      const b = heartbeat(p);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      peak = Math.max(peak, b);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(heartbeat(0.6)).toBeLessThan(0.01);
  });
});

describe("the kill punch", () => {
  test("it pops, holds while the picture is held, then falls away", () => {
    const f = newFeel();
    kickKill(f, 0.6);
    expect(f.kill).toBeGreaterThan(0.6);
    const peak = f.kill;
    stepKill(f, 0); // a hitstop frame: the picture's dt is 0
    expect(f.kill).toBe(peak);
    for (let i = 0; i < 60; i++) stepKill(f, 1 / 60);
    expect(f.kill).toBe(0);
  });

  test("stacked kills never pass the top, and it leaves the other channels be", () => {
    const f = newFeel();
    for (let i = 0; i < 10; i++) kickKill(f, 1);
    expect(f.kill).toBe(1);
    expect(f.impact + f.hurt + f.dash).toBe(0);
    stepFeel(f, 0.1, 1);
    expect(f.kill).toBe(1);
  });
});
