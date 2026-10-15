/** One heart — the wizard's own pulse, and the one clock everything that
 * says "you are barely alive" keeps time with: the post chain's grey and
 * its closing rim (render/post/feel), the hurt vignette's stain, the
 * health orb's throb, the thud in your head (audio/heartSounds) and the
 * world going under (audio/muffle). They used to beat on four clocks of
 * their own; now the eye, the ear and the glass all beat as one.
 *
 * The heart is felt from the last-stand line down (vitality.LAST_STAND):
 * the moment your harm starts being halved is the moment the world goes
 * muffled and the pulse comes up — the line is a place you can hear. It
 * races toward death, slams at the Brink, and after a second wind (healing
 * back over the line) it slows over a few beats instead of just stopping.
 *
 * Pure and allocation-free. The world canvas steps the one `heart` every
 * frame (render/Effects, from the wizard's health); everything else only
 * reads it — the UI canvas renders after the world in the same frame, so
 * the orb and the vignette see this frame's beat. */

import { LAST_STAND } from "./vitality";

export interface Heart {
  /** How deep in the last stand, eased: 0 above the line, a step to
   * `HEART.onset` at it, 1 at death's door. */
  low: number;
  /** The rate right now (it races up, and slows down over beats). */
  bpm: number;
  /** Where in its beat the heart is (0…1). */
  phase: number;
  /** The lub-dub, 0…1 (0 while the heart isn't felt). */
  beat: number;
  /** Beats counted while felt — a new one is a thud in your head. */
  beats: number;
  /** How strongly it's felt (0…1): the last stand, or the slowing beats
   * after a second wind. */
  felt: number;
  /** The Brink's punch, 1 → 0. */
  brink: number;
  /** A second wind's lift, 1 → 0. */
  release: number;
  /** Beats left of the heart slowing after a second wind. */
  calm: number;
}

export const HEART = {
  /** Beats per minute: calm, at the line, at death's door. */
  rest: 66,
  line: 96,
  door: 156,
  /** The line is felt as a step: `low` jumps to this as you cross it. */
  onset: 0.3,
  /** How fast `low` follows health (1/s): sinking, lifting, and lifting on
   * a second wind (the muffle sweeps open, the colour floods back). */
  sink: 3,
  lift: 2.2,
  windLift: 7,
  /** The rate races up in a breath and slows over a few beats (1/s). */
  rise: 2.5,
  fall: 0.5,
  /** Extra bpm the Brink slams on. */
  brinkKick: 24,
  /** Beats the heart stays felt after a second wind, each softer. */
  calmBeats: 3,
  /** How strongly the first of those beats is felt. */
  calmFelt: 0.3,
  /** Decay of the Brink's punch and of a second wind (1/s). */
  brinkDecay: 1.6,
  releaseDecay: 1.4,
} as const;

/** A heal must carry you at least this share of your max health over the
 * line to be a second wind — a lifesteal trickle across it stays quiet. */
export const SECOND_WIND_MIN = 0.08;

