import {
  CanvasTexture,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { Rng, hashSeed } from "../core/rng";

/** Procedural pixel-art textures. Every surface in the game is generated at
 * runtime on small canvases (no binary assets): a color map plus a normal map
 * derived from a height field, so the chunky pixels still catch light. */

export type TextureKind =
  | "stone" // dungeon walls — rough bricks
  | "slab" // dungeon floor — big worn slabs
  | "dark" // ceiling
  | "planks" // crates
  | "barrel"
  | "ceramic" // pots
  | "dirt" // village ground
  | "cloth" // wizard robes — grayscale weave, tinted by material color
  | "runestone"; // waystone / portal steps — dark basalt with carved grooves

export interface TexturePair {
  map: CanvasTexture;
  normalMap: CanvasTexture;
}

const SIZE = 64;
const cache = new Map<string, TexturePair>();

export function getTextures(kind: TextureKind, repeatX = 1, repeatY = 1): TexturePair {
  const key = `${kind}:${repeatX}:${repeatY}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rng = new Rng(hashSeed(kind));
  const { color, height } = PAINTERS[kind](rng);

  const map = toTexture(color, true, repeatX, repeatY);
  const normalMap = toTexture(heightToNormal(height, 2.2), false, repeatX, repeatY);
  const pair = { map, normalMap };
  cache.set(key, pair);
  return pair;
}

interface Painted {
  color: Uint8ClampedArray<ArrayBuffer>; // rgba SIZE*SIZE
  height: Float32Array; // 0..1
}

type Painter = (rng: Rng) => Painted;

function blank(): Painted {
  return {
    color: new Uint8ClampedArray(SIZE * SIZE * 4),
    height: new Float32Array(SIZE * SIZE),
  };
}

function put(p: Painted, x: number, y: number, r: number, g: number, b: number, h: number) {
  const i = (y * SIZE + x) * 4;
  p.color[i] = r;
  p.color[i + 1] = g;
  p.color[i + 2] = b;
  p.color[i + 3] = 255;
  p.height[y * SIZE + x] = h;
}

const PAINTERS: Record<TextureKind, Painter> = {
  stone: (rng) => {
    const p = blank();
    const brickH = 8;
    const brickW = 16;
    for (let y = 0; y < SIZE; y++) {
      const row = Math.floor(y / brickH);
      const offset = (row % 2) * (brickW / 2);
      for (let x = 0; x < SIZE; x++) {
        const bx = (x + offset) % brickW;
        const mortar = y % brickH === 0 || bx === 0;
        const n = rng.next();
        if (mortar) {
          const v = 26 + n * 14;
          put(p, x, y, v, v * 0.95, v * 1.05, 0.18);
        } else {
          const base = 68 + n * 34 + (((row * 7 + Math.floor((x + offset) / brickW)) % 5) - 2) * 9;
          const crack = n > 0.965;
          const v = crack ? base * 0.45 : base;
          put(p, x, y, v * 0.92, v * 0.9, v, crack ? 0.4 : 0.65 + rng.next() * 0.3);
        }
      }
    }
    return p;
  },

  slab: (rng) => {
    const p = blank();
    const cell = 16;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const gap = x % cell === 0 || y % cell === 0;
        const n = rng.next();
        if (gap) {
          const v = 20 + n * 10;
          put(p, x, y, v, v, v * 1.1, 0.15);
        } else {
          const slabTint = ((Math.floor(x / cell) * 3 + Math.floor(y / cell) * 5) % 4) * 6;
          const stain = n > 0.93 ? 0.6 : 1;
          const v = (52 + n * 26 + slabTint) * stain;
          put(p, x, y, v * 0.9, v * 0.92, v, 0.55 + n * 0.35);
        }
      }
    }
    return p;
  },

  dark: (rng) => {
    const p = blank();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = rng.next();
        const v = 12 + n * 12;
        put(p, x, y, v, v, v * 1.15, n);
      }
    }
    return p;
  },

  planks: (rng) => {
    const p = blank();
    const plankW = 10;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const seam = x % plankW === 0;
        const n = rng.next();
        if (seam) {
          put(p, x, y, 38, 26, 14, 0.2);
        } else {
          const plank = Math.floor(x / plankW);
          const grain = Math.sin(y * 0.7 + plank * 13) > 0.82 ? 0.72 : 1;
          const v = (108 + n * 26 + (plank % 3) * 10) * grain;
          put(p, x, y, v, v * 0.66, v * 0.36, 0.5 + n * 0.4);
        }
      }
    }
    return p;
  },

  barrel: (rng) => {
    const p = blank();
    for (let y = 0; y < SIZE; y++) {
      const hoop = y % 20 < 3;
      for (let x = 0; x < SIZE; x++) {
        const n = rng.next();
        if (hoop) {
          const v = 70 + n * 30;
          put(p, x, y, v, v * 1.02, v * 1.12, 0.85);
        } else {
          const stave = Math.floor(x / 8);
          const v = 96 + n * 22 + (stave % 3) * 8;
          put(p, x, y, v, v * 0.6, v * 0.32, 0.5 + n * 0.3);
        }
      }
    }
    return p;
  },

  ceramic: (rng) => {
    const p = blank();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = rng.next();
        const band = y % 24 < 3 ? 0.7 : 1;
        const speckle = n > 0.94 ? 0.55 : 1;
        const v = (150 + n * 20) * band * speckle;
        put(p, x, y, v, v * 0.72, v * 0.5, 0.6 + n * 0.3);
      }
    }
    return p;
  },

  dirt: (rng) => {
    const p = blank();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = rng.next();
        const grass = n > 0.72;
        const v = 44 + n * 22;
        if (grass) put(p, x, y, v * 0.7, v * 1.15, v * 0.5, 0.5 + n * 0.4);
        else put(p, x, y, v * 1.05, v * 0.82, v * 0.55, 0.4 + n * 0.4);
      }
    }
    return p;
  },

  // Near-grayscale so the material `color` tints the same weave into any robe.
  cloth: (rng) => {
    const p = blank();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = rng.next();
        const weave = (x % 4 < 2) !== (y % 4 < 2) ? 0.86 : 1;
        const fold = Math.sin(x * 0.35 + Math.sin(y * 0.2) * 2.2) * 0.09 + 1;
        const wear = n > 0.955 ? 0.62 : 1;
        const v = 168 * weave * fold * wear + n * 22;
        put(p, x, y, v, v * 0.99, v * 1.02, 0.45 + (weave < 1 ? 0 : 0.2) + n * 0.3);
      }
    }
    return p;
  },

  runestone: (rng) => {
    const p = blank();
    // Carved groove pattern: broken horizontal channels, like weathered glyph rows.
    const groove = (x: number, y: number) =>
      y % 11 > 7 && Math.sin(x * 0.9 + y * 4.7) > -0.35 && x % 13 !== 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = rng.next();
        if (groove(x, y)) {
          const v = 14 + n * 8;
          put(p, x, y, v, v * 1.05, v * 1.3, 0.12);
        } else {
          const fleck = n > 0.96 ? 1.9 : 1;
          const v = (30 + n * 16) * fleck;
          put(p, x, y, v * 0.95, v * 0.97, v * 1.12, 0.6 + n * 0.3);
        }
      }
    }
    return p;
  },
};

function heightToNormal(height: Float32Array, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  const h = (x: number, y: number) =>
    height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
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
  srgb: boolean,
  repeatX: number,
  repeatY: number,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}
