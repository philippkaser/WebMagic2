import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from "three";
import type { Rgb } from "./palette";

/** The paint buffer every procedural texture is drawn into, and the steps
 * that turn it into GPU textures. A painter fills color + height (+ optional
 * roughness / emissive channels); the height field becomes a normal map so
 * the chunky pixels still catch light. */

export interface Painted {
  w: number;
  h: number;
  /** rgba, w*h*4. */
  color: Uint8ClampedArray<ArrayBuffer>;
  /** 0..1 relief, drives the normal map. */
  height: Float32Array;
  /** 0..1 per-pixel roughness, or null for "use the material's scalar". */
  rough: Float32Array | null;
  /** rgb glow (rgba buffer), or null when the surface never glows. */
  emit: Uint8ClampedArray<ArrayBuffer> | null;
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

/** Multiply a pixel's color toward `c` by `t` (0 = untouched). */
export function tint(p: Painted, x: number, y: number, c: Rgb, t: number) {
  const i = (y * p.w + x) * 4;
  p.color[i] += (c[0] - p.color[i]) * t;
  p.color[i + 1] += (c[1] - p.color[i + 1]) * t;
  p.color[i + 2] += (c[2] - p.color[i + 2]) * t;
}

/** Central differences over a wrapping height field. */
export function heightToNormal(p: Painted, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const { w, h, height } = p;
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
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

/** Scalar channel → grayscale rgba (three reads roughness from G). */
export function scalarToRgba(values: Float32Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(1, values[i])) * 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function toTexture(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  w: number,
  h: number,
  srgb: boolean,
  repeatX: number,
  repeatY: number,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}
