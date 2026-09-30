import {
  CanvasTexture,
  LinearMipmapLinearFilter,
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
 * - Nearest magnification: the chunky texel IS the look.
 * - Minification: Nearest and no mipmaps for props (small, seen close —
 *   mips would only burn upload time and VRAM). With `mipmaps`, trilinear
 *   minification instead: the architecture is seen far off and at grazing
 *   angles, where a Nearest min-filter turns every joint into sparkle.
 *   Up close it still magnifies Nearest, so the look is unchanged there.
 * - RepeatWrapping: every surface tiles; repeat is set per use-site by
 *   cloning (see textures/index.ts), which shares this texture's GPU upload.
 * - `srgb` for color-like maps (map, emissiveMap); data maps (normal,
 *   roughness, alpha masks) stay linear. */
export function toTexture(
  rgba: RGBA,
  width: number,
  height: number,
  srgb: boolean,
  mipmaps = false,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = mipmaps ? LinearMipmapLinearFilter : NearestFilter;
  tex.generateMipmaps = mipmaps;
  // Floors are seen at grazing angles; a little anisotropy keeps the far
  // flagstones from smearing into one colour once they're mipped.
  if (mipmaps) tex.anisotropy = 4;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  return tex;
}
