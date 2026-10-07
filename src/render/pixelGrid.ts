/** The world's pixel grid: how big one world pixel is on screen.
 *
 * The world renders at low resolution and the browser upscales it with
 * image-rendering: pixelated. For that to look clean, every world pixel must
 * cover the same whole number of DEVICE pixels — at a fractional scale (the
 * old fixed dpr 0.35 gave 2.86 screen pixels per world pixel) most columns
 * come out 3 wide and every few 2, and those thin columns crawl across the
 * image as you turn.
 *
 * So the scale is a whole number, picked per display so the world lands near
 * TARGET_LINES lines tall: players on different monitors see nearly the
 * same chunkiness (≈290–400 lines on common screens) without everyone being
 * forced to one exact resolution. The canvas is sized to exactly
 * width × scale device pixels — up to one world pixel larger than the
 * window, cropped evenly at the edges — so there is never a border. */

/** About how many world pixels tall the view is (the old dpr 0.35 gave ~330
 * in a typical 1080p browser window). */
export const TARGET_LINES = 340;

export interface PixelGrid {
  /** Device pixels per world pixel (a whole number ≥ 1). */
  scale: number;
  /** The world's render size, in world pixels. */
  width: number;
  height: number;
  /** The canvas's CSS box: exactly width × scale device pixels. */
  cssWidth: number;
  cssHeight: number;
  /** Where the box sits (CSS px; ≤ 0 — the overhang, split evenly and
   * snapped to whole device pixels). */
  cssLeft: number;
  cssTop: number;
  /** The renderer's pixel ratio (world pixels per CSS px). */
  dpr: number;
}

/** The grid for a viewport of `cssW × cssH` CSS px at `deviceRatio` device
 * pixels per CSS px. */
export function pixelGrid(cssW: number, cssH: number, deviceRatio: number, target = TARGET_LINES): PixelGrid {
  const ratio = deviceRatio > 0 ? deviceRatio : 1;
  const devW = Math.max(1, Math.round(cssW * ratio));
  const devH = Math.max(1, Math.round(cssH * ratio));
  // The whole-number scale whose line count is nearest the target (in
  // proportion: 300 and 400 are equally far from ~346).
  const lo = Math.max(1, Math.floor(devH / target));
  const hi = lo + 1;
  const off = (k: number) => Math.abs(Math.log(devH / k / target));
  const scale = off(lo) <= off(hi) ? lo : hi;
  const width = Math.ceil(devW / scale);
  const height = Math.ceil(devH / scale);
  // A quarter device pixel of slack, so the renderer's floor(css × dpr)
  // can't round a hair under and lose a column; spread across the whole
  // box it never moves a pixel edge.
  const boxW = width * scale + 0.25;
  const boxH = height * scale + 0.25;
  return {
    scale,
    width,
    height,
    cssWidth: boxW / ratio,
    cssHeight: boxH / ratio,
    cssLeft: -Math.floor((width * scale - devW) / 2) / ratio,
    cssTop: -Math.floor((height * scale - devH) / 2) / ratio,
    dpr: ratio / scale,
  };
}
