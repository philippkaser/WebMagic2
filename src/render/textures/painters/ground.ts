import type { Rng } from "../../../core/rng";
import type { GroundSurface } from "../kinds";
import { TEX_SIZE as S, blank, put, type SurfaceDef } from "../paint";

/** Outdoor ground painters (the village). (Unchanged.) */

/** Trodden dirt with tufts of grass. */
function dirt(rng: Rng) {
  const p = blank();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = rng.next();
      const grass = n > 0.72;
      const v = 44 + n * 22;
      if (grass) put(p, x, y, v * 0.7, v * 1.15, v * 0.5, 0.5 + n * 0.4);
      else put(p, x, y, v * 1.05, v * 0.82, v * 0.55, 0.4 + n * 0.4);
    }
  }
  return p;
}

export const GROUND: Record<GroundSurface, SurfaceDef> = {
  dirt: { paint: dirt, hints: { roughness: 0.95, metalness: 0, envMapIntensity: 1 } },
};
