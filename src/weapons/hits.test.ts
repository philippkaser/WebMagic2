import { describe, expect, test } from "bun:test";
import { hitCapForFloor, MAX_HIT_DAMAGE, MAX_HIT_IMPULSE, sanitizeHit } from "./hits";

describe("sanitizeHit", () => {
  test("a legit hit passes through unchanged (as a copy)", () => {
    const hit = { damage: 16, impulse: { x: 1, y: 2.5, z: -3 } };
    const out = sanitizeHit(hit);
    expect(out).toEqual(hit);
    expect(out).not.toBe(hit);
    expect(out!.impulse).not.toBe(hit.impulse);
  });

  test("damage is clamped to [0, MAX_HIT_DAMAGE]", () => {
    const imp = { x: 0, y: 0, z: 0 };
    expect(sanitizeHit({ damage: 1e9, impulse: imp })!.damage).toBe(MAX_HIT_DAMAGE);
    expect(sanitizeHit({ damage: -50, impulse: imp })!.damage).toBe(0);
    expect(sanitizeHit({ damage: 0, impulse: imp })!.damage).toBe(0);
  });

  test("impulse is clamped per axis, keeping its sign", () => {
    const out = sanitizeHit({ damage: 5, impulse: { x: 1e6, y: -1e6, z: 42 } })!;
    expect(out.impulse).toEqual({ x: MAX_HIT_IMPULSE, y: -MAX_HIT_IMPULSE, z: 42 });
  });

  test("extra fields are dropped", () => {
    const out = sanitizeHit({ damage: 5, impulse: { x: 0, y: 0, z: 0, w: 9 }, kill: true });
    expect(out).toEqual({ damage: 5, impulse: { x: 0, y: 0, z: 0 } });
  });

  test("malformed payloads are rejected", () => {
    const imp = { x: 0, y: 0, z: 0 };
    for (const bad of [
      null,
      undefined,
      7,
      "hit",
      [],
      {},
      { damage: 5 },
      { damage: 5, impulse: null },
      { damage: 5, impulse: "up" },
      { damage: "5", impulse: imp },
      { damage: NaN, impulse: imp },
      { damage: Infinity, impulse: imp },
      { damage: 5, impulse: { x: NaN, y: 0, z: 0 } },
      { damage: 5, impulse: { x: 0, y: -Infinity, z: 0 } },
      { damage: 5, impulse: { x: 0, y: 0 } },
      { damage: 5, impulse: { x: "1", y: 0, z: 0 } },
    ]) {
      expect(sanitizeHit(bad)).toBeNull();
    }
  });
});

describe("depth-aware hit cap", () => {
  const imp = { x: 0, y: 0, z: 0 };
  test("the cap grows with depth, since staff levels scale damage", () => {
    expect(hitCapForFloor(1)).toBeGreaterThan(100);
    expect(hitCapForFloor(40)).toBeGreaterThan(hitCapForFloor(10));
    expect(sanitizeHit({ damage: 1e9, impulse: imp }, 1)!.damage).toBe(hitCapForFloor(1));
    expect(sanitizeHit({ damage: 1e9, impulse: imp }, 50)!.damage).toBe(hitCapForFloor(50));
    expect(hitCapForFloor(100)).toBeLessThanOrEqual(MAX_HIT_DAMAGE);
  });
});
