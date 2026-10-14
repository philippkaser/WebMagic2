/** The presentation clock — how fast what you SEE runs, as opposed to what
 * IS: hitstop (a few frozen frames when a blow lands) and slow motion (the
 * Brink). Physics, enemy brains, timers and the network never read it, so
 * the shared world is untouched and every client freezes only its own view.
 * Readers scale their animation dt by presentScale() (particles, enemy
 * bodies, corpses, the staff, camera punch). */

/** Never hold the picture longer than this, however hits stack. */
export const MAX_HOLD_S = 0.25;

let holdUntil = 0;
let slowUntil = 0;
let slowScale = 1;

const nowS = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** Freeze the picture for `seconds` (stacking extends, up to MAX_HOLD_S
 * from now). */
export function hitstop(seconds: number, now = nowS()): void {
  if (seconds <= 0) return;
  holdUntil = Math.min(now + MAX_HOLD_S, Math.max(holdUntil, now + seconds));
}

/** Run the picture at `scale` (0…1) for `seconds`. */
export function slowMo(scale: number, seconds: number, now = nowS()): void {
  slowScale = Math.max(0.05, Math.min(1, scale));
  slowUntil = Math.max(slowUntil, now + seconds);
}

/** 0 while held, the slow-motion scale while slowed, else 1. */
export function presentScale(now = nowS()): number {
  if (now < holdUntil) return 0;
  if (now < slowUntil) return slowScale;
  return 1;
}

/** A frame's dt as the picture should see it. */
export function presentDt(dt: number, now = nowS()): number {
  return dt * presentScale(now);
}

/** Tests: back to running. */
export function resetPresentTime(): void {
  holdUntil = 0;
  slowUntil = 0;
  slowScale = 1;
}
