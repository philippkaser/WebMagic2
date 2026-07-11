import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { computeStats, resolveItem } from "./catalog";
import { GAMBLE_PRICE, sellValue } from "./economy";
import { makeItemId, splitItemId } from "./itemId";
import { rollDrop, rollGamble } from "./loot";

describe("item ids & enchantments", () => {
  test("make/split round-trips plain and affixed ids", () => {
    expect(makeItemId("ember_staff")).toBe("ember_staff");
    expect(makeItemId("ember_staff", "keen")).toBe("ember_staff+keen");
    expect(splitItemId("ember_staff")).toEqual({ baseId: "ember_staff", affixId: null });
    expect(splitItemId("ember_staff+keen")).toEqual({ baseId: "ember_staff", affixId: "keen" });
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
    expect(sellValue("void_staff")!).toBeGreaterThan(sellValue("apprentice_staff")!);
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
