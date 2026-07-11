import { describe, expect, test } from "bun:test";
import {
  makeSampledPose,
  MAX_EXTRAPOLATION_MS,
  shortestArc,
  SnapshotBuffer,
} from "./snapshots";

describe("SnapshotBuffer", () => {
  test("returns false while empty", () => {
    const buf = new SnapshotBuffer();
    expect(buf.sample(1000, makeSampledPose())).toBe(false);
  });

  test("lerps position between two snapshots", () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 1000, p: [0, 0, 0] });
    buf.push({ t: 1100, p: [10, 0, 0] });
    const out = makeSampledPose();
    expect(buf.sample(1050, out)).toBe(true);
    expect(out.p[0]).toBeCloseTo(5);
  });

  test("hermite respects velocities (curved path ≠ straight lerp)", () => {
    const buf = new SnapshotBuffer();
    // Moving +x at both ends but with vertical velocity at the start: the
    // midpoint must lie above the straight line.
    buf.push({ t: 0, p: [0, 0, 0], v: [10, 5, 0] });
    buf.push({ t: 100, p: [1, 0, 0], v: [10, -5, 0] });
    const out = makeSampledPose();
    buf.sample(50, out);
    expect(out.p[1]).toBeGreaterThan(0.05);
  });

  test("extrapolates past the newest snapshot, capped", () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 1000, p: [0, 0, 0], v: [10, 0, 0] });
    const out = makeSampledPose();
    buf.sample(1100, out); // +100 ms → +1 unit
    expect(out.p[0]).toBeCloseTo(1);
    buf.sample(1000 + MAX_EXTRAPOLATION_MS + 5000, out); // way past → capped
    expect(out.p[0]).toBeCloseTo((10 * MAX_EXTRAPOLATION_MS) / 1000);
  });

  test("clamps to the oldest snapshot before the buffer starts", () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 1000, p: [3, 0, 0] });
    buf.push({ t: 1100, p: [9, 0, 0] });
    const out = makeSampledPose();
    buf.sample(500, out);
    expect(out.p[0]).toBe(3);
  });

  test("late (out-of-order) packets are inserted in order", () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 1000, p: [0, 0, 0] });
    buf.push({ t: 1200, p: [20, 0, 0] });
    buf.push({ t: 1100, p: [10, 0, 0] }); // late arrival
    const out = makeSampledPose();
    buf.sample(1150, out);
    expect(out.p[0]).toBeCloseTo(15);
  });

  test("angles interpolate along the shortest arc across ±π", () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 0, p: [0, 0, 0], a: [Math.PI - 0.1] });
    buf.push({ t: 100, p: [0, 0, 0], a: [-Math.PI + 0.1] });
    const out = makeSampledPose();
    buf.sample(50, out);
    // Midpoint should be ±π, NOT 0 (the long way).
    expect(Math.abs(Math.abs(out.a![0]) - Math.PI)).toBeLessThan(0.01);
  });

  test("quaternion nlerp normalizes and takes the short path", () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 0, p: [0, 0, 0], q: [0, 0, 0, 1] });
    buf.push({ t: 100, p: [0, 0, 0], q: [0, 0, 0, -1] }); // same rotation, flipped sign
    const out = makeSampledPose();
    buf.sample(50, out);
    const len = Math.hypot(out.q![0], out.q![1], out.q![2], out.q![3]);
    expect(len).toBeCloseTo(1);
    expect(Math.abs(out.q![3])).toBeCloseTo(1); // did not pass through zero
  });

  test("caps stored snapshots", () => {
    const buf = new SnapshotBuffer();
    for (let i = 0; i < 100; i++) buf.push({ t: i * 10, p: [i, 0, 0] });
    expect(buf.size).toBeLessThanOrEqual(32);
    expect(buf.latest()!.p[0]).toBe(99);
  });
});

describe("shortestArc", () => {
  test("wraps deltas into [-π, π]", () => {
    expect(shortestArc(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5);
    expect(shortestArc(-Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5);
    expect(shortestArc(0.3)).toBeCloseTo(0.3);
  });
});
