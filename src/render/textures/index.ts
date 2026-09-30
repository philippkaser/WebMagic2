import type { CanvasTexture } from "three";
import { toTexture } from "./canvas";
import type { SurfaceKind, TextureKind } from "./kinds";
import { heightToNormal, packRoughness } from "./normalMap";
import type { Painted, SurfaceHints } from "./paint";
import { paintGlyphAtlas, paintRuneTablet, RUNE_TABLET_SIZE } from "./painters/glyphs";
import { DEFAULT_NORMAL_STRENGTH, SURFACE_DEFS, paintSurface } from "./painters";

/** Procedural pixel-art textures. Every surface in the game is generated at
 * runtime on small canvases (no binary assets): a color map plus a normal map
 * derived from a height field, so the chunky pixels still catch light — and
 * roughness maps on all the architecture (wet, polished and glassy stone
 * that glints), plus emissive maps where a painter asks for one (runes).
 *
 * Layout:
 *  - kinds.ts         the surface names (a contract with the biome table)
 *  - paint.ts         pure buffer toolkit painters share
 *  - painters/        pure painters by family + the SURFACE_DEFS table
 *  - normalMap.ts     height → Sobel normal map, roughness packing
 *  - canvas.ts        the only DOM code: buffer → CanvasTexture
 *  - index.ts (here)  caching and the public API */

export type {
  CeilingSurface,
  FloorSurface,
  GroundSurface,
  PropSurface,
  SurfaceKind,
  TextureKind,
  WallSurface,
} from "./kinds";
export {
  CEILING_SURFACES,
  FLOOR_SURFACES,
  GROUND_SURFACES,
  PROP_SURFACES,
  SURFACE_KINDS,
  WALL_SURFACES,
} from "./kinds";
export type { SurfaceHints } from "./paint";

export interface TexturePair {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  /** Only on kinds whose painter makes a glow layer. Needs a non-black
   * `emissive` on the material to show — getSurface's hints carry it. */
  emissiveMap?: CanvasTexture;
  /** On every architecture kind (walls, floors, ceilings). three.js
   * multiplies it with the material's `roughness`, so pair it with the
   * hint (1). */
  roughnessMap?: CanvasTexture;
}

/** The maps as ready-to-spread meshStandardMaterial props — only the keys
 * that apply are present, so `<meshStandardMaterial {...s.material} />`
 * never sets an undefined color or map. */
