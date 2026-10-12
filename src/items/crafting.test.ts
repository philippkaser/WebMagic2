import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import type { WireInventory, WireStack } from "../net/protocol";
import { applyCraft, allRecipes, canAfford, countItem, enhanceCost, salvageYield, temperCost } from "./crafting";
import { resolveItem } from "./catalog";
import { bandReagent } from "./materials";

const grid = (n: number, cells: (WireStack | null)[] = []) => Array.from({ length: n }, (_, i) => cells[i] ?? null);

function inv(over: Partial<WireInventory> = {}): WireInventory {
  return {
    equipment: { staff: "ember_staff@12", amulet: "amulet_vigor+keen@9", cloak: null, boots: "worn_boots" },
    bag: grid(5),
    belt: grid(2),
    pouch: grid(8),
    chest: grid(30),
    gold: 500,
    ...over,
  };
}

const rng = () => new Rng(7);
const ctx = { deepest: 20 };

describe("brewing", () => {
  test("reagents and gold become a draught on the belt", () => {
    const start = inv({ pouch: grid(8, [{ id: "grave_moss", qty: 3 }, { id: "slime_gel", qty: 2 }]) });
    const out = applyCraft(start, { recipe: "brew:potion_hp_weak" }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.inventory.belt[0]).toEqual({ id: "potion_hp_weak", qty: 1 });
    expect(countItem(out.inventory, "grave_moss")).toBe(2);
    expect(countItem(out.inventory, "slime_gel")).toBe(0);
    expect(out.inventory.gold).toBe(496);
    // The input is never mutated.
    expect(countItem(start, "slime_gel")).toBe(2);
  });

  test("short a reagent: refused, nothing spent", () => {
    const start = inv({ pouch: grid(8, [{ id: "grave_moss", qty: 3 }, { id: "slime_gel", qty: 1 }]) });
    const out = applyCraft(start, { recipe: "brew:potion_hp_weak" }, rng(), ctx);
    expect(out).toEqual({ ok: false, reason: "Not enough reagents" });
  });

  test("reagents are found in the pouch, the bag and the chest", () => {
    const start = inv({
      pouch: grid(8, [{ id: "grave_moss", qty: 1 }]),
      bag: grid(5, [{ id: "slime_gel", qty: 1 }]),
      chest: grid(30, [null, { id: "slime_gel", qty: 4 }]),
    });
    const out = applyCraft(start, { recipe: "brew:potion_hp_weak" }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) expect(countItem(out.inventory, "slime_gel")).toBe(3);
  });

  test("every draught needs Grave Moss — the reason to walk the Catacombs", () => {
    for (const r of allRecipes("cauldron")) {
      if (r.output === "save_feather") continue;
      expect(r.cost!.items.some((s) => s.id === "grave_moss")).toBe(true);
    }
  });
});

