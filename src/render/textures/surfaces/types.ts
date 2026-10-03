import type { Rng } from "../../../core/rng";
import { TILE, WALL_HEIGHT } from "../../../core/config";
import type { Painted } from "../canvas";

/** One depth band's architecture painters — the artpass "surface set".
 *
 * Every surface is painted at the same density, TEXELS_PER_METRE, and the
 * dungeon mesh maps it 1:1 onto the world, so a texel is square on walls,
 * floors and ceilings alike:
 *  - a wall is one tile wide and the whole wall tall: WALL_TEX_W ×
 *    WALL_TEX_H. One texture spans a full face, so the composition reads
 *    top to bottom — soot or moss curtains under the vault, grime, a tide
 *    line or a heat wash at the foot;
 *  - a floor is FLOOR_TEX² over FLOOR_SPAN metres, a ceiling CEIL_TEX² over
 *    CEIL_SPAN metres, both world-mapped. */
export interface SurfaceSet {
  /** `variant` 0 is the common wall; 1 and 2 are rarer set-pieces. */
  wall(rng: Rng, variant: number): Painted;
  floor(rng: Rng): Painted;
  ceiling(rng: Rng): Painted;
}

/** The five painted looks, named for the artpass biomes they came from. Our
 * bands pick one each (world/biomes.ts): the Hollow wears the abyss. */
export const SURFACE_SETS = ["catacombs", "drowned", "forge", "crystal", "abyss"] as const;
export type SurfaceSetId = (typeof SURFACE_SETS)[number];

export const TEXELS_PER_METRE = 32;
/** A wall texture spans one tile's face… */
export const WALL_TEX_W = Math.round(TILE * TEXELS_PER_METRE);
/** …and the full wall height, so the texels stay square however tall the
 * halls are. */
export const WALL_TEX_H = Math.round(WALL_HEIGHT * TEXELS_PER_METRE);
export const FLOOR_TEX = 128;
export const FLOOR_SPAN = FLOOR_TEX / TEXELS_PER_METRE;
export const CEIL_TEX = 64;
export const CEIL_SPAN = CEIL_TEX / TEXELS_PER_METRE;

/** Number of wall variants every SurfaceSet paints. They sit side by side
 * in one atlas (WALL_VARIANTS × WALL_TEX_W wide), so every wall of a floor
 * is still one material and one draw. */
export const WALL_VARIANTS = 3;
/** Share of wall faces drawing each variant: mostly plain masonry, the
 * set-pieces (niches, geodes, eyes…) rare enough to stay special. */
export const VARIANT_WEIGHTS: readonly number[] = [0.72, 0.16, 0.12];

/** The artpass walls were painted 128 px tall for a 4 m wall. Features
 * anchored to the FLOOR (a tide line, a burial niche at chest height, an
 * iron strap) keep their height above the floor on our taller walls;
 * features hanging from the vault scale with the wall. */
export const REF_WALL_PX = 128;

/** A row measured on the artpass 128 px wall, moved to the same height
 * above the floor on this wall. */
export function foot(p: Painted, y: number): number {
  return p.h - REF_WALL_PX + y;
}

/** A height fraction on the artpass wall (e.g. 0.78 = the tide line), moved
 * to the same height above the floor on this wall. */
export function footFrac(p: Painted, f: number): number {
  return 1 - ((1 - f) * REF_WALL_PX) / p.h;
}

/** How much taller this wall is than the artpass one — scales counts of
 * scattered features (cracks, drips) so the density per metre holds. */
export function tallness(p: Painted): number {
  return p.h / REF_WALL_PX;
}
