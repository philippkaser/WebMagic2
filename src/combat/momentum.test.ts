import { describe, expect, test } from "bun:test";
import { chimeStep, createMomentum, creditKill, heatAt, manaFor, MOMENTUM, PENTATONIC, predictKill, stepRatio } from "./momentum";

describe("momentum", () => {
  test("kills within the window chain, and the rune words come on cue", () => {
    const m = createMomentum();
    const words: (string | null)[] = [];
    for (let i = 0; i < 6; i++) words.push(creditKill(m, i * 1, `k${i}`, true)!.callout);
    expect(words).toEqual([null, "DOUBLE", "TRIPLE", "RAMPAGE", null, "MASSACRE"]);
  });

  test("the window's edge: on it chains, past it starts over", () => {
    const m = createMomentum();
    creditKill(m, 0, "a", true);
    expect(creditKill(m, MOMENTUM.window, "b", true)!.multi).toBe(2);
    expect(creditKill(m, MOMENTUM.window * 2 + 0.01, "c", true)!.multi).toBe(1);
  });

  test("only kills the host credits to us count", () => {
    const m = createMomentum();
    creditKill(m, 0, "a", true);
    expect(creditKill(m, 0.3, "b", false)).toBeNull();
    expect(creditKill(m, 0.6, "c", true)!.multi).toBe(2);
  });

  test("the chime climbs on kills we saw land before the host's word arrives", () => {
    const m = createMomentum();
    expect(chimeStep(m, 0)).toBe(0);
    predictKill(m, 0, "a");
    expect(chimeStep(m, 0.05)).toBe(1);
    predictKill(m, 0.05, "b");
    // The credit for a arrives: still a chain of two (one credited, one held).
    creditKill(m, 0.1, "a", true);
    expect(chimeStep(m, 0.12)).toBe(2);
    // b was someone else's after all.
    creditKill(m, 0.15, "b", false);
    expect(chimeStep(m, 0.16)).toBe(1);
    // A held kill whose word never comes stops counting.
    predictKill(m, 3, "c");
    expect(chimeStep(m, 3)).toBe(1);
    expect(chimeStep(m, 3 + MOMENTUM.pendingFor + 0.01)).toBe(0);
  });

  test("the chime's steps climb a pentatonic scale and stop at its top", () => {
    let prev = 0;
    for (let s = 0; s < PENTATONIC.length; s++) {
      expect(stepRatio(s)).toBeGreaterThan(prev);
      prev = stepRatio(s);
    }
    expect(stepRatio(0)).toBe(1);
    expect(stepRatio(5)).toBeCloseTo(2, 9);
    expect(stepRatio(99)).toBe(stepRatio(PENTATONIC.length - 1));
    const m = createMomentum();
    for (let i = 0; i < 20; i++) creditKill(m, i * 0.1, `k${i}`, true);
    expect(chimeStep(m, 2)).toBe(PENTATONIC.length - 1);
  });

  test("heat builds with kills, holds, then cools", () => {
    const m = createMomentum();
    for (let i = 0; i < 6; i++) creditKill(m, i * 0.2, `k${i}`, true);
    expect(heatAt(m, 1)).toBe(1);
    expect(heatAt(m, 1 + MOMENTUM.hold)).toBe(1);
    expect(heatAt(m, 1 + MOMENTUM.hold + MOMENTUM.cool / 2)).toBeCloseTo(0.5, 9);
    expect(heatAt(m, 1 + MOMENTUM.hold + MOMENTUM.cool + 0.1)).toBe(0);
  });

  test("mana: a sip for a lone kill, more down the chain, capped", () => {
    expect(manaFor(1)).toBeGreaterThan(0);
    expect(manaFor(3)).toBeGreaterThan(manaFor(2));
    expect(manaFor(50)).toBe(manaFor(20));
    expect(manaFor(50)).toBeLessThanOrEqual(12);
  });
});
