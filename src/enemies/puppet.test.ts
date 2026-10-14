import { describe, expect, test } from "bun:test";
import {
  clearTargets,
  createPose,
  createPuppet,
  emerge,
  faceToward,
  kickHit,
  leanToward,
  OX,
  PUPPET,
  puppetPose,
  RX,
  RZ,
  SC,
  settled,
  stepPuppet,
} from "./puppet";

const run = (p: ReturnType<typeof createPuppet>, seconds: number, dt = 1 / 60, each?: () => void) => {
  for (let t = 0; t < seconds; t += dt) {
    stepPuppet(p, dt);
    each?.();
  }
};

describe("the puppet", () => {
  test("a blow along +x tips it toward +x, overshoots once, and settles within half a second", () => {
    const p = createPuppet(PUPPET.wisp);
    kickHit(p, 1, 0, 1);
    let min = 0;
    let max = 0;
    let crossings = 0;
    let prev = 0;
    run(p, 0.5, 1 / 60, () => {
      const rz = p.x[RZ];
      min = Math.min(min, rz);
      max = Math.max(max, rz);
      if (prev < 0 && rz >= 0) crossings++;
      prev = rz;
    });
    expect(min).toBeLessThan(-0.1); // tipped toward the push (negative about z)
    expect(max).toBeGreaterThan(0); // the wobble back
    expect(max).toBeLessThan(-min); // …smaller than the snap
    expect(crossings).toBeGreaterThanOrEqual(1);
    expect(p.x[OX]).toBeLessThan(0.02);
    run(p, 0.3);
    expect(settled(p, 0.02)).toBe(true);
  });

  test("leans away from the impulse along z too", () => {
    const p = createPuppet(PUPPET.shadow);
    kickHit(p, 0, 1, 1);
    stepPuppet(p, 1 / 30);
    expect(p.x[RX]).toBeGreaterThan(0);
    expect(Math.abs(p.x[RZ])).toBeLessThan(1e-9);
  });

  test("squash preserves volume", () => {
    const p = createPuppet(PUPPET.slime);
    const pose = createPose();
    kickHit(p, 0, 1, 1);
    for (let i = 0; i < 30; i++) {
      stepPuppet(p, 1 / 60);
      puppetPose(p, pose, 0);
      expect(pose.sx * pose.sy * pose.sz).toBeCloseTo(1, 6);
    }
  });

  test("never NaN at dt 0 or a 20 Hz frame, whatever the kicks", () => {
    for (const tune of Object.values(PUPPET)) {
      const p = createPuppet(tune);
      const pose = createPose();
      for (let i = 0; i < 40; i++) {
        kickHit(p, Math.cos(i), Math.sin(i), 1);
        stepPuppet(p, 0);
        stepPuppet(p, 0.05);
        stepPuppet(p, 2); // a hitch
        puppetPose(p, pose);
        for (const v of Object.values(pose)) expect(Number.isFinite(v)).toBe(true);
        expect(pose.sy).toBeGreaterThan(0);
      }
    }
  });

  test("turns the short way round and stays within ±π", () => {
    const p = createPuppet(PUPPET.wisp);
    p.yaw = 3;
    faceToward(p, 0, 0, -0.1, -1); // just past the seam
    stepPuppet(p, 1 / 60);
    expect(p.yaw).toBeGreaterThan(3); // across the seam, not all the way back
    for (let i = 0; i < 600; i++) {
      faceToward(p, 0, 0, Math.cos(i * 0.37), Math.sin(i * 0.37));
      stepPuppet(p, 1 / 30);
      expect(Math.abs(p.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  test("targets pull it: a wind-up leans it back from its prey", () => {
    const p = createPuppet(PUPPET.shadow);
    run(p, 1, 1 / 60, () => {
      clearTargets(p);
      leanToward(p, 1, 0, -0.3);
    });
    expect(p.x[RZ]).toBeCloseTo(0.3, 2); // top tipped toward −x: away from +x
  });

  test("emerges from small through an overshoot to full size", () => {
    const p = createPuppet(PUPPET.slime);
    emerge(p, 0.15);
    expect(1 + p.x[SC]).toBeCloseTo(0.15, 6);
    let peak = 0;
    run(p, 2, 1 / 60, () => (peak = Math.max(peak, 1 + p.x[SC])));
    expect(peak).toBeGreaterThan(1.05);
    expect(1 + p.x[SC]).toBeCloseTo(1, 1);
  });
});
