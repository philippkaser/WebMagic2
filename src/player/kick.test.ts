import { describe, expect, test } from "bun:test";
import { Euler, Quaternion, Vector3 } from "three";
import { createKick, KICK_LIMIT, kickCamera, laidPitch, stepKick } from "./kick";

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

const DEG = Math.PI / 180;
const SIDE = new Vector3(1, 0, 0);

/** The eye looking `pitch`° up, turned somewhere, as pointer-lock leaves it. */
function eyeAt(pitch: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(pitch * DEG, 0.7, 0, "YXZ"));
}

/** How far up the eye looks (radians), as CameraKick reads it. */
function pitchOf(q: Quaternion): number {
  return Math.asin(Math.max(-1, Math.min(1, new Vector3(0, 0, -1).applyQuaternion(q).y)));
}

/** Pointer-lock's mouse-look (three-stdlib PointerLockControls): read the
 * eye back as yaw/pitch/roll, nudge the pitch, clamp it, write it back. */
function look(q: Quaternion, pitch: number): Euler {
  const e = new Euler(0, 0, 0, "YXZ").setFromQuaternion(q);
  e.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.x + pitch * DEG));
  q.setFromEuler(e);
  return e;
}

describe("the kick at the top of the look", () => {
  test("a level eye takes the whole kick", () => {
    expect(laidPitch(1.6, 0)).toBe(1.6);
    expect(laidPitch(-0.2, 0)).toBe(-0.2);
  });

  test("near straight up it takes only what's left to the top", () => {
    expect(laidPitch(0.4, 89.8 * DEG)).toBeCloseTo(0.2, 6);
    expect(laidPitch(0.4, 90 * DEG)).toBeCloseTo(0, 6);
    // The spring's soft overshoot still dips the view down from the pole.
    expect(laidPitch(-0.1, 90 * DEG)).toBe(-0.1);
    // Straight down, it can't pass under either.
    expect(laidPitch(-0.3, -90 * DEG)).toBeCloseTo(0, 6);
  });

  test("an eye pinned straight up, kicked as a mouse-look lands, comes back upright", () => {
    // The look all the way up, a bolt's 0.4° kick laid on, the mouse moved
    // down a degree while it's on, then the kick taken off.
    const run = (lay: (pitch: number, eye: number) => number) => {
      const q = eyeAt(90);
      const pitch = lay(0.4, pitchOf(q));
      q.multiply(new Quaternion().setFromAxisAngle(SIDE, pitch * DEG));
      look(q, -1);
      q.multiply(new Quaternion().setFromAxisAngle(SIDE, -pitch * DEG));
      return { up: new Vector3(0, 1, 0).applyQuaternion(q).y, roll: look(q, 0).z };
    };
    const kept = run(laidPitch);
    expect(kept.up).toBeGreaterThan(0.01);
    expect(Math.abs(kept.roll)).toBeLessThan(1e-6);
    // Laid whole, the kick carries the eye over the top: rolled onto its back.
    const over = run((pitch) => pitch);
    expect(over.up).toBeLessThan(0);
    expect(Math.abs(over.roll)).toBeCloseTo(Math.PI, 3);
  });
});
