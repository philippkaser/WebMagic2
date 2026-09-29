import { Rng, hashSeed } from "../../../core/rng";
import type { SurfaceKind } from "../kinds";
import type { Painted, SurfaceDef } from "../paint";
import { CEILINGS } from "./ceilings";
import { CERAMIC } from "./ceramic";
import { FLOORS } from "./floors";
import { GROUND } from "./ground";
import { MASONRY } from "./masonry";
import { WOOD } from "./wood";

/** The surface table: every SurfaceKind → its painter + material hints.
 * Grouped by family on disk (masonry = walls, floors, ceilings, wood,
 * ceramic, ground); a new biome is a painter in the right family plus a
 * name in kinds.ts — the type system refuses a kind without a painter. */
export const SURFACE_DEFS: Readonly<Record<SurfaceKind, SurfaceDef>> = {
  ...MASONRY,
  ...FLOORS,
  ...CEILINGS,
  ...WOOD,
  ...CERAMIC,
  ...GROUND,
};

/** Normal-map strength when a def doesn't override it. */
export const DEFAULT_NORMAL_STRENGTH = 2.2;

/** Paint a surface. Pure and deterministic: the RNG is seeded from the kind's
 * name, so every client (and every test run) gets identical bytes. */
export function paintSurface(kind: SurfaceKind): Painted {
  return SURFACE_DEFS[kind].paint(new Rng(hashSeed(kind)));
}
