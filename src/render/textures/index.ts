import { Rng, hashSeed } from "../../core/rng";
import type { CanvasTexture } from "three";
import { heightToNormal, scalarToRgba, toTexture, type Painted } from "./canvas";
import { paintRuneCircle, RUNE_CIRCLE_SIZE } from "./decals";
import { paintGlyphAtlas, paintRuneTablet, RUNE_TABLET_SIZE } from "./glyphs";
import { archPart, type SurfaceKind, type TextureKind } from "./kinds";
import { barrel, ceramic, cloth, planks, runestone, stone } from "./props";
import { paintSurfacePart, WALL_TEX_W } from "./surfaces";
import { bark, cobble, dirt, shingles, timber, windowPane } from "./village";

/** Procedural pixel-art textures — the artpass way. Every surface in the
 * game is generated at runtime on small canvases (no binary assets):
 * painted pixel art with hand-picked palette ramps, a normal map derived
 * from its height field so the chunky pixels still catch light, and, where
 * a painter provides them, a roughness map (wet stone, polished veins) and
 * an emissive map (lume specks, magma seams, crystal veins, runes).
 *
 * Layout:
 *  - canvas.ts        the paint buffer toolkit + upload (the only DOM code)
 *  - noise.ts         tiling value/fbm/ridged/Worley noise
 *  - palette.ts       hex, mix, stepped palette ramps
 *  - surfaces/        one architecture set per depth band (walls as a
 *                     variant atlas, floors, ceilings) + shared building
 *                     blocks (masonry, flagstones, grime, cracks, drips…)
 *  - props.ts         crates, barrels, pots, cloth, runestone, stone
 *  - village.ts       grass, cobbles, timber, shingles, bark, windows
 *  - glyphs.ts        lore tablets and the portal-seal glyph strip
 *  - decals.ts        the arrival rune circle
 *  - kinds.ts         the surface names
 *  - index.ts (here)  the surface table, caching and the public API */

export type {
  ArchSurface,
  CeilingSurface,
  FloorSurface,
  PropSurface,
  SurfaceKind,
  TextureKind,
  VillageSurface,
  WallSurface,
} from "./kinds";
export {
  ARCH_SURFACES,
  CEILING_SURFACES,
  FLOOR_SURFACES,
  PROP_SURFACES,
  SURFACE_KINDS,
  VILLAGE_SURFACES,
  WALL_SURFACES,
  setSurfaces,
} from "./kinds";
export {
  CEIL_SPAN,
  FLOOR_SPAN,
  SURFACE_SETS,
  VARIANT_WEIGHTS,
  WALL_TEX_H,
  WALL_TEX_W,
  WALL_VARIANTS,
  wallAtlasU,
  type SurfaceSetId,
} from "./surfaces";

export interface TexturePair {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  /** Present when the painter varies roughness (wet stone, glossy veins).
   * three.js multiplies it with the material's `roughness` — pair it with
   * the hint (1). */
  roughnessMap?: CanvasTexture;
  /** Present when the surface glows; needs emissive "#ffffff" on the
   * material — getSurface's hints carry it. */
  emissiveMap?: CanvasTexture;
}

/** Recommended meshStandardMaterial params for a surface: a texture and the
 * material it was painted for are one design decision. */