export function newHeart(): Heart {
  return { low: 0, bpm: HEART.rest, phase: 0, beat: 0, beats: 0, felt: 0, brink: 0, release: 0, calm: 0 };
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** How near death at `frac` of full health: nothing above the last-stand
 * line, a step at it, everything at zero — eased so the last stretch is
 * felt most. */
export function lowOf(frac: number): number {
  const below = LAST_STAND.below;
  if (!(frac < below)) return 0;
  const t = clamp01((below - frac) / below);
  return HEART.onset + (1 - HEART.onset) * t * t * (3 - 2 * t);
}

/** The heart's rate for a depth `low` (continuous: calm → line → door). */
export function bpmOf(low: number): number {
  const l = clamp01(low);
  if (l < HEART.onset) return HEART.rest + (HEART.line - HEART.rest) * (l / HEART.onset);
  return HEART.line + (HEART.door - HEART.line) * ((l - HEART.onset) / (1 - HEART.onset));
}

/** A lub-dub at phase p (0…1): a strong bump, then a softer one. */
export function heartbeat(p: number): number {
  const a = (p - 0.08) / 0.05;
  const b = (p - 0.26) / 0.05;
  return Math.min(1, Math.exp(-a * a) + 0.6 * Math.exp(-b * b));
}

/** Where in a beat (as a share of its period) the lub and the dub land —
 * a thud scheduled at a new beat plays these far into it. */
export const LUB_AT = 0.08;
export const DUB_AT = 0.26;

/** Advance the heart by `dt` seconds, following health `frac` (0…1). */
export function stepHeart(h: Heart, dt: number, frac: number): void {
  const step = dt > 0 ? Math.min(dt, 0.1) : 0;
  const target = lowOf(frac);
  const rate = target > h.low ? HEART.sink : h.release > 0.05 ? HEART.windLift : HEART.lift;
  h.low += (target - h.low) * (1 - Math.exp(-rate * step));
  if (Math.abs(target - h.low) < 1e-3) h.low = target;

  const want = bpmOf(h.low) + HEART.brinkKick * h.brink;
  const k = want > h.bpm ? HEART.rise : HEART.fall;
  h.bpm += (want - h.bpm) * (1 - Math.exp(-k * step));

  h.phase += (step * h.bpm) / 60;
  if (h.phase >= 1) {
    h.phase -= Math.floor(h.phase);
    // Out of the last stand, each beat after a second wind is one fewer.
    if (h.calm > 0 && h.low < 0.02) h.calm = Math.max(0, h.calm - 1);
    if (feltOf(h) > 0.01) h.beats++;
  }
  h.felt = feltOf(h);
  h.beat = h.felt > 0.001 ? heartbeat(h.phase) : 0;
  h.brink *= Math.exp(-HEART.brinkDecay * step);
  h.release *= Math.exp(-HEART.releaseDecay * step);
  if (h.brink < 1e-3) h.brink = 0;
  if (h.release < 1e-3) h.release = 0;
}

function feltOf(h: Heart): number {
  return Math.max(h.low, h.calm > 0 ? (HEART.calmFelt * h.calm) / HEART.calmBeats : 0);
}

/** The Brink: a killing blow refused. The heart slams. */
export function kickBrink(h: Heart): void {
  h.brink = 1;
}

/** A second wind of `strength` (releaseOf): the world lifts, and the heart
 * slows over its last few beats. */
export function kickRelease(h: Heart, strength: number): void {
  if (!(strength > 0)) return;
  h.release = Math.max(h.release, Math.min(1, strength));
  h.calm = HEART.calmBeats;
}

/** How much a heal from `from` to `to` (shares of max health) is a second
 * wind: 0 unless it carries you up over the last-stand line by a real
 * amount; bigger heals lift harder. */
export function releaseOf(from: number, to: number): number {
  const line = LAST_STAND.below;
  if (!(from < line && to >= line)) return 0;
  const size = to - from;
  if (size < SECOND_WIND_MIN) return 0;
  return Math.min(1, 0.55 + size * 1.2);
}

// ── A wizard's life on the wire ─────────────────────────────────────────────
// Floor-mates see each other near death (net/players: the pose carries one
// small integer). Health stays decided on its owner's machine; this is only
// what the others are shown.

/** Life steps sent (0 = dead … 15 = whole). */
export const LIFE_STEPS = 15;
/** Set while its owner is inside the Brink's window. */
export const LIFE_BRINK = 16;

/** The highest step that still reads back under the last-stand line. */
const LAST_STAND_STEP = Math.ceil(LAST_STAND.below * LIFE_STEPS - 1e-9) - 1;

/** Health as one small integer: 0…15 (a sliver still alive rounds up to 1),
 * plus LIFE_BRINK at the Brink. Rounding up never carries anyone over the
 * last-stand line: at 28% you're in your last stand, and 5/15 (33%) would
 * show your floor-mates nothing wrong with you. */
export function lifeByte(health: number, max: number, brink: boolean): number {
  const f = max > 0 ? health / max : 0;
  let steps = f <= 0 ? 0 : Math.max(1, Math.min(LIFE_STEPS, Math.ceil(f * LIFE_STEPS - 1e-9)));
  if (f < LAST_STAND.below) steps = Math.min(steps, LAST_STAND_STEP);
  return steps + (brink ? LIFE_BRINK : 0);
}

/** A received life byte → its share of health (0…1) and the Brink bit, or
 * null if it isn't one (old clients send none; garbage is ignored). */
export function readLifeByte(b: unknown): { frac: number; brink: boolean } | null {
  if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > LIFE_STEPS + LIFE_BRINK) return null;
  return { frac: Math.min(LIFE_STEPS, b & 15) / LIFE_STEPS, brink: (b & LIFE_BRINK) !== 0 };
}

// ── The one heart ───────────────────────────────────────────────────────────

/** The local wizard's heart: stepped by render/Effects, read by everyone. */
export const heart: Heart = newHeart();
