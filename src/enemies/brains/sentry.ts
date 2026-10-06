import { wrapAngle, type RandomSource, type Vec } from "./common";

/** Sentry brain — the turret. It never moves, so its brain is a reload clock
 * plus aiming math: glow brighter through a short wind-up, then (if a wizard
 * is in range and in sight — the line-of-sight raycast is its controller's,
 * sim/enemies/controllers.ts, it needs the physics world) loose a slow bolt
 * that LEADS the target.
 *
 * The lead is deliberately partial: a perfect intercept would make bolts
 * undodgeable, so the sentry aims only part-way along the target's motion,
 * and never further ahead than a capped flight time. Strafing still works;
 * running in a straight line doesn't. */

export const SENTRY = {
  /** Height of the crystal head above the body origin. */
  headHeight: 1.05,
  /** Won't fire at wizards beyond this. */
  range: 26,
  /** Cosmetic head tracking range, and its turn rate (1/s). */
  trackRange: 30,
  turnRate: 4,
  boltSpeed: 15,
  /** Lead = target velocity × min(flight time, leadMaxTime) × leadFactor. */
  leadMaxTime: 1.2,
  leadFactor: 0.45,
  /** Wind-up window before each shot, and the glow it adds per second of it. */
  chargeWindow: 0.55,
  chargeGlow: 7,
  /** First shot after min + random·spread seconds. */
  firstShotMin: 2,
  firstShotSpread: 1.5,
  /** Reload: shrinks per floor, down to a floor of minCooldown. */
  cooldown: 2.5,
  cooldownPerFloor: 0.04,
  minCooldown: 1.4,
  /** Bolt spawns this fraction of a second of flight out of the head. */
  muzzleLead: 0.06,
} as const;

export interface SentryBrain {
  /** Seconds until the next shot is due. */
  fireTimer: number;
}

export interface SentryTick {
  /** A shot is due this frame (the reload has already been reset). */
  fire: boolean;
  /** Extra emissive intensity from the wind-up glow (0 outside it). */
  charge: number;
}

export function createSentryBrain(rand: RandomSource = Math.random): SentryBrain {
  return { fireTimer: SENTRY.firstShotMin + rand() * SENTRY.firstShotSpread };
}

export function createSentryTick(): SentryTick {
  return { fire: false, charge: 0 };
}

export function sentryCooldown(floor: number): number {
  return Math.max(SENTRY.minCooldown, SENTRY.cooldown - floor * SENTRY.cooldownPerFloor);
}

/** Advance the reload clock. The wind-up glow is measured before the reset,
 * so the shot frame itself glows brightest. */
export function tickSentry(b: SentryBrain, dt: number, floor: number, out: SentryTick): SentryTick {
  b.fireTimer -= dt;
  out.charge =
    b.fireTimer < SENTRY.chargeWindow
      ? (SENTRY.chargeWindow - Math.max(b.fireTimer, 0)) * SENTRY.chargeGlow
      : 0;
  out.fire = b.fireTimer <= 0;
  if (out.fire) b.fireTimer = sentryCooldown(floor);
  return out;
}

/** Bolt velocity from a unit aim direction toward a target `dist` away that
 * is moving at `targetVel`: the aim point slides part-way along the target's
 * motion (see the module note), then the result is rescaled to bolt speed.
 * `out` may alias `dir`. */
export function sentryLead(dir: Vec, dist: number, targetVel: Vec, out: Vec): Vec {
  const lead = Math.min(dist / SENTRY.boltSpeed, SENTRY.leadMaxTime) * SENTRY.leadFactor;
  const x = dir.x * dist + targetVel.x * lead;
  const y = dir.y * dist + targetVel.y * lead;
  const z = dir.z * dist + targetVel.z * lead;
  const s = SENTRY.boltSpeed / (Math.hypot(x, y, z) || 1);
  out.x = x * s;
  out.y = y * s;
  out.z = z * s;
  return out;
}

/** Cosmetic head tracking: ease the yaw toward the watched player (each
 * client tracks its own), or hold still when they're out of range. Turns the
 * short way round — a player crossing behind the sentry (where atan2 jumps
 * from +π to −π) must not make the head whip through a full circle — and
 * keeps the result in [−π, π] so it never winds up. */
export function sentryYaw(yaw: number, head: Vec, player: Vec, dt: number): number {
  const ax = player.x - head.x;
  const ay = player.y - head.y;
  const az = player.z - head.z;
  if (Math.hypot(ax, ay, az) >= SENTRY.trackRange) return yaw;
  const turn = wrapAngle(Math.atan2(ax, az) - yaw);
  return wrapAngle(yaw + turn * Math.min(1, dt * SENTRY.turnRate));
}
