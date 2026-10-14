import { describe, expect, test } from "bun:test";
import { createStopper, hitstopFor, punchFor, requestStop, STOP } from "./impact";

const blow = (weight: number, killed = false, crit = false, boss = false) => ({ weight, killed, crit, boss });

describe("hitstop sizing", () => {
  test("a stream's ticks never stop the frame; light shots don't either", () => {
    expect(hitstopFor(blow(0.1))).toBe(0);
    expect(hitstopFor(blow(0.1, false, true))).toBe(0);
    expect(hitstopFor(blow(0.4))).toBe(0);
  });

  test("tiers: heavy < kill < precision kill < the Warden", () => {
    const heavy = hitstopFor(blow(0.9));
    const kill = hitstopFor(blow(0.4, true));
    const critKill = hitstopFor(blow(0.4, true, true));
    const boss = hitstopFor(blow(0.4, true, false, true));
    expect(heavy).toBeCloseTo(0.04, 9);
    expect(kill).toBeGreaterThan(heavy);
    expect(critKill).toBeGreaterThan(kill);
    expect(boss).toBeGreaterThan(critKill);
    expect(boss).toBeLessThanOrEqual(0.25);
  });

  test("monotonic: more weight, a crit or a kill never shortens the stop", () => {
    for (const killed of [false, true]) {
      for (const crit of [false, true]) {
        let prev = 0;
        for (let w = 0; w <= 1; w += 0.05) {
          const s = hitstopFor(blow(w, killed, crit));
          expect(s).toBeGreaterThanOrEqual(prev);
          prev = s;
        }
      }
    }
    for (let w = 0; w <= 1; w += 0.1) {
      expect(hitstopFor(blow(w, false, true))).toBeGreaterThanOrEqual(hitstopFor(blow(w)));
      expect(hitstopFor(blow(w, true))).toBeGreaterThanOrEqual(hitstopFor(blow(w, false, true)));
    }
  });

  test("stops hard on each other's heels are halved; spaced ones aren't", () => {
    const s = createStopper();
    expect(requestStop(s, 0, STOP.kill)).toBe(STOP.kill);
    expect(requestStop(s, 0.1, STOP.kill)).toBe(STOP.kill / 2);
    expect(requestStop(s, 1, STOP.kill)).toBe(STOP.kill);
    expect(requestStop(s, 1.01, STOP.boss, true)).toBe(STOP.boss);
    expect(requestStop(s, 5, 0)).toBe(0);
  });

  test("the punch: a kill pops, precision and overkill harder, the Warden full", () => {
    expect(punchFor(false, false, 0)).toBeGreaterThan(0.3);
    expect(punchFor(true, false, 0)).toBeGreaterThan(punchFor(false, false, 0));
    expect(punchFor(false, false, 1)).toBeGreaterThan(punchFor(false, false, 0));
    expect(punchFor(true, false, 9)).toBeLessThanOrEqual(1);
    expect(punchFor(false, true, 0)).toBe(1);
  });
});