export interface SurfaceHints {
  /** With a roughnessMap three.js MULTIPLIES this by the map's G channel, so
   * kinds that ship a roughness map use 1 and let the map speak. */
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  /** White when the surface has an emissive map (the painted colors come
   * through untouched); absent otherwise. */
  emissive?: string;
  /** Base glow strength. The dungeon breathes it per biome at runtime
   * (biome.glow); props use it as is. */
  emissiveIntensity?: number;
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

/** How to paint a kind and what material it wants (before the emissive
 * keys, which follow from whether the painter made a glow layer). */
export interface SurfaceDef {
  paint: () => Painted;
  hints: SurfaceHints;
  /** Normal-map strength (slope multiplier). */
  normalStrength: number;
  /** Width of one horizontally-wrapping tile inside the texture: the wall
   * atlas wraps each variant onto itself. Defaults to the full width. */
  tileW?: number;
}

/** Artpass surface material: roughness from the map, a touch of metal so
 * the wet texels pick up the environment. */
const ARCH_HINTS: SurfaceHints = { roughness: 1, metalness: 0.05, envMapIntensity: 0.6 };
const FLOOR_HINTS: SurfaceHints = { roughness: 1, metalness: 0.12, envMapIntensity: 0.6 };

function prop(painter: (rng: Rng) => Painted, seed: string, hints: SurfaceHints): SurfaceDef {
  return { paint: () => painter(new Rng(hashSeed(seed))), hints, normalStrength: 2.4 };
}

function arch(kind: SurfaceKind): SurfaceDef {
  const a = archPart(kind)!;
  return {
    paint: () => paintSurfacePart(a.set, a.part),
    hints: a.part === "floor" ? FLOOR_HINTS : ARCH_HINTS,
    normalStrength: 2.4,
    tileW: a.part === "wall" ? WALL_TEX_W : undefined,
  };
}

/** The surface table: every SurfaceKind → its painter + material hints. The
 * type system refuses a kind without a painter. */
export const SURFACE_DEFS: Readonly<Record<SurfaceKind, SurfaceDef>> = {
  "catacombs-wall": arch("catacombs-wall"),
  "catacombs-floor": arch("catacombs-floor"),
  "catacombs-ceiling": arch("catacombs-ceiling"),
  "drowned-wall": arch("drowned-wall"),
  "drowned-floor": arch("drowned-floor"),
  "drowned-ceiling": arch("drowned-ceiling"),
  "forge-wall": arch("forge-wall"),
  "forge-floor": arch("forge-floor"),
  "forge-ceiling": arch("forge-ceiling"),
  "crystal-wall": arch("crystal-wall"),
  "crystal-floor": arch("crystal-floor"),
  "crystal-ceiling": arch("crystal-ceiling"),
  "abyss-wall": arch("abyss-wall"),
  "abyss-floor": arch("abyss-floor"),
  "abyss-ceiling": arch("abyss-ceiling"),
  planks: prop(planks, "planks", { roughness: 0.85, metalness: 0, envMapIntensity: 1 }),
  barrel: prop(barrel, "barrel", { roughness: 0.75, metalness: 0.15, envMapIntensity: 1 }),
  ceramic: prop(ceramic, "ceramic", { roughness: 0.6, metalness: 0, envMapIntensity: 1 }),
  cloth: prop(cloth, "cloth", { roughness: 0.9, metalness: 0, envMapIntensity: 0.5 }),
  runestone: prop(runestone, "runestone", { roughness: 0.8, metalness: 0.1, envMapIntensity: 0.6 }),
  // Graves, lore tablets and the portal frame: the artpass waystone basalt.
  slab: prop(runestone, "runestone", { roughness: 0.8, metalness: 0.1, envMapIntensity: 0.6 }),
  stone: prop(stone, "stone", { roughness: 1, metalness: 0.04, envMapIntensity: 0.4 }),
  dirt: prop(dirt, "dirt", { roughness: 0.95, metalness: 0, envMapIntensity: 0.5 }),
  cobble: prop(cobble, "cobble", { roughness: 1, metalness: 0.02, envMapIntensity: 0.5 }),
  timber: prop(timber, "timber", { roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }),
  shingles: prop(shingles, "shingles", { roughness: 0.85, metalness: 0, envMapIntensity: 0.4 }),
  bark: prop(bark, "bark", { roughness: 0.95, metalness: 0, envMapIntensity: 0.3 }),
  window: prop(windowPane, "window", { roughness: 0.5, metalness: 0, envMapIntensity: 0.6, emissiveIntensity: 1.4 }),
};

/** Paint a surface (pure and deterministic: seeded from its name, so every
 * client and every test run gets identical bytes). */
export function paintSurface(kind: SurfaceKind): Painted {
  return SURFACE_DEFS[kind].paint();
}

/** Painted once per kind; repeat variants are clones that share the base
 * texture's `Source`, so three.js uploads each image to the GPU once no
 * matter how many repeat settings the scene asks for. */
const base = new Map<SurfaceKind, Surface>();
const variants = new Map<string, Surface>();

function buildSurface(pair: TexturePair, def: SurfaceHints): Surface {
  // A glow layer implies a white emissive tint; no layer, no emissive keys.
  const hints: SurfaceHints = pair.emissiveMap
    ? { ...def, emissive: "#ffffff", emissiveIntensity: def.emissiveIntensity ?? 1 }
    : { roughness: def.roughness, metalness: def.metalness, envMapIntensity: def.envMapIntensity };
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

function upload(p: Painted, def: SurfaceDef): TexturePair {
  const pair: TexturePair = {
    map: toTexture(p.color, p.w, p.h, true),
    normalMap: toTexture(heightToNormal(p, def.normalStrength, def.tileW ?? p.w), p.w, p.h, false),
  };
  if (p.rough) pair.roughnessMap = toTexture(scalarToRgba(p.rough), p.w, p.h, false);
  if (p.emit) pair.emissiveMap = toTexture(p.emit, p.w, p.h, true);
  return pair;
}

function baseSurface(kind: SurfaceKind): Surface {
  const hit = base.get(kind);
  if (hit) return hit;
  const def = SURFACE_DEFS[kind];
  const surface = buildSurface(upload(def.paint(), def), def.hints);
  base.set(kind, surface);
  return surface;
}

function repeated(tex: CanvasTexture, repeatX: number, repeatY: number): CanvasTexture {
  const t = tex.clone();
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** A surface's maps plus its recommended material. Cached per
 * (kind, repeat) — call it freely from render/useMemo. The dungeon maps
 * its architecture from world position instead of `repeat` (see
 * render/models/architectureMesh.ts), so it always asks for 1×1. */
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

/** Just the maps (the artpass API). Same cache as getSurface. */
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
    normalMap: toTexture(heightToNormal(p, 2.4), S, S, false),
    emissiveMap: toTexture(p.emit!, S, S, true),
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

let runeCircle: CanvasTexture | null = null;

/** The arrival sigil (grayscale; tint it with the material color, draw it
 * additively). Its `center` is the middle, so spinning it is just
 * `rotation`. Shared: every biome's circle material uses this one map. */
export function getRuneCircleTexture(): CanvasTexture {
  if (runeCircle) return runeCircle;
  const p = paintRuneCircle();
  runeCircle = toTexture(p.color, RUNE_CIRCLE_SIZE, RUNE_CIRCLE_SIZE, true);
  runeCircle.center.set(0.5, 0.5);
  return runeCircle;
}
