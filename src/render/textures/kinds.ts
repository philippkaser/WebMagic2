import { SURFACE_SETS, type SurfaceSetId } from "./surfaces/types";

/** Every paintable surface, grouped by where it goes.
 *
 * Architecture kinds are `<set>-<part>`: one surface set per depth band
 * (world/biomes.ts picks one), each with a wall atlas, a floor and a
 * ceiling (see surfaces/). Props and village kinds are the artpass
 * painters, plus `stone` (pedestal, huts) and `slab` (graves, lore tablets,
 * the portal frame — an alias of `runestone` kept for those call sites). */

export type WallSurface = `${SurfaceSetId}-wall`;
export type FloorSurface = `${SurfaceSetId}-floor`;
export type CeilingSurface = `${SurfaceSetId}-ceiling`;

export const WALL_SURFACES: readonly WallSurface[] = SURFACE_SETS.map((s) => `${s}-wall` as const);
export const FLOOR_SURFACES: readonly FloorSurface[] = SURFACE_SETS.map((s) => `${s}-floor` as const);
export const CEILING_SURFACES: readonly CeilingSurface[] = SURFACE_SETS.map((s) => `${s}-ceiling` as const);

/** Breakable props, fixtures and model parts — 64², mapped per object. */
export const PROP_SURFACES = ["planks", "barrel", "ceramic", "cloth", "runestone", "stone", "slab"] as const;
/** The village above: night grass, cobbles, half-timbering, shingles, bark
 * and warm leaded windows. */
export const VILLAGE_SURFACES = ["dirt", "cobble", "timber", "shingles", "bark", "window"] as const;

export type PropSurface = (typeof PROP_SURFACES)[number];
export type VillageSurface = (typeof VILLAGE_SURFACES)[number];
export type ArchSurface = WallSurface | FloorSurface | CeilingSurface;

/** Any painted surface. Every kind ships its recommended material alongside
 * its maps (see getSurface), so SurfaceKind and TextureKind name the same
 * set — use SurfaceKind when you mean "a material", TextureKind when you
 * just want the maps. */
export type SurfaceKind = ArchSurface | PropSurface | VillageSurface;

/** Kept for existing call sites: `getTextures(kind)`. */
export type TextureKind = SurfaceKind;

/** The dungeon's architecture surfaces. */
export const ARCH_SURFACES: readonly ArchSurface[] = [...WALL_SURFACES, ...FLOOR_SURFACES, ...CEILING_SURFACES];

export const SURFACE_KINDS: readonly SurfaceKind[] = [...ARCH_SURFACES, ...PROP_SURFACES, ...VILLAGE_SURFACES];

/** The three architecture kinds of a surface set. */
export function setSurfaces(set: SurfaceSetId): { wall: WallSurface; floor: FloorSurface; ceiling: CeilingSurface } {
  return { wall: `${set}-wall`, floor: `${set}-floor`, ceiling: `${set}-ceiling` };
}

/** Split an architecture kind back into its set and part (null for props). */
export function archPart(kind: SurfaceKind): { set: SurfaceSetId; part: "wall" | "floor" | "ceiling" } | null {
  const dash = kind.lastIndexOf("-");
  if (dash < 0) return null;
  const set = kind.slice(0, dash) as SurfaceSetId;
  const part = kind.slice(dash + 1);
  if (!SURFACE_SETS.includes(set)) return null;
  if (part !== "wall" && part !== "floor" && part !== "ceiling") return null;
  return { set, part };
}