export interface SurfaceMaterialProps {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  emissiveMap?: CanvasTexture;
  roughnessMap?: CanvasTexture;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface Surface extends TexturePair {
  /** Recommended material params — the look the painter was tuned under. */
  hints: SurfaceHints;
  /** Maps + hints merged, for spreading straight onto a material. */
  material: SurfaceMaterialProps;
}

/** Painted once per kind; repeat variants are clones that share the base
 * texture's `Source`, so three.js uploads each image to the GPU once no
 * matter how many repeat settings the scene asks for. */
const base = new Map<SurfaceKind, Surface>();
const variants = new Map<string, Surface>();

function buildSurface(pair: TexturePair, hints: SurfaceHints): Surface {
  const material: SurfaceMaterialProps = {
    map: pair.map,
    normalMap: pair.normalMap,
    roughness: hints.roughness,
    metalness: hints.metalness,
    envMapIntensity: hints.envMapIntensity,
  };
  if (pair.emissiveMap) material.emissiveMap = pair.emissiveMap;
  if (pair.roughnessMap) material.roughnessMap = pair.roughnessMap;
  if (hints.emissive !== undefined) material.emissive = hints.emissive;
  if (hints.emissiveIntensity !== undefined) material.emissiveIntensity = hints.emissiveIntensity;
  return { ...pair, hints, material };
}

function uploadPainted(p: Painted, normalStrength: number, mipmaps: boolean): TexturePair {
  const pair: TexturePair = {
    map: toTexture(p.color, p.size, p.size, true, mipmaps),
    normalMap: toTexture(heightToNormal(p.height, p.size, normalStrength), p.size, p.size, false, mipmaps),
  };
  if (p.emissive) pair.emissiveMap = toTexture(p.emissive, p.size, p.size, true, mipmaps);
  if (p.roughness) pair.roughnessMap = toTexture(packRoughness(p.roughness), p.size, p.size, false, mipmaps);
  return pair;
}

function baseSurface(kind: SurfaceKind): Surface {
  const hit = base.get(kind);
  if (hit) return hit;
  const def = SURFACE_DEFS[kind];
  const surface = buildSurface(
    uploadPainted(paintSurface(kind), def.normalStrength ?? DEFAULT_NORMAL_STRENGTH, def.mipmaps ?? false),
    def.hints,
  );
  base.set(kind, surface);
  return surface;
}

function repeated(tex: CanvasTexture, repeatX: number, repeatY: number): CanvasTexture {
  const t = tex.clone();
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** A surface's maps plus its recommended material. Cached per
 * (kind, repeat) — call it freely from render/useMemo. */
export function getSurface(kind: SurfaceKind, repeatX = 1, repeatY = 1): Surface {
  const b = baseSurface(kind);
  if (repeatX === 1 && repeatY === 1) return b;
  const key = `${kind}:${repeatX}:${repeatY}`;
  const hit = variants.get(key);
  if (hit) return hit;
  const pair: TexturePair = {
    map: repeated(b.map, repeatX, repeatY),
    normalMap: repeated(b.normalMap, repeatX, repeatY),
  };
  if (b.emissiveMap) pair.emissiveMap = repeated(b.emissiveMap, repeatX, repeatY);
  if (b.roughnessMap) pair.roughnessMap = repeated(b.roughnessMap, repeatX, repeatY);
  const surface = buildSurface(pair, b.hints);
  variants.set(key, surface);
  return surface;
}

/** Just the maps (the original API). Same cache as getSurface. */
export function getTextures(kind: TextureKind, repeatX = 1, repeatY = 1): TexturePair {
  return getSurface(kind, repeatX, repeatY);
}

// ── Runes ────────────────────────────────────────────────────────────────────

export interface RuneTextures {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  /** Grayscale — tint with the material's `emissive` color. */
  emissiveMap: CanvasTexture;
}

const runes = new Map<string, RuneTextures>();

/** A carved lore-tablet face for `seed` (use the lore fragment id): each seed
 * gets its own glyph. Cached per seed — the set of fragments is finite. */
export function getRuneTextures(seed: string): RuneTextures {
  const hit = runes.get(seed);
  if (hit) return hit;
  const p = paintRuneTablet(seed);
  const S = RUNE_TABLET_SIZE;
  const tex: RuneTextures = {
    map: toTexture(p.color, S, S, true),
    normalMap: toTexture(heightToNormal(p.height, S, 2.4), S, S, false),
    emissiveMap: toTexture(p.emissive!, S, S, true),
  };
  runes.set(seed, tex);
  return tex;
}

/** Glyph slots in the portal-seal atlas, and each slot's texel size. */
export const SEAL_GLYPHS = 8;
export const SEAL_GLYPH_CELL = 16;
let sealAtlas: CanvasTexture | null = null;

/** A strip of SEAL_GLYPHS rune masks (white on black). Use it as both
 * alphaMap (with alphaTest) and emissiveMap; pick a glyph by UV (slot k
 * spans u ∈ [k/SEAL_GLYPHS, (k+1)/SEAL_GLYPHS]). */
export function getSealGlyphAtlas(): CanvasTexture {
  if (sealAtlas) return sealAtlas;
  const { rgba, width, height } = paintGlyphAtlas(SEAL_GLYPHS, SEAL_GLYPH_CELL);
  sealAtlas = toTexture(rgba, width, height, false);
  return sealAtlas;
}
