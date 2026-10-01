import { describe, expect, test } from "bun:test";
import { makeRig, RIG, stepRig, type RigInput } from "./rig";

const still: RigInput = { wYaw: 0, wPitch: 0, side: 0, phase: 0, amp: 0, landDip: 0 };
const run = (s = makeRig(), input: Partial<RigInput>, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) stepRig(s, { ...still, ...input }, dt);
  return s;
};

describe("HUD rig", () => {
  test("rests at the view when nothing moves", () => {
    const s = run(undefined, {}, 2);
    expect(s.outYaw).toBe(0);
    expect(s.outPitch).toBe(0);
  });

  test("a turn leaves the rig trailing behind it, softly capped", () => {
    // Turning left at 90°/s: the rig hangs to the right of the view (−yaw).
    const slow = run(undefined, { wYaw: Math.PI / 2 }, 1);
    expect(slow.outYaw).toBeLessThan(0);
    expect(Math.abs(slow.outYaw)).toBeLessThan(RIG.maxLag);
    // A violent flick still never passes the cap.
    const flick = run(undefined, { wYaw: 25 }, 1);
    expect(Math.abs(flick.outYaw)).toBeLessThanOrEqual(RIG.maxLag + 1e-9);
    expect(Math.abs(flick.outYaw)).toBeGreaterThan(Math.abs(slow.outYaw));
    // Looking up leaves it below.
    expect(run(undefined, { wPitch: 2 }, 1).outPitch).toBeLessThan(0);
  });

  test("after a turn stops it swings past rest once, then settles", () => {
    const s = run(undefined, { wYaw: 3 }, 1);
    let min = 0;
    let max = -Infinity;
    for (let t = 0; t < 2; t += 1 / 60) {
      stepRig(s, still, 1 / 60);
      min = Math.min(min, s.outYaw);
      max = Math.max(max, s.outYaw);
    }
    expect(max).toBeGreaterThan(0); // overshoot to the other side
    expect(max).toBeLessThan(RIG.maxLag * 0.5); // but only a little
    expect(Math.abs(s.outYaw)).toBeLessThan(1e-4); // and it comes to rest
  });

  test("is frame-rate independent", () => {
    const a = run(undefined, { wYaw: 4 }, 0.5, 1 / 30);
    const b = run(undefined, { wYaw: 4 }, 0.5, 1 / 144);
    expect(a.outYaw).toBeCloseTo(b.outYaw, 3);
  });

  test("walking bobs it in step; standing still doesn't", () => {
    const s = makeRig();
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) {
      stepRig(s, { ...still, phase: (i / 64) * Math.PI * 2, amp: 1 }, 1 / 60);
      seen.add(Math.sign(Math.round(s.outPitch * 1e6)));
    }
    expect(seen.has(1) && seen.has(-1)).toBe(true);
    expect(Math.abs(s.outPitch)).toBeLessThanOrEqual(RIG.bobPitch + 1e-6);
  });

  test("a landing drops it below the view", () => {
    const s = makeRig();
    stepRig(s, { ...still, landDip: 0.2 }, 1 / 60);
    expect(s.outPitch).toBeLessThan(0);
  });
});
