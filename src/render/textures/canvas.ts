import { CanvasTexture, NearestFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from "three";
import type { Rgb } from "./palette";

/** The paint buffer every procedural texture is drawn into, and the steps
 * that turn it into GPU textures. A painter fills color + height (+ optional
 * roughness / emissive channels); the height field becomes a normal map so
 * the chunky pixels still catch light.
 *
 * Everything here except `toTexture` is pure buffer math, so painters run
 * (and are tested) under `bun test` with no DOM. `toTexture` is the one
 * place the texture system touches `document`. */

/** RGBA bytes, row-major, row 0 = top of the image (canvas convention). */
export type RGBA = Uint8ClampedArray<ArrayBuffer>;

export interface Painted {
  w: number;
  h: number;
  /** rgba, w*h*4 (sRGB). */
  color: RGBA;
  /** 0..1 relief (0 = deep groove, 1 = proud), drives the normal map. */
  height: Float32Array;
  /** 0..1 per-pixel roughness, or null for "use the material's scalar". */
  rough: Float32Array | null;
  /** rgb glow (rgba buffer, sRGB), or null when the surface never glows. */
  emit: RGBA | null;
}

export function blank(
  w = 64,
  h = 64,
  channels: { rough?: boolean; emit?: boolean } = {},
): Painted {
  return {
    w,
    h,
    color: new Uint8ClampedArray(w * h * 4),
    height: new Float32Array(w * h),
    rough: channels.rough ? new Float32Array(w * h).fill(0.9) : null,
    emit: channels.emit ? new Uint8ClampedArray(w * h * 4) : null,
  };
}

export function put(p: Painted, x: number, y: number, r: number, g: number, b: number, h: number) {
  const i = (y * p.w + x) * 4;
  p.color[i] = r;
  p.color[i + 1] = g;
  p.color[i + 2] = b;
  p.color[i + 3] = 255;
  p.height[y * p.w + x] = h;
}

export function putRgb(p: Painted, x: number, y: number, c: Rgb, h: number) {
  put(p, x, y, c[0], c[1], c[2], h);
}

/** Additive glow; the emissive channel is scaled by the material, so paint
 * it at full brightness and let `emissiveIntensity` do the rest. */
export function glow(p: Painted, x: number, y: number, c: Rgb, amount = 1) {
  if (!p.emit) return;
  const i = (((y + p.h) % p.h) * p.w + ((x + p.w) % p.w)) * 4;
  p.emit[i] = Math.min(255, p.emit[i] + c[0] * amount);
  p.emit[i + 1] = Math.min(255, p.emit[i + 1] + c[1] * amount);
  p.emit[i + 2] = Math.min(255, p.emit[i + 2] + c[2] * amount);
  p.emit[i + 3] = 255;
}

export function setRough(p: Painted, x: number, y: number, r: number) {
  if (p.rough) p.rough[y * p.w + x] = r;
}

/** Read back a pixel (for post-passes such as grime overlays). */
export function getRgb(p: Painted, x: number, y: number): Rgb {
  const i = (y * p.w + x) * 4;
  return [p.color[i], p.color[i + 1], p.color[i + 2]];
}

/** Pull a pixel's color toward `c` by `t` (0 = untouched). */
export function tint(p: Painted, x: number, y: number, c: Rgb, t: number) {
  const i = (y * p.w + x) * 4;
  p.color[i] += (c[0] - p.color[i]) * t;
  p.color[i + 1] += (c[1] - p.color[i + 1]) * t;
  p.color[i + 2] += (c[2] - p.color[i + 2]) * t;
}

/** Copy `src` into `dst` with its top-left at (x0, y0) — every channel the
 * two share. Used to lay wall variants side by side in one atlas. */
export function blit(dst: Painted, src: Painted, x0: number, y0: number): void {
  for (let y = 0; y < src.h; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.w) continue;
      const s = y * src.w + x;
      const d = dy * dst.w + dx;
      for (let c = 0; c < 4; c++) dst.color[d * 4 + c] = src.color[s * 4 + c];
      dst.height[d] = src.height[s];
      if (dst.rough && src.rough) dst.rough[d] = src.rough[s];
      if (dst.emit && src.emit) for (let c = 0; c < 4; c++) dst.emit[d * 4 + c] = src.emit[s * 4 + c];
    }
  }
}

/** Central differences over a wrapping height field → tangent-space normal
 * map. One-texel steps make one-texel bevels: the crisp pixel relief is the
 * look (a smoothing kernel would round every mortar line off).
 *
 * three.js convention (+Y = up the texture): CanvasTexture flips row 0 to
 * v = 1, so "up" is row − 1, and a texel whose height falls toward row − 1
 * faces up (+G) — the upper lip of a brick catches light from above.
 *
 * `tileW` makes the x-wrap happen per `tileW`-wide column, so an atlas of
 * side-by-side tiles (the wall variants) wraps each tile onto itself. */
export function heightToNormal(p: Painted, strength: number, tileW = p.w): RGBA {
  const { w, h, height } = p;
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number, x0: number) =>
    height[((y + h) % h) * w + x0 + ((x - x0 + tileW) % tileW)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = x - (x % tileW);
      const dx = (at(x - 1, y, x0) - at(x + 1, y, x0)) * strength;
      const dy = (at(x, y + 1, x0) - at(x, y - 1, x0)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out[i] = ((dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Decode one texel of an encoded normal map back to a vector (tests, and
 * anyone sanity-checking a painter). */
export function decodeNormal(rgba: RGBA, i: number): [number, number, number] {
  return [(rgba[i * 4] / 255) * 2 - 1, (rgba[i * 4 + 1] / 255) * 2 - 1, (rgba[i * 4 + 2] / 255) * 2 - 1];
}

/** Scalar channel → opaque grayscale rgba (three reads roughness from G). */
export function scalarToRgba(values: Float32Array): RGBA {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const v = Math.max(0, Math.min(1, values[i])) * 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Upload an RGBA buffer as a pixel-art texture: Nearest both ways and no
 * mipmaps (every texel stays a hard-edged pixel, near or far), repeat-wrapped
 * (repeat is set per use-site by cloning, which shares this upload). `srgb`
 * for color-like maps (map, emissiveMap); data maps stay linear. */
export function toTexture(rgba: RGBA, w: number, h: number, srgb: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  return tex;
}
