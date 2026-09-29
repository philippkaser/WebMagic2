import { describe, expect, test } from "bun:test";
import { createChaseInput, createSteering, type ChaseInput } from "./common";
import { tickWisp, WISP, wispSpeed } from "./wisp";

/** Long enough that the velocity easing fully converges — isolates the
 * desired-velocity math from the blend. */
const SETTLED_DT = 10;

function sense(overrides: Partial<ChaseInput> = {}): ChaseInput {
  return Object.assign(createChaseInput(), {
    pos: { x: 0, y: 1.6, z: 0 },
    target: { x: 10, y: 1.1, z: 0 },
    targetDist: 10,
    dt: 1 / 60,
    ...overrides,
  });
}

describe("wisp brain", () => {
  test("stays idle — bobbing in place — until aggro", () => {
    const out = tickWisp(0, sense({ targetDist: 40, time: 0.5 }), createSteering());
    expect(out.aggro).toBe(false);
    expect(out.apply).toBe(true);
    expect(out.vel.x).toBe(0);
    expect(out.vel.z).toBe(0);
    expect(out.vel.y).toBeCloseTo(Math.sin(0.5 * WISP.idleBobFreq) * WISP.idleBobAmp);
  });

  test("wakes inside its radius, but spends the waking frame idle", () => {
    const out = tickWisp(0, sense({ targetDist: 14 }), createSteering());
    expect(out.aggro).toBe(true);
    expect(out.vel.x).toBe(0);
    expect(out.vel.z).toBe(0);
  });

  test("stealth shrinks the wake radius", () => {
    const out = tickWisp(0, sense({ targetDist: 10, aggroMult: 0.5 }), createSteering());
    expect(out.aggro).toBe(false);
  });

  test("once awake it chases the target at full speed after easing in", () => {
    const i = sense({ aggro: true, dt: SETTLED_DT, target: { x: 0, y: 1.6, z: -8 } });
    const out = tickWisp(0, i, createSteering());
    expect(out.aggro).toBe(true);
    expect(out.apply).toBe(true);
    expect(out.vel.x).toBeCloseTo(0);
    expect(out.vel.z).toBeCloseTo(-wispSpeed(1, 1));
  });

  test("eases toward the desired velocity rather than snapping", () => {
    const i = sense({ aggro: true, vel: { x: 0, y: 0, z: 0 } });
    const out = tickWisp(0, i, createSteering());
    expect(out.vel.x).toBeGreaterThan(0);
    expect(out.vel.x).toBeLessThan(wispSpeed(1, 1) * 0.1);
  });

  test("speed grows with depth and with the floor's speed rule", () => {
    expect(wispSpeed(10, 1)).toBeGreaterThan(wispSpeed(1, 1));
    expect(wispSpeed(1, 1.5)).toBeCloseTo(wispSpeed(1, 1) * 1.5);
    const out = tickWisp(0, sense({ aggro: true, dt: SETTLED_DT, speedMult: 2 }), createSteering());
    expect(out.vel.x).toBeCloseTo(wispSpeed(1, 2));
  });

  test("vertical correction is capped", () => {
    const i = sense({ aggro: true, dt: SETTLED_DT, target: { x: 10, y: 50, z: 0 } });
    expect(tickWisp(0, i, createSteering()).vel.y).toBeCloseTo(WISP.maxClimb);
  });

  test("leaves the body alone while knocked back", () => {
    const out = tickWisp(0, sense({ aggro: true, knocked: true }), createSteering());
    expect(out.apply).toBe(false);
    expect(out.aggro).toBe(true);
  });
});
