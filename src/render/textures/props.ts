import type { Rng } from "../../core/rng";
import { blank, put, type Painted } from "./canvas";

/** Painters for movable objects and models: crates, barrels, pots, robes
 * and the rune-carved basalt of waystones and portal steps. */

const S = 64;

export function planks(rng: Rng): Painted {
  const p = blank();
  const plankW = 10;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
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
}

export function barrel(rng: Rng): Painted {
  const p = blank();
  for (let y = 0; y < S; y++) {
    const hoop = y % 20 < 3;
    for (let x = 0; x < S; x++) {
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
}

export function ceramic(rng: Rng): Painted {
  const p = blank();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = rng.next();
      const band = y % 24 < 3 ? 0.7 : 1;
      const speckle = n > 0.94 ? 0.55 : 1;
      const v = (150 + n * 20) * band * speckle;
      put(p, x, y, v, v * 0.72, v * 0.5, 0.6 + n * 0.3);
    }
  }
  return p;
}

/** Near-grayscale so the material `color` tints the same weave into any robe. */
export function cloth(rng: Rng): Painted {
  const p = blank();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = rng.next();
      const weave = (x % 4 < 2) !== (y % 4 < 2) ? 0.86 : 1;
      const fold = Math.sin(x * 0.35 + Math.sin(y * 0.2) * 2.2) * 0.09 + 1;
      const wear = n > 0.955 ? 0.62 : 1;
      const v = 168 * weave * fold * wear + n * 22;
      put(p, x, y, v, v * 0.99, v * 1.02, 0.45 + (weave < 1 ? 0 : 0.2) + n * 0.3);
    }
  }
  return p;
}

/** Dark basalt with carved grooves, like weathered glyph rows. */
export function runestone(rng: Rng): Painted {
  const p = blank();
  const groove = (x: number, y: number) =>
    y % 11 > 7 && Math.sin(x * 0.9 + y * 4.7) > -0.35 && x % 13 !== 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
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
}
