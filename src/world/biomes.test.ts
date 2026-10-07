import { describe, expect, test } from "bun:test";
import { BIOME_DEFS, BIOME_SURFACE_IDS, biomeForFloor, getBiomeDef } from "./biomes";
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

  test("every band wears its artpass surface set (the Hollow wears the abyss)", () => {
    const expected: Record<BiomeId, string> = {
      catacombs: "catacombs",
      drowned: "drowned",
      forge: "forge",
      crystal: "crystal",
      hollow: "abyss",
    };
    const allowed = new Set<string>(BIOME_SURFACE_IDS);
    for (const def of BIOME_DEFS) {
      const { wall, floor, ceiling } = def.surfaces;
      for (const id of [wall, floor, ceiling]) expect(allowed.has(id)).toBe(true);
      const set = expected[def.id];
      expect([wall, floor, ceiling] as string[]).toEqual([`${set}-wall`, `${set}-floor`, `${set}-ceiling`]);
    }
  });

  test("every biome names a texture that render/textures actually paints", () => {
    const painted = new Set<string>(SURFACE_KINDS);
    for (const id of BIOME_SURFACE_IDS) expect(painted.has(id)).toBe(true);
  });

  test("looks are well-formed: shafts, mirror, glow, grade, air, accent", () => {
    for (const def of BIOME_DEFS) {
      const { reflection, shaft } = def.look;
      expect(shaft.color).toMatch(HEX);
      expect(shaft.strength).toBeGreaterThan(0);
      expect(shaft.strength).toBeLessThan(1);
      if (reflection) {
        expect(reflection.strength).toBeGreaterThan(0);
        expect(reflection.blur).toBeGreaterThanOrEqual(0);
      }
      expect(def.glow.intensity).toBeGreaterThan(0);
      expect(def.glow.pulse).toBeGreaterThanOrEqual(0);
      expect(def.glow.pulse).toBeLessThan(1);
      expect(def.grade.shadows).toMatch(HEX);
      expect(def.grade.highlights).toMatch(HEX);
      expect(def.grade.saturation).toBeGreaterThan(0.5);
      expect(def.grade.saturation).toBeLessThan(1.5);
      expect(def.grade.contrast).toBeGreaterThan(0.8);
      expect(def.grade.contrast).toBeLessThan(1.4);
      const { eye, ...air } = def.air;
      for (const v of Object.values(air)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(2);
      }
      // A log2 luminance: dim, but not black.
      expect(eye).toBeLessThan(-3);
      expect(eye).toBeGreaterThan(-12);
      expect(def.air.vignette).toBeLessThanOrEqual(1);
      expect(def.accent).toMatch(HEX);
    }
  });

  test("the Hollow is the one dull floor; the Forge's heat rises", () => {
    for (const def of BIOME_DEFS) expect(def.look.reflection === null).toBe(def.id === "hollow");
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
