import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from "three";
import { Rng, hashSeed } from "../../core/rng";

/** Extra procedural pixel textures the hand-built models need (the world
 * textures live in render/textures). Same recipe: a tiny painted color field
 * plus a normal map derived from a height field, NearestFilter throughout so
 * the chunky texels survive the low-dpr canvas. `glyphs` is special: a black
 * field with bright carved runes, meant as an emissiveMap so any stone can
 * glow with writing in whatever color its material says. */

export type ModelTextureKind =
  | "bark" // staff shafts — vertical grain, knots
  | "iron" // bands, corners, cages — scratched dark metal with rivets
  | "bone" // skulls, bones — pitted ivory
  | "leather" // grips, boots, pouches — creased hide
  | "glyphs"; // emissive rune rows (black = off)

export interface ModelTexturePair {
  map: CanvasTexture;
  normalMap: CanvasTexture;
}

const SIZE = 32;
const cache = new Map<string, ModelTexturePair>();

export function getModelTextures(kind: ModelTextureKind, repeatX = 1, repeatY = 1): ModelTexturePair {
  const key = `${kind}:${repeatX}:${repeatY}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = new Rng(hashSeed(`model:${kind}`));
  const size = kind === "glyphs" ? 64 : SIZE;
  const p = blank(size);
  PAINTERS[kind](p, rng);
  const pair = {
    map: toTexture(p.color, size, true, repeatX, repeatY),
    normalMap: toTexture(heightToNormal(p.height, size, 2.4), size, false, repeatX, repeatY),
  };
  cache.set(key, pair);
  return pair;
}

interface Painted {
  size: number;
  color: Uint8ClampedArray<ArrayBuffer>;
  height: Float32Array;
}

function blank(size: number): Painted {
  return { size, color: new Uint8ClampedArray(size * size * 4), height: new Float32Array(size * size) };
}

function put(p: Painted, x: number, y: number, r: number, g: number, b: number, h: number) {
  const i = (y * p.size + x) * 4;
  p.color[i] = r;
  p.color[i + 1] = g;
  p.color[i + 2] = b;
  p.color[i + 3] = 255;
  p.height[y * p.size + x] = h;
}

const PAINTERS: Record<ModelTextureKind, (p: Painted, rng: Rng) => void> = {
  bark: (p, rng) => {
    for (let y = 0; y < p.size; y++) {
      for (let x = 0; x < p.size; x++) {
        const n = rng.next();
        // Long vertical grain streaks that wander a little.
        const streak = Math.sin(x * 1.9 + Math.sin(y * 0.3) * 1.4) > 0.55 ? 0.7 : 1;
        const knot = Math.hypot(x - 20, (y % 16) - 8) < 2.2 ? 0.55 : 1;
        const v = (92 + n * 26) * streak * knot;
        put(p, x, y, v, v * 0.72, v * 0.5, 0.35 + (streak < 1 ? 0 : 0.35) + n * 0.25);
      }
    }
  },

  iron: (p, rng) => {
    for (let y = 0; y < p.size; y++) {
      for (let x = 0; x < p.size; x++) {
        const n = rng.next();
        const rivet = (x % 16 === 3 || x % 16 === 4) && (y % 16 === 3 || y % 16 === 4);
        const scratch = (x + y * 3) % 23 === 0 && n > 0.4;
        const rust = n > 0.93 ? 1 : 0;
        const v = rivet ? 150 : scratch ? 120 : 58 + n * 20;
        put(p, x, y, v + rust * 30, v * 0.97 + rust * 8, v * 1.04, rivet ? 1 : scratch ? 0.4 : 0.55 + n * 0.15);
      }
    }
  },

  bone: (p, rng) => {
    for (let y = 0; y < p.size; y++) {
      for (let x = 0; x < p.size; x++) {
        const n = rng.next();
        const pit = n > 0.92 ? 0.7 : 1;
        const v = (196 + n * 30) * pit;
        put(p, x, y, v, v * 0.93, v * 0.78, pit < 1 ? 0.3 : 0.6 + n * 0.2);
      }
    }
  },

  leather: (p, rng) => {
    for (let y = 0; y < p.size; y++) {
      for (let x = 0; x < p.size; x++) {
        const n = rng.next();
        const crease = Math.sin(x * 0.8 + y * 0.45 + Math.sin(y * 0.9) * 2) > 0.9 ? 0.72 : 1;
        const v = (150 + n * 30) * crease;
        put(p, x, y, v, v * 0.97, v * 0.95, crease < 1 ? 0.25 : 0.55 + n * 0.25);
      }
    }
  },

  glyphs: (p, rng) => {
    // Rows of 5x7 cells, each a random stroke glyph: a vertical stem plus a
    // few branches — reads as "runes" at any size without being a real script.
    for (let i = 0; i < p.color.length; i += 4) p.color[i + 3] = 255;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 9; col++) {
        const ox = 2 + col * 7;
        const oy = 2 + row * 9;
        if (rng.next() < 0.12) continue; // word gaps
        const stroke = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= p.size || y >= p.size) return;
          put(p, x, y, 255, 255, 255, 0);
        };
        const stem = 1 + rng.int(0, 2);
        for (let y = 0; y < 7; y++) stroke(ox + stem, oy + y);
        const branches = 1 + rng.int(0, 2);
        for (let b = 0; b < branches; b++) {
          const by = rng.int(0, 5);
          const dir = rng.chance(0.5) ? 1 : -1;
          for (let k = 1; k < 3; k++) stroke(ox + stem + dir * k, oy + by + (rng.chance(0.5) ? k : 0));
        }
      }
    }
  },
};

function heightToNormal(height: Float32Array, size: number, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = ((dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function toTexture(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  size: number,
  srgb: boolean,
  repeatX: number,
  repeatY: number,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, size, size), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ── FX cards: grayscale masks for additive materials (black = invisible) ────

export type FxTextureKind =
  | "radial" // soft pixel glow blob
  | "beam" // vertical light pillar, bright at the base, fading up
  | "runeRing" // a circle of glyphs for ground sigils
  | "flame"; // 4-frame flame strip (frames side by side)

const fxCache = new Map<FxTextureKind, CanvasTexture>();

export function getFxTexture(kind: FxTextureKind): CanvasTexture {
  const hit = fxCache.get(kind);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const rng = new Rng(hashSeed(`fx:${kind}`));
  FX_PAINTERS[kind](canvas, ctx, rng);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  fxCache.set(kind, tex);
  return tex;
}

/** Quantize a 0..1 intensity to a few steps — banded falloff reads as pixel art. */
const band = (v: number, steps = 5) => Math.round(Math.max(0, Math.min(1, v)) * steps) / steps;

function paintGray(ctx: CanvasRenderingContext2D, w: number, h: number, f: (x: number, y: number) => number) {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = f(x, y) * 255;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const FX_PAINTERS: Record<FxTextureKind, (c: HTMLCanvasElement, ctx: CanvasRenderingContext2D, rng: Rng) => void> = {
  radial: (c, ctx) => {
    c.width = c.height = 32;
    paintGray(ctx, 32, 32, (x, y) => band((1 - Math.min(1, Math.hypot(x - 15.5, y - 15.5) / 16)) ** 2));
  },

  beam: (c, ctx) => {
    // Bright core down the middle of the card, fading toward the top (v=1).
    c.width = 16;
    c.height = 64;
    paintGray(ctx, 16, 64, (x, y) => band((1 - Math.abs(x - 7.5) / 8) ** 1.5 * (y / 63) ** 1.6, 6));
  },

  runeRing: (c, ctx, rng) => {
    c.width = c.height = 64;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#fff";
    const dot = (x: number, y: number) => ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    // Two thin circles…
    for (let a = 0; a < 360; a += 1.5) {
      const r = (a * Math.PI) / 180;
      dot(32 + Math.cos(r) * 30, 32 + Math.sin(r) * 30);
      dot(32 + Math.cos(r) * 21, 32 + Math.sin(r) * 21);
    }
    // …with little stroke glyphs marching around between them.
    for (let k = 0; k < 14; k++) {
      const r = (k / 14) * Math.PI * 2;
      const cx = 32 + Math.cos(r) * 25.5;
      const cy = 32 + Math.sin(r) * 25.5;
      for (let s = 0; s < 3; s++) {
        const dx = rng.int(-2, 2);
        const dy = rng.int(-2, 2);
        dot(cx, cy);
        dot(cx + dx / 2, cy + dy / 2);
        dot(cx + dx, cy + dy);
      }
    }
  },

  flame: (c, ctx, rng) => {
    // Four 16x32 frames: a teardrop flame whose tip licks side to side.
    c.width = 64;
    c.height = 32;
    const img = ctx.createImageData(64, 32);
    for (let f = 0; f < 4; f++) {
      const sway = [0, 1.2, -0.6, 0.8][f];
      for (let y = 0; y < 32; y++) {
        const h = 1 - y / 31; // 0 at the base, 1 at the tip
        // Rounded belly low down, tapering to a licking point.
        const profile = h < 0.25 ? 0.35 + 0.65 * Math.sqrt(h / 0.25) : ((1 - h) / 0.75) ** 0.9;
        const w = 6.5 * profile * (0.85 + rng.next() * 0.15);
        const cx = 7.5 + sway * h ** 1.5 * 2.5;
        for (let x = 0; x < 16; x++) {
          const d = Math.abs(x - cx) / Math.max(w, 0.01);
          if (d > 1) continue;
          const heat = band((1 - d) * 0.6 + (1 - h) * 0.5, 4);
          const i = (y * 64 + f * 16 + x) * 4;
          // Palette ramp: deep red rim → orange → yellow-white core.
          img.data[i] = 255 * Math.min(1, 0.55 + heat);
          img.data[i + 1] = 255 * Math.max(0, heat * 0.95 - 0.1);
          img.data[i + 2] = 255 * Math.max(0, heat - 0.7) * 2;
          img.data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },
};
