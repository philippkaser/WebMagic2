/** The scale (≈1) that makes `screenPx` screen pixels per font pixel a whole
 * number: the nearest one, never below 1. Text under about a screen pixel per
 * font pixel is left alone (it can't be made crisp, only smaller). */
export function snapScale(screenPx: number): number {
  if (!(screenPx > 0.9)) return 1;
  return Math.max(1, Math.round(screenPx)) / screenPx;
}
