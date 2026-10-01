import { Rng, hashSeed } from "../../../core/rng";
import { blank, blit, type Painted } from "../canvas";
import { abyss } from "./abyss";
import { catacombs } from "./catacombs";
import { crystal } from "./crystal";
import { drowned } from "./drowned";
import { forge } from "./forge";
import { WALL_TEX_H, WALL_TEX_W, WALL_VARIANTS, type SurfaceSet, type SurfaceSetId } from "./types";

export * from "./types";

/** Every surface set by id. */
export const SURFACES: Readonly<Record<SurfaceSetId, SurfaceSet>> = { catacombs, drowned, forge, crystal, abyss };

export type SurfacePart = "wall" | "floor" | "ceiling";

/** Paint one part of a set. Walls come back as the variant ATLAS: the
 * WALL_VARIANTS walls side by side, each WALL_TEX_W wide, so a floor's walls
 * share one texture and one material. Each variant is painted from its own
 * seeded stream (the artpass seeds), so every client gets identical bytes. */
export function paintSurfacePart(set: SurfaceSetId, part: SurfacePart): Painted {
  const painters = SURFACES[set];
  if (part === "floor") return painters.floor(new Rng(hashSeed(`${set}/floor/0`)));
  if (part === "ceiling") return painters.ceiling(new Rng(hashSeed(`${set}/ceiling/0`)));
  let atlas: Painted | null = null;
  for (let v = 0; v < WALL_VARIANTS; v++) {
    const p = painters.wall(new Rng(hashSeed(`${set}/wall/${v}`)), v);
    atlas ??= blank(WALL_TEX_W * WALL_VARIANTS, WALL_TEX_H, { rough: p.rough !== null, emit: p.emit !== null });
    blit(atlas, p, v * WALL_TEX_W, 0);
  }
  return atlas!;
}

/** The u range of wall variant `v` in the atlas, pulled in by a quarter
 * texel so Nearest sampling at a face's very edge never reads the
 * neighbouring variant's column. */
export function wallAtlasU(v: number): [number, number] {
  const w = WALL_TEX_W * WALL_VARIANTS;
  const inset = 0.25 / w;
  return [v / WALL_VARIANTS + inset, (v + 1) / WALL_VARIANTS - inset];
}
