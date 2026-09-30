/** The physics behind the HUD's liquids and bars — pure, frame-rate
 * independent, allocation-free (state objects are mutated in place so the
 * per-frame path never creates garbage), and unit-tested.
 *
 *  - Gauge: a displayed level chasing its true value, plus a "ghost" that
 *    lingers where the level was before a loss and then drains after it.
 *    That lingering sliver is what makes a hit READ: you see how much you
 *    just lost boil away instead of the level simply being lower.
 *  - Slosh: a damped spring for the tilt of a liquid's surface, pushed by the
 *    carrier's motion (turning, running, jumping, getting hit). */

export interface Gauge {
  /** Displayed level, 0..1. */
  level: number;
  /** Trailing level after a loss (≥ level), 0..1. */
  ghost: number;
  /** Seconds the ghost still holds before it starts to drain. */
  hold: number;
}

export function makeGauge(level = 1): Gauge {
  return { level, ghost: level, hold: 0 };
}

export const GAUGE = {
  /** How fast the level follows its target, 1/s (exponential). */
  follow: 14,
  /** Filling is slower: liquid pours in, it doesn't teleport. */
  fill: 5,
  /** How long the ghost of a loss lingers before draining, s. */
  hold: 0.45,
  /** Ghost drain speed once it lets go, level/s. */
  drain: 0.55,
  /** A loss smaller than this doesn't re-arm the ghost's hold (mana ticks). */
  minLoss: 0.012,
} as const;

/** Advance a gauge toward `target` (0..1) by `dt` seconds. */
export function stepGauge(g: Gauge, target: number, dt: number): void {
  const t = Math.min(1, Math.max(0, target));
  const step = Math.max(0, Math.min(dt, 0.25));
  if (t < g.level - GAUGE.minLoss) {
    // A real loss. A fresh ghost holds fully; a loss landing on a ghost that
    // is already there only keeps it from draining away mid-drop.
    const fresh = g.ghost <= g.level + 1e-4;
    g.hold = fresh ? GAUGE.hold : Math.max(g.hold, GAUGE.hold * 0.6);
  }
  // The ghost starts where the level stood before this frame's drop.
  if (g.ghost < g.level) g.ghost = g.level;
  const rate = t > g.level ? GAUGE.fill : GAUGE.follow;
  g.level += (t - g.level) * (1 - Math.exp(-rate * step));
  if (Math.abs(t - g.level) < 1e-4) g.level = t;
  if (g.hold > 0) g.hold = Math.max(0, g.hold - step);
  else g.ghost = Math.max(g.level, g.ghost - GAUGE.drain * step);
  if (g.ghost < g.level) g.ghost = g.level;
}

/** Jump straight to a value (a new floor, a respawn): no ghost, no pour. */
export function resetGauge(g: Gauge, level: number): void {
  g.level = g.ghost = Math.min(1, Math.max(0, level));
  g.hold = 0;
}

export interface Slosh {
  /** Surface slope along x and z (object space, rise per unit). */
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Ripple amplitude, decays on its own. */
  wave: number;
}

export function makeSlosh(): Slosh {
  return { x: 0, z: 0, vx: 0, vz: 0, wave: 0 };
}

export const SLOSH = {
  /** Natural frequency, rad/s (~1.4 Hz: a small flask). */
  omega: 8.8,
  /** Damping ratio: well under 1 so it rocks a few times before settling. */
  zeta: 0.14,
  /** Steepest the surface may lean. */
  max: 0.6,
  /** Ripple decay, 1/s. */
  waveDecay: 1.8,
} as const;

/** Advance the spring by `dt` under a steady push (fx, fz) — accelerations
 * in slope units/s². Sub-stepped so a long frame can't blow it up. */
export function stepSlosh(s: Slosh, fx: number, fz: number, dt: number): void {
  let remaining = Math.max(0, Math.min(dt, 0.25));
  const w2 = SLOSH.omega * SLOSH.omega;
  const c = 2 * SLOSH.zeta * SLOSH.omega;
  while (remaining > 1e-6) {
    const h = Math.min(remaining, 1 / 120);
    remaining -= h;
    // Semi-implicit Euler: stable for a damped oscillator at this step size.
    s.vx += (fx - w2 * s.x - c * s.vx) * h;
    s.vz += (fz - w2 * s.z - c * s.vz) * h;
    s.x += s.vx * h;
    s.z += s.vz * h;
  }
  if (Math.abs(s.x) > SLOSH.max) {
    s.x = Math.sign(s.x) * SLOSH.max;
    s.vx *= -0.3;
  }
  if (Math.abs(s.z) > SLOSH.max) {
    s.z = Math.sign(s.z) * SLOSH.max;
    s.vz *= -0.3;
  }
  s.wave *= Math.exp(-SLOSH.waveDecay * Math.max(0, dt));
}

/** An instantaneous shove (a hit, a landing): velocity kick + ripples. */
export function kickSlosh(s: Slosh, ix: number, iz: number, wave: number): void {
  s.vx += ix;
  s.vz += iz;
  s.wave = Math.min(1, s.wave + wave);
}

/** Liquid height in the flask's object space for a fill level 0..1. The
 * bulb is a unit sphere; `bottom`/`top` keep an empty flask truly empty and
 * a full one just under the neck. */
export function levelToHeight(level: number, bottom = -0.92, top = 0.84): number {
  const l = Math.min(1, Math.max(0, level));
  return l <= 0 ? bottom - 0.05 : bottom + (top - bottom) * l;
}
