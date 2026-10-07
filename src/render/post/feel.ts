/** What the body feels, pushed into the image: the short-lived kicks the
 * post chain (render/Effects) answers with — a blast's punch (a flash of
 * exposure), a blow taken (the colour drained for a moment) — and the long
 * state of a wizard near death (the world greying, the rim of sight closing
 * in with the pulse).
 *
 * Pure numbers, no three.js: the event wiring lives in Effects, and this
 * module only keeps the levels and lets them fall away, so it can be tested
 * on its own. Every level is 0…1. */

export interface Feel {
  /** A blast, a cast's recoil, a boss's stomp (the `shake` event). */
  impact: number;
  /** A blow taken (the `playerHurt` event). */
  hurt: number;
  /** How near death: 0 above a third of your health, 1 at none. */
  low: number;
  /** The heart: 0…1, beating faster the nearer death. */
  beat: number;
  /** Where in its beat the heart is (0…1). */
  phase: number;
}

export function newFeel(): Feel {
  return { impact: 0, hurt: 0, low: 0, beat: 0, phase: 0 };
}

/** How fast each kick falls away (per second, exponential): a blast's punch
 * is a blink, a blow lingers a little. */
const DECAY = { impact: 7, hurt: 3.2 };

/** A `shake` request (0…1): kicks stack, but never past the top. */
export function kickImpact(f: Feel, strength: number): void {
  f.impact = Math.min(1, Math.max(f.impact, strength) + strength * 0.25);
}

/** A blow of `amount` damage: even a scratch is felt; a heavy blow fills it. */
export function kickHurt(f: Feel, amount: number): void {
  f.hurt = Math.min(1, f.hurt + 0.35 + Math.max(0, amount) / 35);
}

/** Let the kicks fall away over `dt` seconds and follow the wizard's
 * health (`frac`, 0…1 of the maximum). */
export function stepFeel(f: Feel, dt: number, frac: number): void {
  f.impact *= Math.exp(-DECAY.impact * dt);
  f.hurt *= Math.exp(-DECAY.hurt * dt);
  if (f.impact < 1e-3) f.impact = 0;
  if (f.hurt < 1e-3) f.hurt = 0;
  const target = lowOf(frac);
  // Eases in and out over about half a second: healing lifts the grey.
  f.low += (target - f.low) * (1 - Math.exp(-dt * 2.5));
  // 70 bpm calm, 140 at the end; a lub-dub (two bumps) per beat.
  f.phase = (f.phase + (dt * (70 + 70 * f.low)) / 60) % 1;
  f.beat = f.low > 0.001 ? heartbeat(f.phase) : 0;
}

/** How near death at `frac` of full health: nothing above a third, all of it
 * at zero, eased so the last stretch is felt most. */
export function lowOf(frac: number): number {
  const t = Math.min(1, Math.max(0, (0.34 - frac) / 0.34));
  return t * t * (3 - 2 * t);
}

/** A lub-dub at phase p (0…1): a strong bump, then a softer one. */
export function heartbeat(p: number): number {
  const bump = (c: number, w: number) => Math.exp(-(((p - c) / w) ** 2));
  return Math.min(1, bump(0.08, 0.05) + 0.6 * bump(0.26, 0.05));
}
