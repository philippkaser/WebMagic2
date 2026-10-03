import { nearestStep } from "./type";

/** How much of the dark outline to keep at `screenPx` screen pixels per font
 * pixel. The outline is the ink grown by one font pixel; at one screen pixel
 * that fills every gap between strokes and letters and a word goes to a dark
 * bar, so small text keeps only a trace of it. */
export function outlineAt(screenPx: number): number {
  return screenPx >= 1.75 ? 1 : 0.25;
}

/** Snapping that never pops.
 *
 * Snapping every frame to the nearest whole step makes moving text jump a
 * whole step (a third, a half of its size) the moment it crosses a rounding
 * point — a HUD stepping back for a menu, a tablet tilting in, a prompt you
 * walk toward. So a text holds its scale while it moves (it grows and
 * shrinks with the scene like any object), and only once it has settled
 * does it ease onto whole pixels — and it keeps the step it has unless it
 * lands well past the halfway point to the next (hysteresis), so a text
 * resting near a boundary doesn't flicker between two sizes. */
export interface Snapper {
  /** The scale drawn at now. */
  k: number;
  /** Where it's easing to. */
  target: number;
  /** The whole step it rests on (0: too small to snap). */
  step: number;
  /** The measure it was last still at, and since when. */
  ref: number;
  since: number;
  /** Last frame's measure. */
  prev: number;
}

/** Relative change in measured size that counts as moving: in all since it
 * was last still, or in one frame (a slow, steady move). */
export const SNAP_DRIFT = 0.025;
export const SNAP_DRIFT_FRAME = 0.0015;
/** Seconds still before snapping. */
export const SNAP_SETTLE = 0.2;
/** How far past halfway to the next step before changing step. */
export const SNAP_HYSTERESIS = 0.15;
/** Easing rate onto the snapped scale, per second. */
const SNAP_EASE = 8;

export function newSnapper(): Snapper {
  return { k: 0, target: 1, step: 0, ref: 0, since: 0, prev: 0 };
}

function stepFor(raw: number, current: number): number {
  if (!(raw > 0.66)) return 0;
  if (current > 0 && Math.abs(raw - current) <= 0.5 + SNAP_HYSTERESIS) return current;
  return nearestStep(raw);
}

/** Advance `s` with this frame's measure `raw` (screen pixels per font
 * pixel at scale 1) at time `now`; returns the scale to draw at. */
export function stepSnapper(s: Snapper, raw: number, now: number, dt: number): number {
  if (s.k === 0) {
    // First sight: at its designed size — it may well be flying in.
    s.k = s.target = 1;
    s.step = 0;
    s.ref = s.prev = raw;
    s.since = now;
    return s.k;
  }
  const moving = Math.abs(raw / s.ref - 1) > SNAP_DRIFT || Math.abs(raw / s.prev - 1) > SNAP_DRIFT_FRAME;
  s.prev = raw;
  if (moving) {
    s.ref = raw;
    s.since = now;
  } else if (now - s.since >= SNAP_SETTLE) {
    s.step = stepFor(raw, s.step);
    s.target = s.step > 0 ? s.step / raw : 1;
  }
  // Moving: hold k (and the target), so the text scales with the scene.
  if (now - s.since >= SNAP_SETTLE) {
    s.k += (s.target - s.k) * Math.min(1, dt * SNAP_EASE);
    if (Math.abs(s.target - s.k) < 1e-4) s.k = s.target;
  }
  return s.k;
}
