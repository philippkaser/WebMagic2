import { describe, expect, test } from "bun:test";
import { steer, STEER } from "./steering";

const O = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

describe("steer — linear", () => {
  test("drives with target velocity plus error × gain", () => {
    const cmd = steer(O, null, { x: 0.5, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, null, STEER.gain);
    expect(cmd.kind).toBe("drive");
    if (cmd.kind !== "drive") return;
    expect(cmd.linvel.x).toBeCloseTo(2 + 0.5 * STEER.gain);
    expect(cmd.linvel.y).toBeCloseTo(0);
  });

  test("caps the correction term, not the target velocity", () => {
    const cmd = steer(O, null, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, null, STEER.gain);
    if (cmd.kind !== "drive") throw new Error("expected drive");
    // raw correction 2 × 10 = 20 → capped at maxCorrection.
    expect(cmd.linvel.x).toBeCloseTo(3 + STEER.maxCorrection);
  });

  test("a softer gain loosens the leash", () => {
    const cmd = steer(O, null, { x: 1, y: 0, z: 0 }, O, null, STEER.softGain);
    if (cmd.kind !== "drive") throw new Error("expected drive");
    expect(cmd.linvel.x).toBeCloseTo(STEER.softGain);
  });

  test("snaps past the distance budget", () => {
    const cmd = steer(O, null, { x: STEER.snapDistance + 0.1, y: 0, z: 0 }, O, null, STEER.gain);
    expect(cmd.kind).toBe("snap");
  });

  test("rests when settled at a still target", () => {
    const cmd = steer(O, null, { x: 0.01, y: 0, z: 0 }, { x: 0.01, y: 0, z: 0 }, null, STEER.gain);
    expect(cmd.kind).toBe("rest");
  });

  test("keeps driving when the target itself is moving", () => {
    const cmd = steer(O, null, O, { x: 3, y: 0, z: 0 }, null, STEER.gain);
    expect(cmd.kind).toBe("drive");
  });
});

describe("steer — angular", () => {
  // 90° about +Y.
  const quarterY = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

  test("produces angular velocity toward the target rotation", () => {
    const cmd = steer(O, IDENTITY, O, { x: 1, y: 0, z: 0 }, quarterY, STEER.gain);
    if (cmd.kind !== "drive") throw new Error("expected drive");
    expect(cmd.angvel).not.toBeNull();
    // axis +Y, angle π/2, scaled by rotGain.
    expect(cmd.angvel!.y).toBeCloseTo((Math.PI / 2) * STEER.rotGain, 1);
    expect(cmd.angvel!.x).toBeCloseTo(0);
  });

  test("aligned rotations produce no angular velocity", () => {
    const cmd = steer(O, quarterY, O, { x: 1, y: 0, z: 0 }, quarterY, STEER.gain);
    if (cmd.kind !== "drive") throw new Error("expected drive");
    expect(Math.hypot(cmd.angvel!.x, cmd.angvel!.y, cmd.angvel!.z)).toBeCloseTo(0);
  });

  test("snaps past the rotation budget", () => {
    // ~180° about Y — far beyond snapAngle.
    const flipped = { x: 0, y: 1, z: 0, w: 0.0001 };
    const cmd = steer(O, IDENTITY, O, O, flipped, STEER.gain);
    expect(cmd.kind).toBe("snap");
  });

  test("sign-flipped but identical rotation counts as aligned (rest)", () => {
    const negated = { x: -0, y: -Math.SQRT1_2, z: -0, w: -Math.SQRT1_2 };
    const cmd = steer(O, quarterY, O, O, negated, STEER.gain);
    expect(cmd.kind).toBe("rest");
  });
});
