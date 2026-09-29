import {
  CanvasTexture,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import type { RGBA } from "./paint";

/** The ONE place the texture system touches the DOM.
 *
 * Painters and the normal-map filter are pure buffer math (testable under
 * `bun test` with no DOM); this module turns a finished RGBA buffer into a
 * GPU-ready texture. Keep it that way — anything that needs `document` goes
 * here, everything else stays pure. */

/** Upload an RGBA buffer as a pixel-art texture.
 *
 * - NearestFilter both ways: the chunky texel IS the look.
 * - No mipmaps: with a Nearest min-filter three.js never samples them, so
 *   generating them would only burn upload time and VRAM.
 * - RepeatWrapping: every surface tiles; repeat is set per use-site by
 *   cloning (see textures/index.ts), which shares this texture's GPU upload.
 * - `srgb` for color-like maps (map, emissiveMap); data maps (normal,
 *   roughness, alpha masks) stay linear. */
export function toTexture(rgba: RGBA, width: number, height: number, srgb: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  return tex;
}
