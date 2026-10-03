import type { FontId } from "../../font/faces";
import { FACE_CAP, nearestStep } from "../../text/type";
import { hudUnit } from "./HudAnchor";

/** The artpass grimoire HUD was designed in CSS pixels at a 1280×800-ish
 * window (its chrome scale is 1× there). The in-world HUD is laid out in the
 * same units so its panels, bars, slots and type keep artpass's proportions
 * exactly — the numbers in this folder are artpass's CSS numbers.
 *
 * One "ap" pixel is a fixed fraction of the screen HEIGHT (like every other
 * HUD size), a touch larger than artpass's 1× so the burning 3D type stays
 * legible on a laptop: at 800 px tall one ap pixel is 1.25 screen pixels. */

/** Screen pixels per artpass CSS pixel at an 800 px tall view. */
export const HUD_SCALE = 1.25;

/** Metres spanned by one artpass CSS pixel at `distance` from the eye. */
export function apx(distance: number): number {
  return (hudUnit(distance) * HUD_SCALE) / 800;
}

/** Native size of each face (the size faces.ts rasterizes it at, where it
 * is pixel-exact); cap heights are text/type.ts's FACE_CAP. */
const FACE_SIZE: Record<Exclude<FontId, "pixel">, number> = { title: 21, heading: 27, body: 8, label: 8 };

/** RuneText `px` for an artpass `font-size: cssPx` in `face`, at `distance`
 * (RuneText's px is a seventh of the cap height). The size is rounded to the
 * nearest step of the type scale (text/type.ts) — what RuneText would draw
 * anyway — so the HUD lays text out at the size it's drawn. */
export function fontPx(cssPx: number, face: Exclude<FontId, "pixel">, distance: number): number {
  return fontPxAt(cssPx, face, apx(distance));
}

/** The same for a known world size of one artpass pixel (`unit`). */
export function fontPxAt(cssPx: number, face: Exclude<FontId, "pixel">, unit: number): number {
  const n = nearestStep((cssPx / FACE_SIZE[face]) * HUD_SCALE);
  return ((n / HUD_SCALE) * unit * FACE_CAP[face]) / 7;
}

/** The width (world units) of the frame band a Plate draws INSIDE its
 * nominal size, and outside it — Plate's PixelFrame is 4 texels deep with
 * one texel hanging outside `width`. With artpass's 8 px border (texel 2),
 * content starts 3 texels in. */
export const FRAME_TEXEL = 2;

/** Plate width/height for an artpass panel whose CSS padding box is
 * `cssW × cssH` (border excluded), in ap pixels. */
export function plateSize(cssW: number, cssH: number): [number, number] {
  // CSS: 8 px border outside the padding box = 4 texels; Plate's band sits
  // 1 texel outside its size and 3 inside.
  return [cssW + FRAME_TEXEL * 6, cssH + FRAME_TEXEL * 6];
}
