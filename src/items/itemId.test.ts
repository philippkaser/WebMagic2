import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { computeStats, resolveItem } from "./catalog";
import { GAMBLE_PRICE, sellValue } from "./economy";
import { makeItemId, MAX_ITEM_LEVEL, splitItemId, withLevel } from "./itemId";
import { gearWard, staffPotency } from "./power";
import { rollDrop, rollGamble } from "./loot";

describe("item ids & enchantments", () => {
  test("make/split round-trips plain and affixed ids", () => {
    expect(makeItemId("ember_staff")).toBe("ember_staff");
    expect(makeItemId("ember_staff", "keen")).toBe("ember_staff+keen");
    expect(splitItemId("ember_staff")).toEqual({
      baseId: "ember_staff",
      affixId: null,
      level: null,
      wellFormed: true,
    });
    expect(splitItemId("ember_staff+keen")).toEqual({
      baseId: "ember_staff",
      affixId: "keen",
      level: null,
      wellFormed: true,
    });
  });

  test("item levels ride in the id and round-trip", () => {
    expect(makeItemId("ember_staff", "keen", 12)).toBe("ember_staff+keen@12");
    expect(makeItemId("ember_staff", null, 3)).toBe("ember_staff@3");
    expect(splitItemId("ember_staff+keen@12")).toEqual({
      baseId: "ember_staff",
      affixId: "keen",
      level: 12,
      wellFormed: true,
    });
    expect(splitItemId("ember_staff@3").level).toBe(3);
    expect(withLevel("ember_staff+keen@12", 4)).toBe("ember_staff+keen@4");
    expect(withLevel("ember_staff+keen@12", null)).toBe("ember_staff+keen");
    // Levels are clamped on creation, rejected when malformed on parse.
    expect(makeItemId("ember_staff", null, 9999)).toBe(`ember_staff@${MAX_ITEM_LEVEL}`);
    expect(splitItemId("ember_staff@abc").wellFormed).toBe(false);
    expect(splitItemId("ember_staff@0").wellFormed).toBe(false);
  });

  test("resolveItem understands levels (explicit, legacy fallback, never on consumables)", () => {
    expect(resolveItem("ember_staff+keen@12").level).toBe(12);
    // Legacy ids fall back to the depth the item could first drop at.
    expect(resolveItem("void_staff").level).toBe(6);
    expect(resolveItem("apprentice_staff").level).toBe(1);
    expect(resolveItem("potion_hp_weak").level).toBe(0);
    expect(() => resolveItem("potion_hp_weak@4")).toThrow();
    expect(() => resolveItem("ember_staff@x")).toThrow();
    expect(() => resolveItem("ember_staff@0")).toThrow();
  });

  test("staff level scales spell damage; other gear adds a health ward", () => {
    const at = (staff: string, amulet: string | null = null) =>
      computeStats({
        staff: { defId: staff, runLoot: false },
        amulet: amulet ? { defId: amulet, runLoot: false } : null,
        cloak: null,
        boots: null,
      });
    expect(at("apprentice_staff@1").damageMult).toBeCloseTo(1);
    expect(at("apprentice_staff@11").damageMult).toBeCloseTo(staffPotency(11));
    expect(staffPotency(11)).toBeGreaterThan(1.5);
    expect(at("apprentice_staff", "amulet_focus@1").maxHealth).toBe(100);
    expect(at("apprentice_staff", "amulet_focus@21").maxHealth).toBe(100 + gearWard(21));
    expect(gearWard(21)).toBeGreaterThan(50);
  });

  test("resolveItem names and validates enchanted items", () => {
    const item = resolveItem("void_staff+keen");
    expect(item.name).toBe("Keen Staff of the Hollow");
    expect(item.affix!.id).toBe("keen");
    expect(resolveItem("worn_boots").affix).toBeNull();
    expect(() => resolveItem("void_staff+nope")).toThrow();
    expect(() => resolveItem("nope+keen")).toThrow();
  });

  test("affix passives fold into computeStats", () => {
    const base = computeStats({
      staff: { defId: "apprentice_staff", runLoot: false },
      amulet: null,
      cloak: null,
      boots: null,
    });
    const enchanted = computeStats({
      staff: { defId: "apprentice_staff+keen", runLoot: false },
      amulet: null,
      cloak: null,
      boots: null,
    });
    expect(enchanted.damageMult).toBeCloseTo(base.damageMult * 1.12);
  });

  test("sell values: gear by tier, enchant bonus, consumables by price", () => {
    const plain = sellValue("amulet_vigor")!;
    const enchanted = sellValue("amulet_vigor+keen")!;
    expect(enchanted).toBeGreaterThan(plain);
    expect(sellValue("void_staff")!).toBeGreaterThan(sellValue("ember_staff")!);
    // The free starter kit is worth nothing to Maro; a found copy sells.
    expect(sellValue("apprentice_staff")).toBeNull();
    expect(sellValue("worn_boots")).toBeNull();
    expect(sellValue("apprentice_staff@1")!).toBeGreaterThan(0);
    expect(sellValue("potion_hp_weak")).toBe(9); // ceil(35 / 4)
    expect(sellValue("garbage_id")).toBeNull();
    // Selling must never beat buying (no merchant arbitrage).
    expect(sellValue("save_feather")!).toBeLessThan(180);
  });

  test("rollDrop always yields a resolvable id; deep floors enchant sometimes", () => {
    const rng = new Rng(1234);
    let enchanted = 0;
    for (let i = 0; i < 300; i++) {
      const id = rollDrop(rng, 12);
      const item = resolveItem(id); // throws on any malformed roll
      if (item.affix) {
        enchanted++;
        expect(item.def.slot).not.toBe("consumable"); // consumables stay plain
      }
      if (item.def.slot === "consumable") {
        expect(splitItemId(id).level).toBeNull();
      } else {
        // Gear is found at (about) the depth it dropped on.
        expect(item.level).toBeGreaterThanOrEqual(11);
        expect(item.level).toBeLessThanOrEqual(13);
      }
    }
    expect(enchanted).toBeGreaterThan(20);
  });

  test("rollGamble yields gear only, never consumables, and can enchant", () => {
    const rng = new Rng(99);
    let enchanted = 0;
    for (let i = 0; i < 200; i++) {
      const item = resolveItem(rollGamble(rng, 5));
      expect(item.def.slot).not.toBe("consumable");
      if (item.affix) enchanted++;
    }
    expect(enchanted).toBeGreaterThan(40); // ~45% odds
    // A gamble should be a gamble, not a guaranteed profit.
    expect(sellValue(rollGamble(new Rng(1), 1))!).toBeLessThan(GAMBLE_PRICE);
  });
});
