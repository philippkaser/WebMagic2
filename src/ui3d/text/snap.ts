import { nearestStep } from "./type";

/** The scale (≈1) that makes `screenPx` screen pixels per font pixel a whole
 * number: the nearest one, never below 1 — text a little under a screen pixel
 * per font pixel is brought UP to one, where it's at least crisp. Text far
 * smaller than that (distant world text) is left alone. */
export function snapScale(screenPx: number): number {
  if (!(screenPx > 0.66)) return 1;
  return nearestStep(screenPx) / screenPx;
}

/** How much of the dark outline to keep at `screenPx` screen pixels per font
 * pixel. The outline is the ink grown by one font pixel; at one screen pixel
 * that fills every gap between strokes and letters and a word goes to a dark
 * bar, so small text keeps only a trace of it. */
export function outlineAt(screenPx: number): number {
  return screenPx >= 1.75 ? 1 : 0.25;
}
