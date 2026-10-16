import { describe, expect, test } from "bun:test";
import { POSE_LIMIT, readPose } from "./poseMessage";
import { makeSampledPose, SnapshotBuffer } from "./snapshots";

/** What publishLocalPose sends today. */
const good = () => ({
  p: [12.34, 1.5, -40.02],
  v: [3.2, 0, -1.1],
  a: [1.571, -0.2],
  staffId: "splinter_staff",
  h: 15,
});

describe("readPose", () => {
  test("a legit pose comes through unchanged, as a copy", () => {
    const raw = good();
    const pose = readPose(raw)!;
    expect(pose).toEqual({ p: [12.34, 1.5, -40.02], v: [3.2, 0, -1.1], a: [1.571, -0.2], staffId: "splinter_staff" });
    expect(pose.p).not.toBe(raw.p);
    expect(pose.a).not.toBe(raw.a);
  });

  test("older or leaner senders still get through", () => {
    // No life byte, no angles: still a wizard somewhere.
    const { p, v, staffId } = good();
    const pose = readPose({ p, v, staffId })!;
    expect(pose.p).toEqual([12.34, 1.5, -40.02]);
    expect(pose.a).toBeUndefined();
    // A staff that isn't a string isn't news — keep the one they had.
    expect(readPose({ ...good(), staffId: 7 })!.staffId).toBeNull();
    expect(readPose({ ...good(), staffId: undefined })!.staffId).toBeNull();
    // The far reaches of a legit floor are nowhere near the limit.
    expect(readPose({ ...good(), p: [-POSE_LIMIT + 1, -29, POSE_LIMIT - 1] })).not.toBeNull();
  });

  test("garbage is dropped whole", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "pose",
      42,
      [],
      { staffId: "x" }, // no p at all
      { ...good(), p: "x" },
      { ...good(), p: ["a", 0, 0] },
      { ...good(), p: [0, 0] },
      { ...good(), p: [0, 0, 0, 0] },
      { ...good(), p: [Number.NaN, 0, 0] },
      { ...good(), p: [0, Number.POSITIVE_INFINITY, 0] },
      { ...good(), p: [0, 0, POSE_LIMIT] },
      { ...good(), p: [0, 0, -1e300] },
      { ...good(), p: { 0: 1, 1: 2, 2: 3, length: 3 } },
      { ...good(), v: undefined },
      { ...good(), v: "fast" },
      { ...good(), v: [0, null, 0] },
      { ...good(), v: [1e9, 0, 0] },
      { ...good(), a: null },
      { ...good(), a: [0] },
      { ...good(), a: ["left", 0] },
      { ...good(), a: [Number.NaN, 0] },
    ];
    for (const raw of bad) expect(readPose(raw)).toBeNull();
  });

  test("what comes through samples to real numbers", () => {
    // The two ways a bad pose broke a frame: a throw on `p[0]`, or NaN out.
    const buf = new SnapshotBuffer();
    for (const raw of [good(), { staffId: "x" }, { ...good(), p: ["a", 0, 0] }, { ...good(), v: "fast" }]) {
      const pose = readPose(raw);
      if (pose) buf.push({ t: 1000, p: pose.p, v: pose.v, a: pose.a });
    }
    const out = makeSampledPose();
    expect(() => buf.sample(1100, out)).not.toThrow();
    for (const x of [...out.p, ...out.v, ...out.a!]) expect(Number.isFinite(x)).toBe(true);
  });
});
