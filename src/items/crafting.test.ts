import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import type { WireInventory, WireStack } from "../net/protocol";
import { applyCraft, allRecipes, attunementOf, canAfford, countItem, enhanceCost, salvageYield, temperCap, temperCost } from "./crafting";
import { resolveItem } from "./catalog";

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
const want = (id: string) => attunementOf(resolveItem(id));

describe("brewing", () => {
  test("Grave Moss and gold become a draught on the belt", () => {
    const start = inv({ pouch: grid(8, [{ id: "grave_moss", qty: 3 }]) });
    const out = applyCraft(start, { recipe: "brew:potion_hp_weak" }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.inventory.belt[0]).toEqual({ id: "potion_hp_weak", qty: 1 });
    expect(countItem(out.inventory, "grave_moss")).toBe(1);
    expect(out.inventory.gold).toBe(496);
    // The input is never mutated.
    expect(countItem(start, "grave_moss")).toBe(3);
  });

  test("short a reagent: refused, nothing spent", () => {
    const start = inv({ pouch: grid(8, [{ id: "grave_moss", qty: 1 }]) });
    const out = applyCraft(start, { recipe: "brew:potion_hp_weak" }, rng(), ctx);
    expect(out).toEqual({ ok: false, reason: "Not enough reagents" });
  });

  test("reagents are found in the pouch, the bag and the chest", () => {
    const start = inv({
      pouch: grid(8, [{ id: "grave_moss", qty: 1 }]),
      bag: grid(5, [{ id: "brine_pearl", qty: 1 }]),
      chest: grid(30, [null, { id: "grave_moss", qty: 4 }]),
    });
    const out = applyCraft(start, { recipe: "brew:potion_hp" }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(countItem(out.inventory, "grave_moss")).toBe(3);
      expect(countItem(out.inventory, "brine_pearl")).toBe(0);
    }
  });

  test("every draught is Grave Moss plus at most one other thing", () => {
    for (const r of allRecipes("cauldron")) {
      const ids = new Set(r.cost!.items.map((s) => s.id));
      expect(ids.has("grave_moss")).toBe(true);
      expect(ids.size).toBeLessThanOrEqual(2);
    }
  });
});

describe("the forge", () => {
  test("each piece is worked with its own reagent; a shallow one wants Grave Moss", () => {
    expect(want("ember_staff@9")).toBe("grave_moss");
    const cost = temperCost(resolveItem("ember_staff@9"), ctx)!;
    expect(cost.items).toEqual([{ id: "grave_moss", qty: 2 }]);
    const start = inv({ equipment: { staff: "ember_staff@9", amulet: null, cloak: null, boots: null }, pouch: grid(8, [{ id: "grave_moss", qty: 5 }]) });
    const out = applyCraft(start, { recipe: "temper", target: { c: "equipment", s: "staff" } }, rng(), ctx);
    expect(out.ok && out.inventory.equipment.staff).toBe("ember_staff@10");
    expect(out.ok && out.changed).toEqual({ from: "ember_staff@9", to: "ember_staff@10" });
  });

  test("temper stops a little past the deepest floor walked", () => {
    expect(temperCap(0)).toBe(5);
    expect(temperCap(20)).toBe(23);
    expect(temperCost(resolveItem("ember_staff@5"), { deepest: 0 })).toBeNull();
    const start = inv({ equipment: { staff: "ember_staff@5", amulet: null, cloak: null, boots: null }, pouch: grid(8, [{ id: "grave_moss", qty: 9 }]) });
    const out = applyCraft(start, { recipe: "temper", target: { c: "equipment", s: "staff" } }, rng(), { deepest: 0 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("Walk deeper");
  });

  test("enhance climbs to +5 on its reagent and riftglass; it never changes the level", () => {
    const id = "cloak_warden+warded@14^4";
    expect(enhanceCost(resolveItem(id))!.items).toEqual([
      { id: want(id), qty: 10 },
      { id: "riftglass", qty: 5 },
    ]);
    expect(enhanceCost(resolveItem("cloak_warden@14^5"))).toBeNull();
    const start = inv({
      bag: grid(5, [{ id, qty: 1 }]),
      pouch: grid(8, [{ id: "riftglass", qty: 9 }, { id: want(id), qty: 12 }]),
    });
    const out = applyCraft(start, { recipe: "enhance", target: { c: "bag", i: 0 } }, rng(), ctx);
    expect(out.ok && out.inventory.bag[0]!.id).toBe("cloak_warden+warded@14^5");
    expect(out.ok && out.inventory.gold).toBe(500 - 200);
  });

  test("imbue adds a distinct enchantment; legendaries and full items refuse", () => {
    const amulet = "amulet_vigor+keen@9";
    const start = inv({ pouch: grid(8, [{ id: want(amulet), qty: 10 }, { id: "riftglass", qty: 2 }]) });
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

  test("salvage gives back its reagent (and riftglass from rich work); never the staff in hand", () => {
    const rich = "ember_staff+keen+hasty@23^3";
    expect(salvageYield(resolveItem(rich))).toEqual([
      { id: want(rich), qty: 3 },
      { id: "riftglass", qty: 1 },
    ]);
    const plain = "boots_hover+swift@12";
    const start = inv({ bag: grid(5, [{ id: plain, qty: 1 }]) });
    const out = applyCraft(start, { recipe: "salvage", target: { c: "bag", i: 0 } }, rng(), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.inventory.bag[0]).toBeNull();
      expect(countItem(out.inventory, want(plain))).toBe(2);
      expect(countItem(out.inventory, "riftglass")).toBe(0);
    }
    expect(applyCraft(start, { recipe: "salvage", target: { c: "equipment", s: "staff" } }, rng(), ctx).ok).toBe(false);
  });

  test("no loop prints riftglass: imbuing costs more than salvaging returns", () => {
    const before = "amulet_vigor+keen@9";
    const imbued = "amulet_vigor+keen+warded@9";
    const spent = 2;
    const back = salvageYield(resolveItem(imbued)).find((s) => s.id === "riftglass")?.qty ?? 0;
    expect(back).toBeLessThan(spent);
    expect(salvageYield(resolveItem(before)).some((s) => s.id === "riftglass")).toBe(false);
  });

  test("the Great Work forges a legendary", () => {
    const start = inv({ pouch: grid(8, [{ id: "warden_sigil", qty: 3 }, { id: "riftglass", qty: 5 }]) });
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
