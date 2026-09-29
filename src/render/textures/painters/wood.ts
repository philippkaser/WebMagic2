import type { Rng } from "../../../core/rng";
import { TEX_SIZE as S, blank, put, type SurfaceDef } from "../paint";

/** Wood painters: crate planks and barrel staves. (Unchanged.) */

function planks(rng: Rng) {
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

function barrel(rng: Rng) {
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

export const WOOD: Record<"planks" | "barrel", SurfaceDef> = {
  planks: { paint: planks, hints: { roughness: 0.85, metalness: 0, envMapIntensity: 1 } },
  barrel: { paint: barrel, hints: { roughness: 0.75, metalness: 0.15, envMapIntensity: 1 } },
};
