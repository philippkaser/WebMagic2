import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { BIOME_DEFS, biomeForFloor } from "../world/biomes";
import { allAffixDefs } from "./affixes";
import { getItemDef } from "./catalog";
import { attunedReagent, BAND_REAGENT, bandReagent, RIFTGLASS, rollMaterialDrops, WARDEN_SIGIL, whereItGrows } from "./materials";

describe("materials", () => {
  test("a floor drops one band reagent, and now and then riftglass — nothing else", () => {
    const rng = new Rng(11);
    for (let floor = 1; floor <= 100; floor += 3) {
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) for (const d of rollMaterialDrops(rng, i % 3 ? "kill" : "prop", floor)) seen.add(d.id);
      seen.delete(RIFTGLASS);
      expect([...seen]).toEqual([bandReagent(floor)]);
    }
  });

  test("a Warden leaves sigils, riftglass and the band's reagent", () => {
    const ids = rollMaterialDrops(new Rng(3), "boss", 30).map((d) => d.id);
    expect(ids).toEqual([WARDEN_SIGIL, RIFTGLASS, BAND_REAGENT.forge]);
  });

  test("every reagent is a real material and says where it grows", () => {
    for (const id of [...Object.values(BAND_REAGENT), RIFTGLASS, WARDEN_SIGIL]) expect(getItemDef(id).slot).toBe("material");
    expect(whereItGrows("grave_moss")).toBe("The Catacombs, floors 1–9");
    expect(whereItGrows(RIFTGLASS)).toBeNull();
  });
});

describe("attunement", () => {
  const affixIds = allAffixDefs().map((a) => a.id);
  const reached = (level: number) => new Set(BIOME_DEFS.filter((d) => d.floors[0] <= Math.max(1, level)).map((d) => BAND_REAGENT[d.id]));

  test("is fixed per item, and only ever a reagent of a depth its level has reached", () => {
    expect(attunedReagent("ember_staff", ["keen"], 40)).toBe(attunedReagent("ember_staff", ["keen"], 40));
    // Affix order doesn't matter: it's the same enchantments.
    expect(attunedReagent("ember_staff", ["keen", "hasty"], 40)).toBe(attunedReagent("ember_staff", ["hasty", "keen"], 40));
    for (let level = 0; level <= 100; level += 7) {
      for (const a of affixIds) expect(reached(level).has(attunedReagent("ember_staff", [a], level))).toBe(true);
    }
    expect(attunedReagent("frost_staff", ["glass"], 3)).toBe("grave_moss");
  });

  test("varies between items, so deep gear sends you back up to different bands", () => {
    const wants = new Set(affixIds.map((a) => attunedReagent("ember_staff", [a], 60)));
    expect(wants.size).toBeGreaterThanOrEqual(3);
  });

  test("tempering deeper only ever switches it to the newly reached band", () => {
    for (const a of affixIds) {
      let prev = attunedReagent("cloak_warden", [a], 1);
      for (let level = 2; level <= 100; level++) {
        const now = attunedReagent("cloak_warden", [a], level);
        if (now !== prev) expect(now).toBe(BAND_REAGENT[biomeForFloor(level)]);
        prev = now;
      }
    }
  });
});
