import { heartbeat, lowOf, newHeart, stepHeart, type Heart } from "../../game/heart";

/** What the body feels, pushed into the image: the short-lived kicks the
 * post chain (render/Effects) answers with — a blast's punch (a zoom-blur
 * kick, the lens splitting colour, a flash of exposure), a blow taken (the
 * colour drained for a moment, the lens split), a blink-dash's rush — and
 * the long state of a wizard near death (the world greying but for its
 * reds, the rim of sight closing in with the pulse), the Brink's slam and a
 * second wind's release.
 *
 * The near-death part is the wizard's one heart (game/heart): Effects hands
 * its Feel the shared heart, so the image beats in time with the orb, the
 * vignette and the thud in your ears. A Feel made bare gets a heart of its
 * own (tests).
 *
 * Pure numbers, no three.js: the event wiring lives in Effects, and this
 * module only keeps the levels and lets them fall away, so it can be tested
 * on its own. Every level is 0…1. */

export { heartbeat, lowOf };

export interface Feel {
  /** A blast, a cast's recoil, a boss's stomp (the `shake` event). */
  impact: number;
  /** A blow taken (the `playerHurt` event). */
  hurt: number;
  /** A blink-dash. */
  dash: number;
  /** How near death: 0 above the last-stand line, 1 at none. */
  low: number;
  /** The heart: 0…1, beating faster the nearer death. */
  beat: number;
  /** Where in its beat the heart is (0…1). */
  phase: number;
  /** The Brink (a killing blow refused): 1 → 0. */
  brink: number;
  /** A second wind (healed back over the line): 1 → 0. */
  release: number;
  /** The heart all of the above is read from. */
  heart: Heart;
}

export function newFeel(heart: Heart = newHeart()): Feel {
  return { impact: 0, hurt: 0, dash: 0, low: 0, beat: 0, phase: 0, brink: 0, release: 0, heart };
}

/** How fast each kick falls away (per second, exponential): a blast's punch
 * is a blink, a blow lingers a little, a dash's rush lasts its stride. */
const DECAY = { impact: 7, hurt: 3.2, dash: 4.5 };

/** A `shake` request (0…1): kicks stack, but never past the top. */
export function kickImpact(f: Feel, strength: number): void {
  f.impact = Math.min(1, Math.max(f.impact, strength) + strength * 0.25);
}

/** A blow of `amount` damage: even a scratch is felt; a heavy blow fills it. */
export function kickHurt(f: Feel, amount: number): void {
  f.hurt = Math.min(1, f.hurt + 0.35 + Math.max(0, amount) / 35);
}

export function kickDash(f: Feel): void {
  f.dash = 1;
}

/** Let the kicks fall away over `dt` seconds and follow the wizard's
 * health (`frac`, 0…1 of the maximum). */
export function stepFeel(f: Feel, dt: number, frac: number): void {
  f.impact *= Math.exp(-DECAY.impact * dt);
  f.hurt *= Math.exp(-DECAY.hurt * dt);
  f.dash *= Math.exp(-DECAY.dash * dt);
  if (f.impact < 1e-3) f.impact = 0;
  if (f.hurt < 1e-3) f.hurt = 0;
  if (f.dash < 1e-3) f.dash = 0;
  // The heart: stepped here, once a frame, for everyone who reads it.
  const h = f.heart;
  stepHeart(h, dt, frac);
  f.low = h.low;
  f.beat = h.beat;
  f.phase = h.phase;
  f.brink = h.brink;
  f.release = h.release;
}
