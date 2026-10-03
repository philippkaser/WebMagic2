import { Rng, hashSeed } from "../../core/rng";
import { blank, put, toMaps, type Painted, type PixelMaps } from "../textures/pixelKit";

/** Procedural pixel textures for the hand-built models (staffs, wizards,
 * items, props, chests, altars). Same recipe as the world surfaces — a tiny
 * painted color field plus a normal map from a height field, NearestFilter
 * throughout so the chunky texels survive the low-dpr canvas — but small
 * (32–64 px) and tuned to read on objects a metre across.
 *
 * `cloth` is near-grayscale so a material `color` tints the same weave into
 * any robe; `glyphs` is special: a black field with bright carved runes, used
 * as an emissiveMap so any stone glows with writing in its material's color. */

export type ModelTextureKind =
  | "bark" // staff shafts, torch hafts — vertical grain, knots
  | "iron" // bands, corners, cages — scratched dark metal with rivets
  | "bone" // skulls, bones — pitted ivory
  | "leather" // grips, boots, pouches — creased hide
  | "cloth" // robes, cloaks, awnings — tintable weave
  | "planks" // crates, chests, counters
  | "barrel" // staves and hoops
  | "ceramic" // pots
  | "runestone" // altars, standing stones — basalt with carved grooves
  | "glyphs"; // emissive rune rows (black = off)

const SIZES: Record<ModelTextureKind, number> = {
  bark: 32,
  iron: 32,
  bone: 32,
  leather: 32,
  cloth: 64,
  planks: 64,
  barrel: 64,
  ceramic: 64,
  runestone: 64,
  glyphs: 64,
};

const cache = new Map<ModelTextureKind, PixelMaps>();

export function getModelTextures(kind: ModelTextureKind): PixelMaps {
  let hit = cache.get(kind);
  if (!hit) {
    const size = SIZES[kind];
    const p = blank(size, size);
    PAINTERS[kind](p, new Rng(hashSeed(`model:${kind}`)));
    hit = toMaps(p);
    cache.set(kind, hit);
  }
  return hit;
}

const PAINTERS: Record<ModelTextureKind, (p: Painted, rng: Rng) => void> = {
  bark: (p, rng) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
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
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
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
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const n = rng.next();
        const pit = n > 0.92 ? 0.7 : 1;
        const v = (196 + n * 30) * pit;
        put(p, x, y, v, v * 0.93, v * 0.78, pit < 1 ? 0.3 : 0.6 + n * 0.2);
      }
    }
  },

  leather: (p, rng) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const n = rng.next();
        const crease = Math.sin(x * 0.8 + y * 0.45 + Math.sin(y * 0.9) * 2) > 0.9 ? 0.72 : 1;
        const v = (150 + n * 30) * crease;
        put(p, x, y, v, v * 0.97, v * 0.95, crease < 1 ? 0.25 : 0.55 + n * 0.25);
      }
    }
  },

  cloth: (p, rng) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const n = rng.next();
        const weave = (x % 4 < 2) !== (y % 4 < 2) ? 0.86 : 1;
        const fold = Math.sin(x * 0.35 + Math.sin(y * 0.2) * 2.2) * 0.09 + 1;
        const wear = n > 0.955 ? 0.62 : 1;
        const v = 168 * weave * fold * wear + n * 22;
        put(p, x, y, v, v * 0.99, v * 1.02, 0.45 + (weave < 1 ? 0 : 0.2) + n * 0.3);
      }
    }
  },

  planks: (p, rng) => {
    const plankW = 10;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const n = rng.next();
        if (x % plankW === 0) {
          put(p, x, y, 38, 26, 14, 0.2);
          continue;
        }
        const plank = Math.floor(x / plankW);
        const grain = Math.sin(y * 0.7 + plank * 13) > 0.82 ? 0.72 : 1;
        const v = (108 + n * 26 + (plank % 3) * 10) * grain;
        put(p, x, y, v, v * 0.66, v * 0.36, 0.5 + n * 0.4);
      }
    }
  },

  barrel: (p, rng) => {
    for (let y = 0; y < p.h; y++) {
      const hoop = y % 20 < 3;
      for (let x = 0; x < p.w; x++) {
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
  },

  ceramic: (p, rng) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const n = rng.next();
        const band = y % 24 < 3 ? 0.7 : 1;
        const speckle = n > 0.94 ? 0.55 : 1;
        const v = (150 + n * 20) * band * speckle;
        put(p, x, y, v, v * 0.72, v * 0.5, 0.6 + n * 0.3);
      }
    }
  },

  runestone: (p, rng) => {
    const groove = (x: number, y: number) => y % 11 > 7 && Math.sin(x * 0.9 + y * 4.7) > -0.35 && x % 13 !== 0;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
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
  },

  glyphs: (p, rng) => {
    // Rows of 5x7 cells, each a random stroke glyph: a vertical stem plus a
    // few branches — reads as "runes" at any size without being a real script.
    for (let i = 0; i < p.color.length; i += 4) p.color[i + 3] = 255;
    const stroke = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < p.w && y < p.h) put(p, x, y, 255, 255, 255, 0);
    };
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 9; col++) {
        const ox = 2 + col * 7;
        const oy = 2 + row * 9;
        if (rng.next() < 0.12) continue; // word gaps
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
