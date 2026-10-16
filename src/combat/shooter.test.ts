import { afterEach, describe, expect, test } from "bun:test";
import { presentScale, resetPresentTime } from "../core/presentTime";
import { STOP } from "./impact";
import { landing } from "./landing";
import { breakStop } from "./shooter";

/** Our own clock for the stopper, far from anything else in the run. */
let t = 10_000;

describe("the knee's break under your blow", () => {
  afterEach(() => {
    landing.weight = Number.NaN;
    resetPresentTime();
    t += 100; // well clear of the last stop's refractory
  });

  test("a bolt that breaks one catches the frame", () => {
    landing.weight = 0.5;
    expect(breakStop(t)).toBeGreaterThan(0);
    expect(presentScale()).toBe(0);
  });

  test("a beam's or a flame's tick that breaks one holds nothing", () => {
    landing.weight = STOP.tickWeight * 0.5;
    expect(breakStop(t)).toBe(0);
    expect(presentScale()).toBe(1);
  });

  test("a break from no weapon (a blast, a barrel) still catches it", () => {
    expect(breakStop(t)).toBeGreaterThan(0);
  });

  test("a sweep breaking a nest one after another is cut short, not stammered", () => {
    landing.weight = 0.5;
    const first = breakStop(t);
    const next = breakStop(t + first + 0.05);
    expect(next).toBeCloseTo(first * 0.5, 9);
  });
});
