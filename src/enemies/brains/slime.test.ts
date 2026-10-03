import { describe, expect, test } from "bun:test";
import { createChaseInput, createSteering, type ChaseInput } from "./common";
import {
  createSlimeBrain,
  SLIME,
  SLIME_GENERATIONS,
  SLIME_MAX_GEN,
  slimeGeneration,
  slimeSpeed,
  slimeSquash,
  tickSlime,
} from "./slime";

function sense(overrides: Partial<ChaseInput> = {}): ChaseInput {
  return Object.assign(createChaseInput(), {
    pos: { x: 0, y: 0.5, z: 0 },
    target: { x: 0, y: 1, z: 6 },
    targetDist: 6,
    dt: 1 / 60,
    aggro: true,
    ...overrides,
  });
}

describe("slime brain", () => {
  test("generations get smaller and faster, and clamp at the last split", () => {
    for (let g = 1; g <= SLIME_MAX_GEN; g++) {
      expect(SLIME_GENERATIONS[g].size).toBeLessThan(SLIME_GENERATIONS[g - 1].size);
      expect(SLIME_GENERATIONS[g].speed).toBeGreaterThan(SLIME_GENERATIONS[g - 1].speed);
    }
    expect(slimeGeneration(99)).toBe(SLIME_GENERATIONS[SLIME_MAX_GEN]);
    expect(slimeGeneration(-1)).toBe(SLIME_GENERATIONS[0]);
  });

  test("sits still (hands off the body) until aggro", () => {
    const b = createSlimeBrain(0, () => 0);
    const asleep = tickSlime(b, sense({ aggro: false, targetDist: 30 }), createSteering());
    expect(asleep.apply).toBe(false);
    expect(asleep.aggro).toBe(false);
    const woken = tickSlime(b, sense({ aggro: false, targetDist: 10 }), createSteering());
    expect(woken.aggro).toBe(true);
    expect(woken.apply).toBe(false); // the chase starts next frame
  });

  test("drives straight at the target at its generation's speed", () => {
    const b = createSlimeBrain(1, () => 0.5);
    b.hopTimer = 10; // no hop this frame
    const out = tickSlime(b, sense({ vel: { x: 0, y: -2, z: 0 } }), createSteering());
    expect(out.apply).toBe(true);
    expect(out.vel.x).toBeCloseTo(0);
    expect(out.vel.z).toBeCloseTo(slimeSpeed(SLIME_GENERATIONS[1], 1, 1));
    expect(out.vel.y).toBe(-2); // keeps falling — gravity owns the vertical
  });

  test("hops when the timer is up and it is grounded, then waits", () => {
    const b = createSlimeBrain(0, () => 0);
    b.hopTimer = 0;
    const out = tickSlime(b, sense(), createSteering());
    expect(out.vel.y).toBe(SLIME_GENERATIONS[0].hop);
    expect(b.hopTimer).toBeCloseTo(SLIME.hopIntervalMin);

    const next = tickSlime(b, sense({ vel: { x: 0, y: 0, z: 0 } }), createSteering());
    expect(next.vel.y).toBe(0); // reloading
  });

  test("never hops mid-air", () => {
    const b = createSlimeBrain(0, () => 0);
    b.hopTimer = 0;
    const out = tickSlime(b, sense({ vel: { x: 0, y: 3, z: 0 } }), createSteering());
    expect(out.vel.y).toBe(3);
    expect(b.hopTimer).toBeLessThan(0); // still due — fires on landing
  });

  test("knockback leaves the body alone", () => {
    const b = createSlimeBrain(0, () => 0);
    expect(tickSlime(b, sense({ knocked: true }), createSteering()).apply).toBe(false);
  });

  test("the floor's speed rule scales the hop travel, not the hop height", () => {
    const b = createSlimeBrain(0, () => 0);
    b.hopTimer = 0;
    const out = tickSlime(b, sense({ speedMult: 2 }), createSteering());
    expect(out.vel.z).toBeCloseTo(slimeSpeed(SLIME_GENERATIONS[0], 1, 1) * 2);
    expect(out.vel.y).toBe(SLIME_GENERATIONS[0].hop);
  });

  test("squash stretches rising, squashes falling, within limits", () => {
    expect(slimeSquash(0)).toBe(1);
    expect(slimeSquash(5)).toBeGreaterThan(1);
    expect(slimeSquash(-5)).toBeLessThan(1);
    expect(slimeSquash(100)).toBe(SLIME.squashMax);
    expect(slimeSquash(-100)).toBe(SLIME.squashMin);
  });
});
