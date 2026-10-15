import { describe, expect, test } from "bun:test";
import { CRIT } from "../weapons/precision";
import { ACT } from "./anticipation";
import { CORE, coreLinger, coreOpen, createCoreGate, opensCore, stepCore } from "./wardenCore";

/** Step the gate through `seconds` of act `code` at 60 fps from `t`; returns the end time. */
function hold(g: ReturnType<typeof createCoreGate>, code: number, t: number, seconds: number): number {
  const dt = 1 / 60;
  for (let s = 0; s < seconds; s += dt, t += dt) stepCore(g, code, t);
  return t;
}

describe("the Warden's heart", () => {
  test("is shut while it drifts, duels and charges: centre-mass fire is plain fire", () => {
    const g = createCoreGate();
    let t = hold(g, ACT.idle, 0, 3);
    expect(coreOpen(g, t)).toBe(false);
    t = hold(g, ACT.charge, t, 0.7);
    expect(coreOpen(g, t)).toBe(false);
    for (const code of [ACT.idle, ACT.coil, ACT.lunge, ACT.recoil, ACT.charge, ACT.aim, ACT.jink]) {
      expect(opensCore(code)).toBe(false);
    }
  });

  test("opens as it rises for a slam and as it braces for a charge", () => {
    for (const code of [ACT.slam, ACT.brace]) {
      const g = createCoreGate();
      const t = hold(g, ACT.idle, 0, 1);
      stepCore(g, code, t);
      expect(coreOpen(g, t)).toBe(true);
      expect(coreOpen(g, hold(g, code, t, 0.4))).toBe(true);
    }
  });

  test("stays open a breath after it lets go, then shuts", () => {
    const g = createCoreGate();
    let t = hold(g, ACT.slam, 0, 0.6);
    t = hold(g, ACT.idle, t, CORE.linger * 0.5);
    expect(coreOpen(g, t)).toBe(true);
    // Braced, then away on the charge: still open as it launches…
    const b = createCoreGate();
    let u = hold(b, ACT.brace, 0, 0.45);
    u = hold(b, ACT.charge, u, CORE.linger * 0.5);
    expect(coreOpen(b, u)).toBe(true);
    // …and shut once the linger runs out.
    expect(coreOpen(g, t + CORE.linger)).toBe(false);
    expect(coreOpen(b, u + CORE.linger)).toBe(false);
  });

  test("the linger's heat bleeds out 1 → 0 as the shell closes", () => {
    const g = createCoreGate();
    expect(coreLinger(g, 0)).toBe(0);
    const t = hold(g, ACT.brace, 0, 0.45);
    const end = t - 1 / 60; // the last frame it braced
    expect(coreLinger(g, end)).toBeCloseTo(1, 9);
    expect(coreLinger(g, end + CORE.linger * 0.5)).toBeCloseTo(0.5, 9);
    expect(coreLinger(g, end + CORE.linger)).toBe(0);
    expect(coreLinger(g, end + 10)).toBe(0);
  });

  test("its crit is the most any weak point may give — and only behind the gate", () => {
    expect(CORE.mult).toBe(CRIT.maxMult);
  });
});
