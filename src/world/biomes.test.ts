import { describe, expect, test } from "bun:test";
import { BIOME_DEFS, BIOME_SURFACE_IDS, type BiomeSurfaceId, biomeForFloor, getBiomeDef } from "./biomes";
import type { BiomeId, EnemyKind } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;
const ENEMY_KINDS: EnemyKind[] = ["wisp", "sentry", "shadow", "slime"];

describe("biomes", () => {
  test("bands are contiguous and cover floors 1..100", () => {
    expect(BIOME_DEFS[0].floors[0]).toBe(1);
    expect(BIOME_DEFS[BIOME_DEFS.length - 1].floors[1]).toBe(100);
    for (let i = 1; i < BIOME_DEFS.length; i++) {
      expect(BIOME_DEFS[i].floors[0]).toBe(BIOME_DEFS[i - 1].floors[1] + 1);
    }
  });

  test("floors map to the agreed bands", () => {
    const expected: [number, number, BiomeId][] = [
      [1, 9, "catacombs"],
      [10, 19, "drowned"],
      [20, 34, "forge"],
      [35, 54, "crystal"],
      [55, 100, "hollow"],
    ];
    for (const [from, to, id] of expected) {
      expect(getBiomeDef(id).floors).toEqual([from, to]);
      for (let f = from; f <= to; f++) expect(biomeForFloor(f)).toBe(id);
    }
    // Out-of-range depths clamp rather than throw.
    expect(biomeForFloor(0)).toBe("catacombs");
    expect(biomeForFloor(101)).toBe("hollow");
  });

  test("the Catacombs keep the dungeon's original look", () => {
    const c = getBiomeDef("catacombs");
    expect(c.fog).toEqual({ color: "#070409", near: 9, far: 50 });
    expect(c.background).toBe("#070409");
    expect(c.ambient).toEqual({ color: "#5a6a9a", intensity: 0.14 });
    expect(c.torchColor).toBe("#ff9a4d");
    expect(c.torchIntensityMult).toBe(1);
    expect(c.surfaces).toEqual({ wall: "stone", floor: "slab", ceiling: "dark" });
    expect(c.enemyWeights).toEqual({});
  });

  test("every surface is one of the fixed texture ids, exactly as agreed", () => {
    const expected: Record<BiomeId, BiomeSurfaceId[]> = {
      catacombs: ["stone", "slab", "dark"],
      drowned: ["wetstone", "wetslab", "dark"],
      forge: ["basalt", "ashslab", "dark"],
      crystal: ["crystal", "crystalslab", "dark"],
      hollow: ["bone", "boneslab", "void"],
    };
    const allowed = new Set<string>(BIOME_SURFACE_IDS);
    for (const def of BIOME_DEFS) {
      const { wall, floor, ceiling } = def.surfaces;
      for (const id of [wall, floor, ceiling]) expect(allowed.has(id)).toBe(true);
      expect([wall, floor, ceiling]).toEqual(expected[def.id]);
    }
  });

  test("every biome is well-formed and distinct", () => {
    const ids = BIOME_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of BIOME_DEFS) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.epithet.length).toBeGreaterThan(0);
      for (const c of [def.fog.color, def.background, def.ambient.color, def.torchColor]) {
        expect(c).toMatch(HEX);
      }
      expect(def.fog.near).toBeGreaterThan(0);
      expect(def.fog.far).toBeGreaterThan(def.fog.near);
      expect(def.ambient.intensity).toBeGreaterThan(0);
      expect(def.torchIntensityMult).toBeGreaterThan(0);
      for (const [kind, w] of Object.entries(def.enemyWeights)) {
        expect(ENEMY_KINDS).toContain(kind as EnemyKind);
        expect(w).toBeGreaterThanOrEqual(0);
      }
    }
    // Moods differ: no two biomes share a fog colour or torch colour.
    expect(new Set(BIOME_DEFS.map((d) => d.fog.color)).size).toBe(BIOME_DEFS.length);
    expect(new Set(BIOME_DEFS.map((d) => d.torchColor)).size).toBe(BIOME_DEFS.length);
  });

  test("unknown ids throw", () => {
    expect(() => getBiomeDef("nowhere" as BiomeId)).toThrow();
  });
});
