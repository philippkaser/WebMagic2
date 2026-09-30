import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";
import { getSurface, getTextures, WALL_VARIANTS, type TexturePair } from "../../render/textures";
import type { Biome, BiomeId } from "../biomes";
import { runeCircleTexture, webTexture } from "./decals";

/** Every material a biome's architecture and dressing uses, built once per
 * biome and kept for the session (five biomes, a dozen materials each), so
 * revisiting a depth band never recompiles or repaints anything. */
export interface BiomeMaterials {
  walls: MeshStandardMaterial[];
  floor: MeshStandardMaterial;
  ceiling: MeshStandardMaterial;
  /** Materials whose emissive breathes with `biome.glow.pulse`. */
  glowing: MeshStandardMaterial[];
  beam: MeshStandardMaterial;
  bone: MeshStandardMaterial;
  iron: MeshStandardMaterial;
  web: MeshStandardMaterial;
  pool: MeshStandardMaterial;
  growthBody: MeshStandardMaterial;
  growthGlow: MeshStandardMaterial;
  coals: MeshStandardMaterial;
  rune: MeshBasicMaterial;
}

const cache = new Map<BiomeId, BiomeMaterials>();

export function biomeMaterials(biome: Biome): BiomeMaterials {
  const hit = cache.get(biome.id);
  if (hit) return hit;

  const walls = Array.from({ length: WALL_VARIANTS }, (_, v) => surface(getSurface(biome.id, "wall", v), biome));
  const floor = surface(getSurface(biome.id, "floor"), biome, 0.12);
  const ceiling = surface(getSurface(biome.id, "ceiling"), biome);
  const accent = new Color(biome.style.accent);

  const iron = new MeshStandardMaterial({ color: "#2b2727", roughness: 0.45, metalness: 0.75, flatShading: true });
  const bone = new MeshStandardMaterial({ color: "#c8bb98", roughness: 0.75, flatShading: true });
  const planks = getTextures("planks");
  const beam =
    biome.style.beam === "iron"
      ? iron
      : biome.style.beam === "wood"
        ? new MeshStandardMaterial({ map: planks.map, normalMap: planks.normalMap, color: "#6a5646", roughness: 0.9 })
        : walls[0];

  const mats: BiomeMaterials = {
    walls,
    floor,
    ceiling,
    glowing: [...walls, floor, ceiling].filter((m) => m.emissiveMap),
    beam,
    bone,
    iron,
    web: new MeshStandardMaterial({
      map: webTexture(),
      alphaTest: 0.4,
      side: DoubleSide,
      color: "#b8b4ac",
      roughness: 1,
    }),
    pool: poolMaterial(biome),
    ...growthMaterials(biome, accent, walls[0]),
    coals: glowMaterial(biome.torchColor, "#1a0500", 3),
    rune: new MeshBasicMaterial({
      map: runeCircleTexture(),
      color: accent.clone().multiplyScalar(0.9),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  };
  cache.set(biome.id, mats);
  return mats;
}

function surface(tex: TexturePair, biome: Biome, metalness = 0.05): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    roughnessMap: tex.roughnessMap ?? null,
    roughness: tex.roughnessMap ? 1 : 0.9,
    metalness,
    envMapIntensity: 0.6,
    emissiveMap: tex.emissiveMap ?? null,
    emissive: new Color(tex.emissiveMap ? "#ffffff" : "#000000"),
    emissiveIntensity: biome.glow.intensity,
  });
}

function glowMaterial(glow: string, base: string, intensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: base,
    emissive: glow,
    emissiveIntensity: intensity,
    roughness: 0.4,
    flatShading: true,
    toneMapped: false,
  });
}

function poolMaterial(biome: Biome): MeshStandardMaterial {
  const decal = { polygonOffset: true, polygonOffsetFactor: -1 } as const;
  switch (biome.style.pool) {
    case "magma":
      return new MeshStandardMaterial({ color: "#3a0c00", emissive: "#ff5a12", emissiveIntensity: 2.2, roughness: 0.6, toneMapped: false, ...decal });
    case "ichor":
      return new MeshStandardMaterial({ color: "#120004", emissive: "#200008", roughness: 0.12, metalness: 0.2, ...decal });
    case "water":
      return new MeshStandardMaterial({
        color: "#0a1820",
        roughness: 0.04,
        metalness: 0.6,
        transparent: true,
        opacity: 0.82,
        ...decal,
      });
  }
}

/** The biome's "growth" slot: [dull body, glowing part]. */
function growthMaterials(
  biome: Biome,
  accent: Color,
  stone: MeshStandardMaterial,
): { growthBody: MeshStandardMaterial; growthGlow: MeshStandardMaterial } {
  const glow = (base: string, k: number) => glowMaterial(`#${accent.getHexString()}`, base, k);
  switch (biome.style.growth) {
    case "mushroom":
      return {
        growthBody: new MeshStandardMaterial({ color: "#8a8270", roughness: 0.9, flatShading: true }),
        growthGlow: glow("#203020", 1.8),
      };
    case "crystal":
      return { growthBody: stone, growthGlow: glow("#20305a", 2.2) };
    case "slag":
      return {
        growthBody: new MeshStandardMaterial({ color: "#1a1616", roughness: 0.95, flatShading: true }),
        growthGlow: glow("#401000", 3),
      };
    case "eye":
      return {
        growthBody: new MeshStandardMaterial({ color: "#3a1218", roughness: 0.5, flatShading: true }),
        growthGlow: glowMaterial("#ffc24a", "#f0e0c0", 1.6),
      };
  }
}
