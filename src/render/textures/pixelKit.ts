import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from "three";

/** A small, self-contained pixel-painting toolkit for the hand-built models
 * (render/models/modelPaint.ts) and the village (villagePainters.ts): a paint
 * buffer with color + height (+ optional roughness / glow) channels, stepped
 * palette ramps, tileable value/Worley noise, and the step that turns a
 * buffer into NearestFilter GPU textures (normal map from the height field,
 * so chunky texels still catch light).
 *
 * Deliberately independent of the architecture painters in this folder: the
 * models must look the same whatever the biome surfaces do, and the two sets
 * evolve separately. */

// ── Palette ─────────────────────────────────────────────────────────────────

export type Rgb = [number, number, number];

export function hex(c: string): Rgb {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A color ramp sampled at t∈[0,1]. Stepped (no blend): the banding IS the
 * pixel-art look — every surface picks from a handful of hand-tuned tones. */
export function ramp(stops: string[]): (t: number) => Rgb {
  const cols = stops.map(hex);
  const n = cols.length;
  return (t) => cols[Math.floor(Math.max(0, Math.min(0.9999, t)) * n)];
}

// ── Noise (everything tiles: lattices wrap at the texture's period) ──────────

export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (v: number, p: number) => ((v % p) + p) % p;

function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, px);
  const x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise over a w×h texture, `cells` lattice cells across. */
export function fbm(x: number, y: number, w: number, h: number, cells: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  let cx = cells;
  let cy = Math.max(1, Math.round((cells * h) / w));
  for (let o = 0; o < octaves; o++) {
    v += amp * vnoise((x / w) * cx, (y / h) * cy, cx, cy, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    cx *= 2;
    cy *= 2;
  }
  return v / norm;
}

export interface Cell {
  /** Distance to the nearest feature point, in cell units. */
  f1: number;
  /** Distance to the second nearest — (f2 - f1) small means "on a seam". */
  f2: number;
  /** Stable id of the nearest cell (0..1). */
  id: number;
}

/** Tileable Worley noise with cx×cy cells over the texture. */
export function worley(x: number, y: number, w: number, h: number, cx: number, cy: number, seed: number): Cell {
  const u = (x / w) * cx;
  const v = (y / h) * cy;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = wrap(iu + dx, cx);
      const gy = wrap(iv + dy, cy);
      const px = iu + dx + 0.15 + hash2(gx, gy, seed) * 0.7;
      const py = iv + dy + 0.15 + hash2(gx, gy, seed + 7) * 0.7;
      const d = Math.hypot(px - u, py - v);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(gx, gy, seed + 13);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id };
}

// ── Paint buffer ────────────────────────────────────────────────────────────

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

export function blank(w = 64, h = 64, channels: { rough?: boolean; emit?: boolean } = {}): Painted {
  return {
    w,
    h,
    color: new Uint8ClampedArray(w * h * 4),
    height: new Float32Array(w * h),
    rough: channels.rough ? new Float32Array(w * h).fill(0.9) : null,
    emit: channels.emit ? new Uint8ClampedArray(w * h * 4) : null,
  };
}

export function put(p: Painted, x: number, y: number, r: number, g: number, b: number, h: number): void {
  const i = (y * p.w + x) * 4;
  p.color[i] = r;
  p.color[i + 1] = g;
  p.color[i + 2] = b;
  p.color[i + 3] = 255;
  p.height[y * p.w + x] = h;
}

export function putRgb(p: Painted, x: number, y: number, c: Rgb, h: number): void {
  put(p, x, y, c[0], c[1], c[2], h);
}

/** Additive glow; paint at full brightness and let `emissiveIntensity` scale. */
export function glowAt(p: Painted, x: number, y: number, c: Rgb, amount = 1): void {
  if (!p.emit) return;
  const i = (((y + p.h) % p.h) * p.w + ((x + p.w) % p.w)) * 4;
  p.emit[i] = Math.min(255, p.emit[i] + c[0] * amount);
  p.emit[i + 1] = Math.min(255, p.emit[i + 1] + c[1] * amount);
  p.emit[i + 2] = Math.min(255, p.emit[i + 2] + c[2] * amount);
  p.emit[i + 3] = 255;
}

export function setRough(p: Painted, x: number, y: number, r: number): void {
  if (p.rough) p.rough[y * p.w + x] = r;
}

/** Pull a pixel's color toward `c` by `t` (0 = untouched). */
export function tint(p: Painted, x: number, y: number, c: Rgb, t: number): void {
  const i = (y * p.w + x) * 4;
  p.color[i] += (c[0] - p.color[i]) * t;
  p.color[i + 1] += (c[1] - p.color[i + 1]) * t;
  p.color[i + 2] += (c[2] - p.color[i + 2]) * t;
}

// ── Buffer → GPU ────────────────────────────────────────────────────────────

/** Central differences over a wrapping height field. */
function heightToNormal(p: Painted, strength: number): Uint8ClampedArray<ArrayBuffer> {
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

function scalarToRgba(values: Float32Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(1, values[i])) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function toTexture(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number, srgb: boolean, rx: number, ry: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(rx, ry);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

export interface PixelMaps {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  /** Present when the painter varied roughness (wet cobbles, glassy bits). */
  roughnessMap?: CanvasTexture;
  /** Present when the surface glows; pair with a non-black `emissive`. */
  emissiveMap?: CanvasTexture;
}

/** Upload a painted buffer. Every map is NearestFilter without mipmaps: the
 * texels stay hard-edged squares at any distance, which is the look. */
export function toMaps(p: Painted, repeatX = 1, repeatY = 1, normalStrength = 2.4): PixelMaps {
  const maps: PixelMaps = {
    map: toTexture(p.color, p.w, p.h, true, repeatX, repeatY),
    normalMap: toTexture(heightToNormal(p, normalStrength), p.w, p.h, false, repeatX, repeatY),
  };
  if (p.rough) maps.roughnessMap = toTexture(scalarToRgba(p.rough, p.w, p.h), p.w, p.h, false, repeatX, repeatY);
  if (p.emit) maps.emissiveMap = toTexture(p.emit, p.w, p.h, true, repeatX, repeatY);
  return maps;
}
