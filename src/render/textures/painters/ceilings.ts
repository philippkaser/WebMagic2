import type { Rng } from "../../../core/rng";
import type { CeilingSurface } from "../kinds";
import { ARCH_SIZE as S, blank, layeredNoise, put, setRoughness, type SurfaceDef } from "../paint";

/** Ceiling painters. Most biomes vault their halls in their own wall stone
 * (a ceiling is coursed stone too — see world/biomes.ts); this is the one
 * ceiling that is NOT stone. */

/** The Hollow's night: a ceiling that barely seems to be there — near-black
 * with slow cold swirls and a few dim pinpricks, like looking up into an
 * overcast night. Gently undulating height, so a passing spell-light
 * slides across it like something moving overhead. */
function voidCeiling(rng: Rng) {
  const p = blank(S, { roughness: true });
  const swirl = layeredNoise(rng, S, [[3, 1], [6, 0.5], [16, 0.3]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const s = swirl[i];
      if (n > 0.9975) {
        put(p, x, y, 70, 76, 96, 0.6);
        setRoughness(p, x, y, 0.3);
        continue;
      }
      const v = 6 + s * 10 + n * 2;
      put(p, x, y, v * 0.9, v * 0.95, v * 1.3, s * 0.8 + n * 0.06);
      setRoughness(p, x, y, 0.95);
    }
  }
  return p;
}

export const CEILINGS: Record<CeilingSurface, SurfaceDef> = {
  void: {
    paint: voidCeiling,
    hints: { roughness: 1, metalness: 0, envMapIntensity: 0.15 },
    normalStrength: 3,
    mipmaps: true,
  },
};
