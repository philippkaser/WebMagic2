import { describe, expect, test } from "bun:test";
import { castFeel, castWeight, hitWeight, isStream, newCastFeel, spellHitWeight } from "./castFeel";
import { getSpellDef, SPELLS, type SpellDef } from "./spellCatalog";

const feel = (id: string) => castFeel(getSpellDef(id), newCastFeel());

describe("cast weight", () => {
  test("a rail is a cannon, a bolt a flick, a stream's tick a whisper", () => {
    const rail = feel("rail");
    const bolt = feel("bolt");
    const beam = feel("beam");
    expect(rail.kick).toBeCloseTo(1, 2);
    expect(rail.pitch).toBeGreaterThan(1.4);
    expect(rail.fov).toBeGreaterThan(0.03);
    expect(rail.shake).toBeGreaterThan(0.2);
    expect(bolt.pitch).toBeGreaterThan(0.2);
    expect(bolt.pitch).toBeLessThan(0.6);
    expect(bolt.fov).toBe(0);
    expect(bolt.shake).toBeLessThan(0.1);
    expect(beam.pitch).toBeLessThan(0.1);
    expect(beam.shake).toBe(0);
    expect(beam.kick).toBeLessThanOrEqual(0.25);
  });

  test("monotonic in damage: more damage never feels lighter", () => {
    const base = getSpellDef("bolt") as Extract<SpellDef, { kind: "bolt" }>;
    let prev = -1;
    for (let d = 1; d <= 120; d += 5) {
      const w = castWeight({ ...base, damage: d });
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
      expect(hitWeight(d)).toBeGreaterThanOrEqual(hitWeight(Math.max(1, d - 5)));
    }
    let prevPitch = -1;
    for (let d = 1; d <= 120; d += 5) {
      const f = castFeel({ ...base, damage: d }, newCastFeel());
      expect(f.pitch).toBeGreaterThanOrEqual(prevPitch);
      prevPitch = f.pitch;
    }
  });

  test("every stream stays small; every catalog spell stays in range", () => {
    for (const def of SPELLS) {
      const f = castFeel(def, newCastFeel());
      for (const v of [f.kick, f.shake, f.flare, castWeight(def), spellHitWeight(def)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(f.pitch).toBeLessThanOrEqual(1.61);
      if (isStream(def)) {
        expect(f.pitch).toBeLessThan(0.1);
        expect(spellHitWeight(def)).toBeLessThan(0.2);
        expect(f.heavy).toBe(false);
      }
    }
  });

  test("the heavy spells gather light before they're ready; quick ones don't", () => {
    expect(feel("rail").heavy).toBe(true);
    expect(feel("lance").heavy).toBe(true);
    expect(feel("blast").heavy).toBe(true);
    expect(feel("bolt").heavy).toBe(false);
    expect(feel("chainbolt").heavy).toBe(false);
  });
});
