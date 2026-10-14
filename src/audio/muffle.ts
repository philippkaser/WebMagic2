import { audioCtx, masterBus } from "./context";

/** The world going under. Near death the world's sound turns muffled and
 * far away — a low-pass closing over everything OUT THERE — while what is
 * in your head (your heart, the Brink's ring, the UI) stays clear on the
 * master bus and cuts through. The Brink punches the world out entirely for
 * a moment; a second wind throws it open again, faster than it closed.
 *
 * The world bus is one low-pass and one gain in front of the master:
 * everything placed and traced (audio/spatial's buses: tails, your own
 * steps and spells, every voice) and the ambient bed go through it; sounds
 * built with no destination (tone/noise straight to master) bypass it.
 * Created lazily with the context; until then (and in tests) callers fall
 * back to the master bus. */

/** Wide open (inaudible as a filter), at death's door, at the Brink (Hz). */
export const MUFFLE = { open: 18000, deep: 900, brink: 350 } as const;

export interface Muffle {
  cutoff: number;
  gain: number;
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const LOG_OPEN = Math.log(MUFFLE.open);
const LOG_DEEP = Math.log(MUFFLE.deep);
const LOG_BRINK = Math.log(MUFFLE.brink);

/** The world's filter for a heart at depth `low`, a Brink's punch `brink`
 * and a second wind's `release` (all 0…1; game/heart). Cutoff moves in log
 * space, so each step of the way down sounds like a step. */
export function muffleOf(low: number, brink: number, release: number, out: Muffle = { cutoff: 0, gain: 0 }): Muffle {
  const l = clamp01(low);
  const b = clamp01(brink);
  const r = clamp01(release);
  // Already a step at the line (low starts at heart's onset), deep by the end.
  let lc = LOG_OPEN + (LOG_DEEP - LOG_OPEN) * Math.pow(l, 0.7);
  lc += (LOG_BRINK - lc) * b;
  lc += (LOG_OPEN - lc) * r;
  let gain = (1 - 0.3 * l) * (1 - 0.65 * b);
  gain += (1 - gain) * r;
  out.cutoff = Math.exp(lc);
  out.gain = gain;
  return out;
}

let world: { filter: BiquadFilterNode; gain: GainNode } | null = null;
const last: Muffle = { cutoff: MUFFLE.open, gain: 1 };

/** Where the world's sound goes (null before the context exists). */
export function worldBus(): AudioNode | null {
  if (world) return world.filter;
  const ctx = audioCtx();
  const master = masterBus();
  if (!ctx || !master) return null;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = MUFFLE.open;
  filter.Q.value = 0.6;
  const gain = ctx.createGain();
  filter.connect(gain).connect(master);
  world = { filter, gain };
  return filter;
}

/** Steer the world's filter toward `m` (called once a frame; skips
 * changes too small to hear). Closing takes a breath; opening is quick. */
export function setMuffle(m: Muffle): void {
  const ctx = audioCtx();
  if (!world || !ctx) return;
  const dc = Math.abs(Math.log(m.cutoff / last.cutoff));
  const dg = Math.abs(m.gain - last.gain);
  if (dc < 0.01 && dg < 0.004) return;
  const opening = m.cutoff > last.cutoff;
  const tau = opening ? 0.05 : 0.14;
  const t = ctx.currentTime;
  world.filter.frequency.setTargetAtTime(m.cutoff, t, tau);
  world.gain.gain.setTargetAtTime(m.gain, t, tau);
  last.cutoff = m.cutoff;
  last.gain = m.gain;
}

/** Back to wide open (the HUD leaving: death's screen, the menu). */
export function clearMuffle(): void {
  setMuffle({ cutoff: MUFFLE.open, gain: 1 });
}
