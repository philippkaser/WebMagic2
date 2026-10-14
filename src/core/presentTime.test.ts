import { beforeEach, describe, expect, test } from "bun:test";
import { hitstop, MAX_HOLD_S, presentDt, presentScale, resetPresentTime, slowMo } from "./presentTime";

describe("the presentation clock", () => {
  beforeEach(resetPresentTime);

  test("hitstop holds the picture, stacking but capped", () => {
    hitstop(0.08, 10);
    expect(presentScale(10.05)).toBe(0);
    expect(presentScale(10.09)).toBe(1);
    hitstop(0.2, 20);
    hitstop(0.2, 20.1);
    expect(presentScale(20 + MAX_HOLD_S - 0.001)).toBe(0);
    expect(presentScale(20.1 + MAX_HOLD_S + 0.001)).toBe(1);
  });

  test("slow motion scales dt until it runs out", () => {
    slowMo(0.25, 1, 5);
    expect(presentDt(0.016, 5.5)).toBeCloseTo(0.004, 9);
    expect(presentDt(0.016, 6.1)).toBeCloseTo(0.016, 9);
  });
});
