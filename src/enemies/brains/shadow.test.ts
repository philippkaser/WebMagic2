import { describe, expect, test } from "bun:test";
import { createChaseInput, createSteering, type ChaseInput } from "./common";
import { createShadowBrain, lungeSpeed, SHADOW, stalkSpeed, tickShadow } from "./shadow";

const SETTLED_DT = 10;

/** A scripted dice sequence (cycled). */
function dice(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Awake shadow at the origin, target straight down +x at `dist`. */
function sense(dist: number, overrides: Partial<ChaseInput> = {}): ChaseInput {
  return Object.assign(createChaseInput(), {
    pos: { x: 0, y: 1, z: 0 },
    target: { x: dist, y: 0.7, z: 0 },
    targetDist: dist,
    dt: 1 / 60,
    aggro: true,
    ...overrides,
  });
}

/** Run the brain for `seconds` in fixed steps. */
function run(b: ReturnType<typeof createShadowBrain>, i: ChaseInput, seconds: number) {
  const out = createSteering();
  for (let t = 0; t < seconds; t += i.dt) tickShadow(b, i, out);
  return out;
}

describe("shadow brain", () => {
  test("starts stalking with a patience timer from its dice", () => {
    const b = createShadowBrain(dice(0.5));
    expect(b.mode).toBe("stalk");
    expect(b.lungeTimer).toBeCloseTo(SHADOW.patienceMin + 0.5 * SHADOW.patienceSpread);
  });

  test("idles (and runs no timers) until aggro", () => {
    const b = createShadowBrain(dice(0));
    const out = tickShadow(b, sense(40, { aggro: false }), createSteering());
    expect(out.aggro).toBe(false);
    expect(out.vel.x).toBe(0);
    expect(out.vel.z).toBe(0);
    expect(b.lungeTimer).toBe(SHADOW.patienceMin);
  });

  test("does not lunge before its timer runs out, even point-blank", () => {
    const b = createShadowBrain(dice(0)); // patience = 2 s
    run(b, sense(4), 1.9);
    expect(b.mode).toBe("stalk");
  });

  test("lunges only within range once its timer has run out", () => {
    const far = createShadowBrain(dice(0));
    run(far, sense(SHADOW.lungeRange + 2), 3);
    expect(far.mode).toBe("stalk"); // patience spent, but too far to strike

    const near = createShadowBrain(dice(0));
    run(near, sense(SHADOW.lungeRange - 2), 2.05);
    expect(near.mode).toBe("lunge");
  });

  test("lunge → recoil → stalk, re-rolling its patience", () => {
    const b = createShadowBrain(dice(0));
    b.lungeTimer = 0;
    const i = sense(5);
    const out = createSteering();
    tickShadow(b, i, out);
    expect(b.mode).toBe("lunge");

    run(b, i, SHADOW.lungeTime + 0.02);
    expect(b.mode).toBe("recoil");

    // Step to the exact frame the recoil ends, so no stalk time elapses.
    b.rand = dice(1);
    let frames = 0;
    while (b.mode === "recoil" && frames++ < 1000) tickShadow(b, i, out);
    expect(frames * i.dt).toBeCloseTo(SHADOW.recoilTime, 1);
    expect(b.mode).toBe("stalk");
    expect(b.lungeTimer).toBeCloseTo(SHADOW.patienceMin + SHADOW.patienceSpread);
  });

  test("lunges straight at the target and recoils straight away", () => {
    const b = createShadowBrain(dice(0));
    b.mode = "lunge";
    b.modeTimer = 100;
    const lunge = tickShadow(b, sense(5, { dt: SETTLED_DT }), createSteering());
    expect(lunge.vel.x).toBeCloseTo(lungeSpeed(1, 1));
    expect(lunge.vel.z).toBeCloseTo(0);

    b.mode = "recoil";
    b.modeTimer = 100;
    const recoil = tickShadow(b, sense(5, { dt: SETTLED_DT }), createSteering());
    expect(recoil.vel.x).toBeCloseTo(-SHADOW.recoilSpeed);
    expect(recoil.vel.y).toBeCloseTo(0);
  });

  test("stalks tangentially on the lurk ring, inward from outside it", () => {
    const b = createShadowBrain(dice(0)); // dice 0 → spin +1
    b.lungeTimer = 1e9;
    const onRing = tickShadow(b, sense(SHADOW.lurkRadius, { dt: SETTLED_DT }), createSteering());
    expect(onRing.vel.x).toBeCloseTo(0); // no radial pull on the ring
    expect(Math.abs(onRing.vel.z)).toBeCloseTo(stalkSpeed(1, 1));

    const outside = tickShadow(b, sense(SHADOW.lurkRadius + 5, { dt: SETTLED_DT }), createSteering());
    expect(outside.vel.x).toBeGreaterThan(0); // closing in
  });

  test("orbit direction follows its spin", () => {
    const cw = createShadowBrain(dice(0));
    const ccw = createShadowBrain(dice(0.9));
    cw.lungeTimer = ccw.lungeTimer = 1e9;
    const a = tickShadow(cw, sense(SHADOW.lurkRadius, { dt: SETTLED_DT }), createSteering());
    const b = tickShadow(ccw, sense(SHADOW.lurkRadius, { dt: SETTLED_DT }), createSteering());
    expect(Math.sign(a.vel.z)).toBe(-Math.sign(b.vel.z));
  });

  test("knockback freezes the state machine", () => {
    const b = createShadowBrain(dice(0));
    const out = run(b, sense(4, { knocked: true }), 5);
    expect(out.apply).toBe(false);
    expect(b.mode).toBe("stalk");
    expect(b.lungeTimer).toBe(SHADOW.patienceMin);
  });

  test("the floor's speed rule scales stalk, lunge and recoil", () => {
    expect(stalkSpeed(1, 2)).toBeCloseTo(stalkSpeed(1, 1) * 2);
    expect(lungeSpeed(1, 2)).toBeCloseTo(lungeSpeed(1, 1) * 2);
    const b = createShadowBrain(dice(0));
    b.mode = "recoil";
    b.modeTimer = 100;
    const out = tickShadow(b, sense(5, { dt: SETTLED_DT, speedMult: 2 }), createSteering());
    expect(out.vel.x).toBeCloseTo(-SHADOW.recoilSpeed * 2);
  });
});
