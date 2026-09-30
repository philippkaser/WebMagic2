import type { CanvasTexture } from "three";
import { Rng, hashSeed } from "../../core/rng";
import type { BiomeId } from "../../world/biomes";
import { heightToNormal, scalarToRgba, toTexture, type Painted } from "./canvas";
import { barrel, ceramic, cloth, planks, runestone } from "./props";
import { abyss } from "./surfaces/abyss";
import { catacombs } from "./surfaces/catacombs";
import { crystal } from "./surfaces/crystal";
import { drowned } from "./surfaces/drowned";
import { forge } from "./surfaces/forge";
import type { SurfaceSet } from "./surfaces/types";
import { bark, cobble, dirt, shingles, timber, windowPane } from "./village";

/** Procedural pixel-art textures. Every surface in the game is generated at
 * runtime on small canvases (no binary assets): a color map plus a normal map
 * derived from a height field, so the chunky pixels still catch light —
 * and, where a painter provides them, roughness and emissive maps. */

export { WALL_VARIANTS } from "./surfaces/types";

export type TextureKind =
  | "planks" // crates
  | "barrel"
  | "ceramic" // pots
  | "cloth" // wizard robes — grayscale weave, tinted by material color
  | "runestone" // waystone / portal steps — dark basalt with carved grooves
  | "dirt" // village ground
  | "cobble" // village paths
  | "timber" // half-timbered cottage walls
  | "shingles" // cottage roofs
  | "bark"
  | "window";

export interface TexturePair {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  /** Present when the painter varies roughness (wet stone, glossy veins). */
  roughnessMap?: CanvasTexture;
  /** Present when the surface glows; use with emissive="#fff". */
  emissiveMap?: CanvasTexture;
}

const PAINTERS: Record<TextureKind, (rng: Rng) => Painted> = {
  planks,
  barrel,
  ceramic,
  cloth,
  runestone,
  dirt,
  cobble,
  timber,
  shingles,
  bark,
  window: windowPane,
};

const SURFACES: Record<BiomeId, SurfaceSet> = { catacombs, drowned, forge, crystal, abyss };

export type SurfacePart = "wall" | "floor" | "ceiling";

const cache = new Map<string, TexturePair>();

export function getTextures(kind: TextureKind, repeatX = 1, repeatY = 1): TexturePair {
  return cached(`${kind}:${repeatX}:${repeatY}`, () => PAINTERS[kind](new Rng(hashSeed(kind))), repeatX, repeatY);
}

/** A biome's architecture textures. Walls come in WALL_VARIANTS flavors
 * (0 = common, 1–2 = set-pieces) so long runs don't read as one tile. */
export function getSurface(
  biome: BiomeId,
  part: SurfacePart,
  variant = 0,
  repeatX = 1,
  repeatY = 1,
): TexturePair {
  return cached(
    `${biome}/${part}/${variant}:${repeatX}:${repeatY}`,
    () => {
      const rng = new Rng(hashSeed(`${biome}/${part}/${variant}`));
      const set = SURFACES[biome];
      return part === "wall" ? set.wall(rng, variant) : part === "floor" ? set.floor(rng) : set.ceiling(rng);
    },
    repeatX,
    repeatY,
  );
}

function cached(key: string, paint: () => Painted, repeatX: number, repeatY: number): TexturePair {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = paint();
  const pair: TexturePair = {
    map: toTexture(p.color, p.w, p.h, true, repeatX, repeatY),
    normalMap: toTexture(heightToNormal(p, 2.4), p.w, p.h, false, repeatX, repeatY),
  };
  if (p.rough) pair.roughnessMap = toTexture(scalarToRgba(p.rough, p.w, p.h), p.w, p.h, false, repeatX, repeatY);
  if (p.emit) pair.emissiveMap = toTexture(p.emit, p.w, p.h, true, repeatX, repeatY);
  cache.set(key, pair);
  return pair;
}
