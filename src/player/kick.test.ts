import { describe, expect, test } from "bun:test";
import { createKick, KICK_LIMIT, kickCamera, stepKick } from "./kick";

function run(pitch: number, seconds: number, dt = 1 / 60) {
  const k = createKick();
  kickCamera(k, pitch, pitch * 0.3, 0.04);
  let peak = 0;
  let peakAt = 0;
  for (let t = 0; t < seconds; t += dt) {
    stepKick(k, dt);
    if (k.pitch > peak) {
      peak = k.pitch;
      peakAt = t;
    }
  }
  return { k, peak, peakAt };
}

describe("the eye's recoil", () => {
  test("a kick peaks at what was asked, quickly", () => {
    const { peak, peakAt } = run(1.6, 0.5, 1 / 240);
    expect(peak).toBeGreaterThan(1.6 * 0.95);
    expect(peak).toBeLessThan(1.6 * 1.05);
    expect(peakAt).toBeLessThan(0.06);
  });

  test("it springs back to exactly rest", () => {
    const { k } = run(1.6, 1);
    expect(k.pitch).toBe(0);
    expect(k.yaw).toBe(0);
    expect(k.fov).toBe(0);
  });

  test("the same at any frame rate", () => {
    const fast = run(1, 0.5, 1 / 240).peak;
    const slow = run(1, 0.5, 1 / 30);
    expect(Math.abs(slow.peak - fast)).toBeLessThan(0.15);
    expect(slow.k.pitch).toBe(0);
  });

  test("a hitch can't throw the eye past its limit", () => {
    const k = createKick();
    for (let i = 0; i < 20; i++) kickCamera(k, 2, 2, 0.05);
    for (let i = 0; i < 30; i++) {
      stepKick(k, 1 / 60);
      expect(Math.abs(k.pitch)).toBeLessThanOrEqual(KICK_LIMIT.pitch);
      expect(Math.abs(k.yaw)).toBeLessThanOrEqual(KICK_LIMIT.yaw);
      expect(Math.abs(k.fov)).toBeLessThanOrEqual(KICK_LIMIT.fov);
    }
  });
});
