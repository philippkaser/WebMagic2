import { describe, expect, test } from "bun:test";
import { crossedKnee, harmWizard, KNEE, LAST_STAND, LETHAL_GRACE, lastStandDamage, realFrac, shownFrac, woundStage } from "./vitality";

describe("the knee", () => {
  test("half the life shows as the last third; ends and monotonic", () => {
    expect(shownFrac(1)).toBe(1);
    expect(shownFrac(0)).toBe(0);
    expect(shownFrac(KNEE.real)).toBeCloseTo(1 / 3, 9);
    let prev = -1;
    for (let r = 0; r <= 1.0001; r += 0.01) {
      const s = shownFrac(r);
      expect(s).toBeGreaterThan(prev);
      expect(realFrac(s)).toBeCloseTo(Math.min(1, r), 9);
      prev = s;
    }
  });

  test("wound stages and the break beat", () => {
    expect([1, 0.7, 0.4, 0.1].map(woundStage)).toEqual([0, 1, 2, 3]);
    expect(crossedKnee(0.6, 0.45)).toBe(true);
    expect(crossedKnee(0.45, 0.3)).toBe(false);
    expect(crossedKnee(0.6, 0)).toBe(false); // a kill isn't a break
  });
});

describe("last stand and lethal grace", () => {
  test("harm above the line lands in full, below it is halved", () => {
    expect(lastStandDamage(100, 100, 20)).toBe(20);
    expect(lastStandDamage(40, 100, 20)).toBe(10 + 10 * LAST_STAND.damageMult);
    expect(lastStandDamage(20, 100, 10)).toBe(5);
    // The last 30% lasts as long as the 60% before it.
    const lastBand = 30 / LAST_STAND.damageMult;
    expect(lastBand).toBe(60);
  });

  test("a killing blow from half health or more leaves you at 1, once a while", () => {
    const a = harmWizard(80, 100, 500, 10, 0);
    expect(a).toEqual({ health: LETHAL_GRACE.leaves, brink: true, graceReadyAt: 10 + LETHAL_GRACE.cooldown });
    // Again too soon: dead.
    expect(harmWizard(80, 100, 500, 12, a.graceReadyAt).health).toBeLessThanOrEqual(0);
    // From low health there's no grace.
    expect(harmWizard(30, 100, 500, 100, 0)).toMatchObject({ brink: false });
    expect(harmWizard(30, 100, 500, 100, 0).health).toBeLessThanOrEqual(0);
  });
});
