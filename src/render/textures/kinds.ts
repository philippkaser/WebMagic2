/** Every paintable surface, grouped by where it goes.
 *
 * The names are a contract: the biome table (world/biomes.ts) picks one wall,
 * one floor and one ceiling kind per depth band by these exact strings.
 * "stone"/"slab"/"dark" are the catacombs set; each deeper biome adds its own
 * wall + floor, and the void ceiling is shared by the deep bands.
 *
 * Wall painters assume one texture spans a wall face floor-to-ceiling
 * (repeatY = 1 on a TILE × WALL_HEIGHT face, so texels are twice as tall in
 * the world as they are wide). That's why vertical features — the drowned
 * waterline, forge heat rising from below — sit at the texture's bottom. */

export const WALL_SURFACES = ["stone", "wetstone", "basalt", "crystal", "bone"] as const;
export const FLOOR_SURFACES = ["slab", "wetslab", "ashslab", "crystalslab", "boneslab"] as const;
export const CEILING_SURFACES = ["dark", "void"] as const;
/** Breakable props and village fixtures. */
export const PROP_SURFACES = ["planks", "barrel", "ceramic"] as const;
/** Outdoor ground (village). */
export const GROUND_SURFACES = ["dirt"] as const;

export type WallSurface = (typeof WALL_SURFACES)[number];
export type FloorSurface = (typeof FLOOR_SURFACES)[number];
export type CeilingSurface = (typeof CEILING_SURFACES)[number];
export type PropSurface = (typeof PROP_SURFACES)[number];
export type GroundSurface = (typeof GROUND_SURFACES)[number];

/** Any painted surface. Every kind ships its recommended material alongside
 * its maps (see getSurface), so SurfaceKind and TextureKind name the same
 * set — use SurfaceKind when you mean "a material", TextureKind when you
 * just want the maps. */
export type SurfaceKind = WallSurface | FloorSurface | CeilingSurface | PropSurface | GroundSurface;

/** Kept for existing call sites: `getTextures(kind)`. */
export type TextureKind = SurfaceKind;

export const SURFACE_KINDS: readonly SurfaceKind[] = [
  ...WALL_SURFACES,
  ...FLOOR_SURFACES,
  ...CEILING_SURFACES,
  ...PROP_SURFACES,
  ...GROUND_SURFACES,
];
