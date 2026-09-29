import { describe, expect, test } from "bun:test";
import { aimDir } from "./common";
import {
  createSentryBrain,
  createSentryTick,
  SENTRY,
  sentryCooldown,
  sentryLead,
  sentryYaw,
  tickSentry,
} from "./sentry";

const HEAD = { x: 0, y: 1.05, z: 0 };
const STILL = { x: 0, y: 0, z: 0 };

function leadAt(target: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }) {
  const dir = aimDir(HEAD, target, { x: 0, y: 0, z: 0 });
  const dist = Math.hypot(target.x - HEAD.x, target.y - HEAD.y, target.z - HEAD.z);
  return sentryLead(dir, dist, vel, { x: 0, y: 0, z: 0 });
}

describe("sentry brain", () => {
  test("first shot comes after its randomised opening delay", () => {
    const b = createSentryBrain(() => 1);
    const tick = createSentryTick();
    const opening = SENTRY.firstShotMin + SENTRY.firstShotSpread;
    tickSentry(b, opening - 0.1, 1, tick);
    expect(tick.fire).toBe(false);
    tickSentry(b, 0.11, 1, tick);
    expect(tick.fire).toBe(true);
    expect(b.fireTimer).toBe(sentryCooldown(1));
  });

  test("glows up through the wind-up window only", () => {
    const b = { fireTimer: 2 };
    const tick = createSentryTick();
    tickSentry(b, 1, 1, tick); // 1 s left
    expect(tick.charge).toBe(0);
    tickSentry(b, 0.75, 1, tick); // 0.25 s left
    expect(tick.charge).toBeCloseTo((SENTRY.chargeWindow - 0.25) * SENTRY.chargeGlow);
    tickSentry(b, 0.5, 1, tick); // overshoots: shot frame is the brightest
    expect(tick.fire).toBe(true);
    expect(tick.charge).toBeCloseTo(SENTRY.chargeWindow * SENTRY.chargeGlow);
  });

  test("reloads faster deeper down, but never below its floor", () => {
    expect(sentryCooldown(10)).toBeLessThan(sentryCooldown(1));
    expect(sentryCooldown(1000)).toBe(SENTRY.minCooldown);
  });

  test("a still target is shot straight at, at bolt speed", () => {
    const v = leadAt({ x: 0, y: 1.05, z: 10 }, STILL);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(SENTRY.boltSpeed);
  });

  test("the lead points ahead of a moving target", () => {
    // Target 10 m down +z, strafing along +x.
    const v = leadAt({ x: 0, y: 1.05, z: 10 }, { x: 6, y: 0, z: 0 });
    expect(v.x).toBeGreaterThan(0);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(SENTRY.boltSpeed);
    // Partial lead: aims at (lead·vx, 10) rather than a full intercept.
    const lead = Math.min(10 / SENTRY.boltSpeed, SENTRY.leadMaxTime) * SENTRY.leadFactor;
    expect(v.x / v.z).toBeCloseTo((6 * lead) / 10);
  });

  test("the lead is capped for distant targets", () => {
    const far = 40;
    const v = leadAt({ x: 0, y: 1.05, z: far }, { x: 6, y: 0, z: 0 });
    const capped = SENTRY.leadMaxTime * SENTRY.leadFactor;
    expect(v.x / v.z).toBeCloseTo((6 * capped) / far);
  });

  test("the head eases toward the player and ignores far ones", () => {
    const yaw = sentryYaw(0, HEAD, { x: 5, y: 1, z: 0 }, 1 / 60);
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThan(Math.PI / 2);
    expect(sentryYaw(0, HEAD, { x: 5, y: 1, z: 0 }, 1)).toBeCloseTo(Math.PI / 2);
    expect(sentryYaw(0.3, HEAD, { x: 50, y: 1, z: 0 }, 1)).toBe(0.3);
  });

  test("the head turns the short way across the ±π seam", () => {
    // Facing just shy of +π (behind, slightly right); the player steps to
    // just past −π (behind, slightly left) — a tiny turn, not a full circle.
    const facing = Math.PI - 0.05;
    const player = { x: -Math.sin(0.05), y: 1.05, z: -Math.cos(0.05) }; // atan2 ≈ −π + 0.05
    const yaw = sentryYaw(facing, HEAD, player, 1);
    expect(Math.abs(Math.sin(yaw) - Math.sin(Math.PI + 0.05))).toBeLessThan(1e-9);
    expect(Math.abs(Math.cos(yaw) - Math.cos(Math.PI + 0.05))).toBeLessThan(1e-9);
    // Halfway there after half the easing: still behind, never swung forward.
    const half = sentryYaw(facing, HEAD, player, 0.5 / SENTRY.turnRate);
    expect(Math.cos(half)).toBeLessThan(-0.99);
  });
});