describe("the forge", () => {
  test("temper raises the level with the reagent of the depth it rises to", () => {
    const item = resolveItem("ember_staff@9");
    const cost = temperCost(item)!;
    expect(cost.items[0]!.id).toBe(bandReagent(10)); // floor 10 is the Drowned Halls
    expect(cost.items[0]!.id).toBe("brine_pearl");
    const start = inv({ equipment: { staff: "ember_staff@9", amulet: null, cloak: null, boots: null }, pouch: grid(8, [{ id: "brine_pearl", qty: 5 }]) });
    const out = applyCraft(start, { recipe: "temper", target: { c: "equipment", s: "staff" } }, rng(), ctx);
    expect(out.ok && out.inventory.equipment.staff).toBe("ember_staff@10");
    expect(out.ok && out.changed).toEqual({ from: "ember_staff@9", to: "ember_staff@10" });
  });

  test("enhance climbs to +5 and stops; it never changes the level", () => {
    const item = resolveItem("cloak_warden+warded@14^4");
    expect(enhanceCost(item)!.items.find((s) => s.id === "riftglass")!.qty).toBe(5);
    expect(enhanceCost(resolveItem("cloak_warden@14^5"))).toBeNull();
    const start = inv({
      bag: grid(5, [{ id: "cloak_warden+warded@14^4", qty: 1 }]),
      pouch: grid(8, [{ id: "riftglass", qty: 9 }, { id: "arcane_dust", qty: 20 }, { id: bandReagent(14), qty: 4 }]),
    });
    const out = applyCraft(start, { recipe: "enhance", target: { c: "bag", i: 0 } }, rng(), ctx);
    expect(out.ok && out.inventory.bag[0]!.id).toBe("cloak_warden+warded@14^5");
    expect(out.ok && out.inventory.gold).toBe(500 - 200);
  });

  test("imbue adds a distinct enchantment; legendaries and full items refuse", () => {
    const start = inv({ pouch: grid(8, [{ id: "arcane_dust", qty: 10 }, { id: "riftglass", qty: 2 }]) });
    const out = applyCraft(start, { recipe: "imbue", target: { c: "equipment", s: "amulet" } }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const after = resolveItem(out.inventory.equipment.amulet!);
      expect(after.affixes.length).toBe(2);
      expect(after.affixes[0]!.id).toBe("keen");
      expect(after.affixes[1]!.id).not.toBe("keen");
      expect(after.affixes[1]!.slots).toContain("amulet");
    }
    const full = inv({ equipment: { staff: "ember_staff+keen+hasty@3", amulet: null, cloak: null, boots: null }, pouch: start.pouch });
    expect(applyCraft(full, { recipe: "imbue", target: { c: "equipment", s: "staff" } }, rng(), ctx).ok).toBe(false);
    const legend = inv({ equipment: { staff: "stormcaller@12", amulet: null, cloak: null, boots: null }, pouch: start.pouch });
    expect(applyCraft(legend, { recipe: "imbue", target: { c: "equipment", s: "staff" } }, rng(), ctx)).toEqual({
      ok: false,
      reason: "A legendary takes no enchantment",
    });
  });

  test("salvage breaks gear into reagents and essence; never the staff in hand", () => {
    expect(salvageYield(resolveItem("ember_staff+keen+hasty@23^3"))).toEqual([
      { id: "cinder_iron", qty: 3 },
      { id: "arcane_dust", qty: 7 },
      { id: "riftglass", qty: 1 },
    ]);
    const start = inv({ bag: grid(5, [{ id: "boots_hover+swift@12", qty: 1 }]) });
    const out = applyCraft(start, { recipe: "salvage", target: { c: "bag", i: 0 } }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.inventory.bag[0]).toBeNull();
      expect(countItem(out.inventory, "brine_pearl")).toBe(2);
      expect(countItem(out.inventory, "arcane_dust")).toBe(2);
    }
    expect(applyCraft(start, { recipe: "salvage", target: { c: "equipment", s: "staff" } }, rng(), ctx).ok).toBe(false);
  });

  test("the Great Work forges a legendary", () => {
    const start = inv({ pouch: grid(8, [{ id: "warden_sigil", qty: 3 }, { id: "riftglass", qty: 4 }, { id: "arcane_dust", qty: 6 }]) });
    const out = applyCraft(start, { recipe: "greatwork" }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(resolveItem(out.produced[0]!.id).rarity).toBe("legendary");
      expect(out.inventory.gold).toBe(200);
      expect(countItem(out.inventory, "warden_sigil")).toBe(0);
    }
  });

  test("bad requests are refused politely", () => {
    expect(applyCraft(inv(), { recipe: "nope" }, rng(), ctx).ok).toBe(false);
    expect(applyCraft(inv(), { recipe: "temper" }, rng(), ctx).ok).toBe(false);
    expect(applyCraft(inv(), { recipe: "temper", target: { c: "bag", i: 3 } }, rng(), ctx).ok).toBe(false);
    expect(canAfford(inv({ gold: 0 }), { items: [], gold: 1 })).toBe(false);
  });
});
