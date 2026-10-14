import { describe, expect, test } from "bun:test";
import { ACT, anticipate, createAct, createAnticipation, decodeAct, encodeAct, isWindup } from "./anticipation";

describe("act codes on the wire", () => {
  test("round-trip within a progress step", () => {
    const a = createAct();
    for (const code of Object.values(ACT)) {
      for (let p = 0; p <= 1; p += 0.05) {
        decodeAct(encodeAct(code, p), a);
        expect(a.code).toBe(code);
        expect(Math.abs(a.progress - p)).toBeLessThanOrEqual(1 / 30 + 1e-9);
      }
    }
  });

  test("a wind-up changes the field at most 16 times", () => {
    const seen = new Set<number>();
    for (let p = 0; p <= 1; p += 0.001) seen.add(encodeAct(ACT.coil, p));
    expect(seen.size).toBeLessThanOrEqual(16);
  });

  test("garbage reads as idle", () => {
    const a = createAct();
    for (const bad of [NaN, -1, 3.5, 1e9]) {
      decodeAct(bad, a);
      expect(a.code).toBe(ACT.idle);
    }
    expect(encodeAct(ACT.aim, NaN)).toBe(ACT.aim * 16);
  });
});

describe("anticipation poses", () => {
  test("the shadow's coil draws back and flares its eyes as it builds", () => {
    const early = anticipate("shadow", ACT.coil, 0.1, createAnticipation());
    const late = anticipate("shadow", ACT.coil, 1, createAnticipation());
    expect(late.lean).toBeLessThan(early.lean);
    expect(late.lean).toBeLessThan(0);
    expect(late.eye).toBeGreaterThan(early.eye);
    expect(late.squash).toBeLessThan(0);
  });

  test("the Warden stills its shell as it braces, and leans into the charge", () => {
    expect(anticipate("boss", ACT.brace, 1, createAnticipation()).spin).toBe(0);
    expect(anticipate("boss", ACT.charge, 0, createAnticipation()).lean).toBeGreaterThan(0);
  });

  test("the sentry's crystal swells before it fires", () => {
    expect(anticipate("sentry", ACT.aim, 1, createAnticipation()).accent).toBeCloseTo(0.2, 6);
  });

  test("idle is the rest pose", () => {
    const a = anticipate("wisp", ACT.idle, 1, createAnticipation());
    expect(a).toEqual(createAnticipation());
  });

  test("wind-ups are the beats to read", () => {
    expect(isWindup(ACT.coil)).toBe(true);
    expect(isWindup(ACT.brace)).toBe(true);
    expect(isWindup(ACT.aim)).toBe(true);
    expect(isWindup(ACT.lunge)).toBe(false);
    expect(isWindup(ACT.idle)).toBe(false);
  });
});
