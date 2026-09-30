import type { Rng } from "../../../core/rng";
import type { Painted } from "../canvas";

/** One biome's architecture painters. Walls are 64×128 (one texture spans a
 * whole 2×4 wall face, so foot grime and ceiling soot line up), floors
 * 128×128 (2×2 tiles), ceilings 64×64. */
export interface SurfaceSet {
  /** `variant` 0 is the common wall; 1 and 2 are rarer set-pieces. */
  wall(rng: Rng, variant: number): Painted;
  floor(rng: Rng): Painted;
  ceiling(rng: Rng): Painted;
}

/** Number of wall variants every SurfaceSet paints. */
export const WALL_VARIANTS = 3;
