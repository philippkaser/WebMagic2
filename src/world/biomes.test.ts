import { describe, expect, test } from "bun:test";
import { BIOME_DEFS, BIOME_SURFACE_IDS, type BiomeSurfaceId, biomeForFloor, getBiomeDef } from "./biomes";
import { SURFACE_KINDS } from "../render/textures/kinds";
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

  test("every surface is one of the fixed texture ids, exactly as agreed", () => {
    const expected: Record<BiomeId, BiomeSurfaceId[]> = {
      catacombs: ["tomb", "flagstone", "tomb"],
      drowned: ["wetstone", "wetslab", "wetstone"],
      forge: ["basalt", "obsidian", "basalt"],
      crystal: ["slate", "polished", "slate"],
      hollow: ["palestone", "ashflag", "void"],
    };
    const allowed = new Set<string>(BIOME_SURFACE_IDS);
    for (const def of BIOME_DEFS) {
      const { wall, floor, ceiling } = def.surfaces;
      for (const id of [wall, floor, ceiling]) expect(allowed.has(id)).toBe(true);
      expect([wall, floor, ceiling]).toEqual(expected[def.id]);
    }
  });

  test("every biome names a texture that render/textures actually paints", () => {
    const painted = new Set<string>(SURFACE_KINDS);
    for (const id of BIOME_SURFACE_IDS) expect(painted.has(id)).toBe(true);
  });

  test("looks are well-formed: damp band, vault fade, shafts, mirror", () => {
    for (const def of BIOME_DEFS) {
      const { stone, reflection, shaft, seams } = def.look;
      expect(stone.dampTint).toMatch(HEX);
      expect(stone.dampHeight).toBeGreaterThanOrEqual(0);
      expect(stone.dampHeight).toBeLessThan(3);
      expect(stone.dampGloss).toBeGreaterThan(0);
      expect(stone.dampGloss).toBeLessThanOrEqual(1);
      expect(stone.vaultShade).toBeGreaterThan(0);
      expect(stone.vaultShade).toBeLessThanOrEqual(1);
      expect(shaft.color).toMatch(HEX);
      expect(shaft.strength).toBeGreaterThan(0);
      expect(shaft.strength).toBeLessThan(1);
      if (reflection) {
        expect(reflection.strength).toBeGreaterThan(0);
        expect(reflection.blur).toBeGreaterThanOrEqual(0);
      }
      if (seams) {
        expect(seams.color).toMatch(HEX);
        // Accents, not wallpaper.
        expect(seams.chance).toBeGreaterThan(0);
        expect(seams.chance).toBeLessThan(0.25);
      }
    }
  });

  test("the Hollow is the one dull floor; only the Forge's walls glow at the foot", () => {
    for (const def of BIOME_DEFS) {
      expect(def.look.reflection === null).toBe(def.id === "hollow");
      expect(def.look.seams !== undefined).toBe(def.id === "forge");
    }
    // The Forge's heat rises; every other shaft is light falling.
    expect(getBiomeDef("forge").look.shaft.rising).toBe(true);
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
      expect(def.envIntensity).toBeGreaterThanOrEqual(0);
      expect(def.envIntensity).toBeLessThanOrEqual(1);
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
