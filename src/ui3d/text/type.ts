import { pxFor } from "../anchors";
import type { FontId } from "../font/faces";

/** The type scale.
 *
 * RuneText lands every font pixel on a whole number of screen pixels, so text
 * is only ever drawn at ×1, ×2, ×3… of its font. A size between two steps is
 * rounded to one of them — and two texts sized a hair apart can come out a
 * whole step apart, one blown up, the other shrunk by a third. So sizes are
 * chosen AS steps: `n` screen pixels per font pixel on the reference view
 * (800 px tall), where layout and drawing agree exactly; on other screens
 * every text on a step scales with the others.
 *
 * The steps, by role (the small faces — Tiny5 body, Silkscreen label — have
 * 5 px caps):
 *   STEP.fine  ×1  captions under things: key names, slot names, tracking labels
 *   STEP.text  ×2  anything meant to be read: sentences, item names, buttons
 *   STEP.lead  ×3  numbers that matter, emphasis
 * Display type: the heading face (15 px cap) at ×1 or ×2, the title face
 * (12 px cap) at whatever step fills its space. */

export const REF_HEIGHT = 800;

export const STEP = {
  fine: 1,
  text: 2,
  lead: 3,
} as const;

/** Cap height, in font pixels, of each face where faces.ts rasterizes it
 * pixel-exact. */
export const FACE_CAP: Record<FontId, number> = { title: 12, heading: 15, body: 5, label: 5, pixel: 7 };

/** Fraction of the view height covered by the cap of `face` at step `n`. */
export function capFraction(n: number, face: FontId = "body"): number {
  return (n * FACE_CAP[face]) / REF_HEIGHT;
}

/** RuneText `px` for `face` at step `n`, `distance` metres from the eye. */
export function typePx(distance: number, n: number, face: FontId = "body"): number {
  return pxFor(distance, capFraction(n, face));
}

/** The step nearest to `screenPx` screen pixels per font pixel (never 0). */
export function nearestStep(screenPx: number): number {
  return Math.max(1, Math.round(screenPx));
}
