import type { EnemyId } from "./roster";

/** Body language every player sees. Brains run on the host only, so what a
 * creature is about to do travels as one small number in the snapshot
 * fields — an act code and how far into it the body is — and every client
 * poses the body from it: the shadow coils back with flaring eyes before it
 * lunges, the Warden crouches and stills its shell before a charge, the
 * sentry's crystal swells before it fires. ~90 ms of interpolation against a
 * 350–600 ms wind-up still reads, and the delta filter only ships the field
 * when it changes (at most 16 steps per wind-up).
 *
 * Pure; tested in anticipation.test.ts. */

export const ACT = {
  idle: 0,
  /** Shadow: drawing back before a lunge. */
  coil: 1,
  lunge: 2,
  recoil: 3,
  /** Warden: crouched, shell stilled, before a charge. */
  brace: 4,
  charge: 5,
  /** Warden: risen before a slam lands. */
  slam: 6,
  /** Sentry: the crystal swelling before a shot. */
  aim: 7,
  /** Wisp (death's door): a sideways jink. */
  jink: 8,
} as const;

export type ActCode = (typeof ACT)[keyof typeof ACT];

/** Progress travels in 16 steps. */
const STEPS = 15;

/** One wire number: code × 16 + progress step. */
export function encodeAct(code: number, progress: number): number {
  const p = Math.round(Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * STEPS);
  return code * 16 + p;
}

export interface Act {
  code: number;
  /** 0…1 into the act. */
  progress: number;
}

export function createAct(): Act {
  return { code: ACT.idle, progress: 0 };
}

/** Read the wire number into `out`; garbage reads as idle. */
export function decodeAct(a: number, out: Act): Act {
  if (!Number.isInteger(a) || a < 0 || a >= 16 * 16) {
    out.code = ACT.idle;
    out.progress = 0;
    return out;
  }
  out.code = a >> 4;
  out.progress = (a & 15) / STEPS;
  return out;
}

/** Is `code` a wind-up — the beat a player should read and dodge? */
export function isWindup(code: number): boolean {
  return code === ACT.coil || code === ACT.brace || code === ACT.slam || code === ACT.aim;
}

/** What an act does to the body's puppet (added to its spring targets). */
export interface Anticipation {
  /** Lean toward the prey (rad; negative = drawing back). */
  lean: number;
  /** Offset away from the prey (m). */
  back: number;
  /** Rise (m). */
  rise: number;
  /** Squash (< 0) or stretch (> 0) target. */
  squash: number;
  /** Uniform swell target. */
  swell: number;
  /** Extra emissive intensity on the body. */
  glow: number;
  /** Eye brightness multiplier (the shadow's eyes flare). */
  eye: number;
  /** Shiver amplitude (m of jitter). */
  shiver: number;
  /** Multiplier on a spinning shell (the Warden stills before it charges). */
  spin: number;
  /** Swell of one part only (the sentry's crystal head; the Warden's
   * shards folding in, as a negative). */
  accent: number;
}

export function createAnticipation(): Anticipation {
  return { lean: 0, back: 0, rise: 0, squash: 0, swell: 0, glow: 0, eye: 1, shiver: 0, spin: 1, accent: 0 };
}

/** The pose `kind` takes `progress` (0…1) into act `code`. */
export function anticipate(kind: EnemyId, code: number, progress: number, out: Anticipation): Anticipation {
  out.lean = out.back = out.rise = out.squash = out.swell = out.glow = out.shiver = out.accent = 0;
  out.eye = 1;
  out.spin = 1;
  const p = Math.min(1, Math.max(0, progress));
  switch (code) {
    case ACT.coil:
      // Draws back and down into itself, eyes flaring, trembling to strike.
      out.lean = -0.4 * p;
      out.back = 0.3 * p;
      out.squash = -0.3 * p;
      out.swell = 0.12 * p;
      out.glow = 1.6 * p;
      out.eye = 1 + 2.5 * p;
      out.shiver = 0.05 * p;
      break;
    case ACT.lunge:
      out.lean = 0.35;
      out.squash = 0.25;
      out.eye = 2.5;
      out.glow = 0.8;
      break;
    case ACT.recoil:
      out.lean = -0.15;
      out.squash = -0.05;
      break;
    case ACT.brace:
      // Tilts back ~20°, crouches, stills its shell and heats its core.
      out.lean = -0.35 * p;
      out.back = 0.25 * p;
      out.squash = -0.18 * p;
      out.glow = 2.2 * p;
      out.shiver = 0.05 * p;
      out.spin = 1 - p;
      out.accent = -0.4 * p; // shards fold in
      break;
    case ACT.charge:
      out.lean = 0.3;
      out.squash = 0.1;
      out.glow = 1.2;
      out.spin = 0.3;
      break;
    case ACT.slam:
      out.rise = 0.6 * p;
      out.swell = 0.1 * p;
      out.glow = 3 * p;
      out.shiver = 0.04 * p;
      break;
    case ACT.aim:
      out.accent = 0.2 * p; // the crystal swells; the plinth doesn't
      out.shiver = p > 0.7 ? 0.015 : 0;
      break;
    case ACT.jink:
      out.squash = 0.18;
      break;
  }
  // The Warden is heavy: half the pose reads as twice the menace.
  if (kind === "boss") out.shiver *= 0.6;
  return out;
}
