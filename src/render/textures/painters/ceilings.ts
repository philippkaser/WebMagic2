import type { Rng } from "../../../core/rng";
import type { CeilingSurface } from "../kinds";
import { TEX_SIZE as S, blank, put, tileNoise, type SurfaceDef } from "../paint";

/** Ceiling painters. Ceilings sit at the edge of the light, so they're about
 * texture in the gloom, not detail. */

/** Catacombs: near-black rock grain. (Unchanged — the original ceiling.) */
function dark(rng: Rng) {
  const p = blank();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = rng.next();
      const v = 12 + n * 12;
      put(p, x, y, v, v, v * 1.15, n);
    }
  }
  return p;
}

/** The deep bands: a ceiling that barely seems to be there — near-black with
 * slow violet swirls and a few dim pinpricks. Gently undulating height, so
 * a passing spell-light slides across it like something moving overhead. */
function voidCeiling(rng: Rng) {
  const p = blank();
  const swirl = tileNoise(rng, 4);
  const fine = tileNoise(rng, 16);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const s = swirl[i] * 0.7 + fine[i] * 0.3;
      if (n > 0.993) {
        put(p, x, y, 58, 48, 92, 0.6);
        continue;
      }
      const v = 5 + s * 11 + n * 4;
      put(p, x, y, v * 0.95, v * 0.75, v * 1.55, s * 0.8 + n * 0.12);
    }
  }
  return p;
}

export const CEILINGS: Record<CeilingSurface, SurfaceDef> = {
  dark: { paint: dark, hints: { roughness: 0.95, metalness: 0, envMapIntensity: 1 } },
  void: {
    paint: voidCeiling,
    hints: { roughness: 0.96, metalness: 0, envMapIntensity: 0.2 },
    normalStrength: 3,
  },
};
