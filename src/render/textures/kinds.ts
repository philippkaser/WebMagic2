/** Every paintable surface, grouped by where it goes.
 *
 * The names are a contract: the biome table (world/biomes.ts) picks one wall,
 * one floor and one ceiling kind per depth band by these exact strings (a
 * ceiling may also be a wall kind — a vault is coursed stone too).
 *
 * Architecture surfaces (walls, floors, ceilings) are 128² and mapped from
 * WORLD position at ARCHITECTURE.texMetres per repeat in both directions
 * (see render/models/architectureMesh.ts), so a texel is square in the world
 * on every face, courses run on unbroken from one wall tile to the next, and
 * nothing may assume "the bottom of the texture is the floor" — a painter
 * that wants height-dependent wear leaves it to the wall material's damp
 * band (render/models/wallMaterial.ts) instead. */

export const WALL_SURFACES = ["tomb", "wetstone", "basalt", "slate", "palestone"] as const;
export const FLOOR_SURFACES = ["flagstone", "wetslab", "obsidian", "polished", "ashflag"] as const;
export const CEILING_SURFACES = ["void"] as const;
/** Breakable props and fixtures (pedestal, portal ring, graves, rune
 * tablets, village huts) — 64², mapped per object. */
export const PROP_SURFACES = ["planks", "barrel", "ceramic", "stone", "slab"] as const;
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

/** The dungeon's architecture surfaces — 128², world-mapped, mipmapped. */
export const ARCH_SURFACES: readonly SurfaceKind[] = [
  ...WALL_SURFACES,
  ...FLOOR_SURFACES,
  ...CEILING_SURFACES,
];

export const SURFACE_KINDS: readonly SurfaceKind[] = [
  ...WALL_SURFACES,
  ...FLOOR_SURFACES,
  ...CEILING_SURFACES,
  ...PROP_SURFACES,
  ...GROUND_SURFACES,
];
