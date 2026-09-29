import type { Rng } from "../../../core/rng";
import { TEX_SIZE as S, blank, put, type SurfaceDef } from "../paint";

/** Ceramic painters: glazed terracotta pots. (Unchanged.) */

function ceramic(rng: Rng) {
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

export const CERAMIC: Record<"ceramic", SurfaceDef> = {
  ceramic: { paint: ceramic, hints: { roughness: 0.6, metalness: 0, envMapIntensity: 1 } },
};
