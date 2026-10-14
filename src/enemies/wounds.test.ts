import { describe, expect, test } from "bun:test";
import { KNEE } from "../game/vitality";
import { createWoundLook, heartbeat, sputter, woundLook } from "./wounds";

describe("wounds", () => {
  test("a fresh body is whole: steady glow, no leak, no list", () => {
    const w = woundLook(1, 3.2, 0.4, createWoundLook());
    expect(w.stage).toBe(0);
    expect(w.glow).toBe(1);
    expect(w.leak).toBe(0);
    expect(w.list).toBe(0);
    expect(w.crack).toBe(0);
  });

  test("past the knee it breaks: it sputters, leaks and lists", () => {
    const w = woundLook(KNEE.real - 0.01, 1, 0.2, createWoundLook());
    expect(w.stage).toBe(2);
    expect(w.leak).toBeGreaterThan(0);
    expect(w.list).toBeGreaterThan(0.05);
    expect(w.sag).toBeGreaterThan(0);
    expect(w.breath).toBeGreaterThan(1);
  });

  test("dying leaks faster and lists further than broken", () => {
    const broken = woundLook(0.4, 1, 0.2, createWoundLook());
    const dying = woundLook(0.1, 1, 0.2, createWoundLook());
    expect(dying.stage).toBe(3);
    expect(dying.leak).toBeGreaterThan(broken.leak);
    expect(dying.sag).toBeGreaterThan(broken.sag);
  });

  test("cracks open in four hard steps as life falls", () => {
    const seen = new Set<number>();
    for (let r = 1; r >= 0; r -= 0.01) seen.add(woundLook(r, 0, 0, createWoundLook()).crack);
    expect([...seen].sort()).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  test("the sputter is deterministic, stepped, and drops out more as it fades", () => {
    expect(sputter(1.234, 0.5, 0.6)).toBe(sputter(1.234, 0.5, 0.6));
    const holes = (amount: number) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (sputter(i / 37, 0.3, amount) < 0.5) n++;
      return n;
    };
    expect(holes(0)).toBe(0);
    expect(holes(0.6)).toBeGreaterThan(holes(0.3));
    for (let i = 0; i < 200; i++) expect([0.15, 0.6, 1]).toContain(sputter(i / 13, 0.9, 0.5));
  });

  test("the heartbeat beats twice, then rests", () => {
    expect(heartbeat(0, 60)).toBe(1);
    expect(heartbeat(0.2, 60)).toBe(0.75);
    expect(heartbeat(0.5, 60)).toBe(0);
  });

  test("neighbours don't flicker in step", () => {
    let same = 0;
    for (let i = 0; i < 300; i++) if (sputter(i / 11, 0.1, 0.6) === sputter(i / 11, 0.7, 0.6)) same++;
    expect(same).toBeLessThan(290);
  });
});
