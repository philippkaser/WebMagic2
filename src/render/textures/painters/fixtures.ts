import type { Rng } from "../../../core/rng";
import { TEX_SIZE as S, blank, put, type SurfaceDef } from "../paint";

/** Carved-stone painters for props and fixtures: the treasure pedestal, the
 * portal ring, graves, lore tablets and the village huts. These were the
 * original catacomb wall and floor; the dungeon's architecture has its own
 * big-stone surfaces now (masonry.ts, floors.ts), but small carved things
 * still want this tight, busy 64² grain — it reads as "worked stone" at the
 * size of a pedestal. (Byte-identical to the originals: the tests pin it.) */

/** Rough grey-violet brick with rare cracks. */
function stone(rng: Rng) {
  const p = blank();
  const brickH = 8;
  const brickW = 16;
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / brickH);
    const offset = (row % 2) * (brickW / 2);
    for (let x = 0; x < S; x++) {
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
}

/** Big worn slabs in a grid. */
function slab(rng: Rng) {
  const p = blank();
  const cell = 16;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
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
}

export const FIXTURES: Record<"stone" | "slab", SurfaceDef> = {
  stone: { paint: stone, hints: { roughness: 0.88, metalness: 0.06, envMapIntensity: 0.4 } },
  slab: { paint: slab, hints: { roughness: 0.6, metalness: 0.18, envMapIntensity: 0.75 } },
};
