import { woundStage, type WoundStage } from "../game/vitality";

/** Wounds on the body: what a creature looks like as its life runs out —
 * the owner's Destiny ask made visible without a bar. Past the knee
 * (game/vitality.ts: half its real life shows as the last third) it breaks
 * and from then on it is visibly barely alive: its glow gutters like a
 * failing lamp, it leaks embers / goo / smoke, it lists to one side and
 * breathes ragged; at the very end its light beats like a heart.
 *
 * Everything here is a function of the real life fraction (the replicated
 * hp — every client agrees on the stage) and a clock, plus a per-body seed
 * so neighbours don't flicker in step. Pure; tested in wounds.test.ts. */

export interface WoundLook {
  stage: WoundStage;
  /** Multiplier on the body's resting glow this frame (sputter, heartbeat). */
  glow: number;
  /** Glowing cracks across the shell, 0…1 in stepped bands. */
  crack: number;
  /** Particles a second it leaks. */
  leak: number;
  /** How far it lists to its side (rad) and sags (m, fliers only). */
  list: number;
  sag: number;
  /** Breathing depth multiplier (ragged near the end). */
  breath: number;
}

export function createWoundLook(): WoundLook {
  return { stage: 0, glow: 1, crack: 0, leak: 0, list: 0, sag: 0, breath: 1 };
}

/** Deterministic 0…1 hash of an integer-ish value. */
function hash(n: number): number {
  const s = Math.sin(n * 91.3458 + 47.123) * 43758.5453;
  return s - Math.floor(s);
}

/** A dying bulb: the glow holds, then drops out in stepped holes. `amount`
 * 0…1 is how often and how deep. Steps at ~11 Hz (pixel animation, not a
 * smooth breathe); deterministic in (t, seed). */
export function sputter(t: number, seed: number, amount: number): number {
  if (amount <= 0) return 1;
  const step = Math.floor(t * 11 + seed * 7.3);
  const r = hash(step + seed * 131);
  if (r < amount * 0.45) return 0.15; // a hole: nearly out
  if (r < amount * 0.8) return 0.6;
  return 1;
}

/** A heartbeat: lub-dub, then rest. Peaks at 1, rests at 0. */
export function heartbeat(t: number, bpm: number): number {
  const ph = (t * bpm) / 60;
  const f = ph - Math.floor(ph);
  if (f < 0.1) return 1;
  if (f < 0.18) return 0.2;
  if (f < 0.26) return 0.75;
  return 0;
}

/** How wounded `real` (life fraction 0…1) looks at time `t`. */
export function woundLook(real: number, t: number, seed: number, out: WoundLook): WoundLook {
  const stage = woundStage(real);
  out.stage = stage;
  // Cracks open from the first quarter lost, in four hard steps.
  const c = Math.min(1, Math.max(0, (0.75 - real) / 0.75));
  out.crack = Math.ceil(c * 4) / 4;
  if (stage < 2) {
    out.glow = 1;
    out.leak = 0;
    out.list = 0;
    out.sag = 0;
    out.breath = stage === 1 ? 1.3 : 1;
    return out;
  }
  const dying = stage === 3;
  let g = sputter(t, seed, dying ? 0.6 : 0.3);
  if (dying) g *= 0.55 + 0.7 * heartbeat(t, 96);
  out.glow = g;
  out.leak = dying ? 11 : 5;
  // Lists a little further and wavers as it weakens.
  const waver = Math.sin(t * 2.3 + seed * 5) * 0.04;
  out.list = (dying ? 0.24 : 0.13) + waver;
  out.sag = dying ? 0.2 : 0.12;
  out.breath = dying ? 2.6 : 1.8;
  return out;
}
