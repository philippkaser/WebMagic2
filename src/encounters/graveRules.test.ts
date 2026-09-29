import { describe, expect, test } from "bun:test";
import { BAG_SLOTS, BELT_SLOTS, CHEST_SLOTS, emptyGrid, type Carried } from "../items/inventory";
import {
  GRAVE_LIMITS,
  planGravePicks,
  graveIsEmpty,
  graveItemCount,
  sanitizeGraveContents,
  sanitizePicks,
  takeFromGrave,
} from "./graveRules";

describe("grave rules", () => {
  test("contents keep only real items, capped stacks and bounded gold", () => {
    const c = sanitizeGraveContents({
      items: [
        { id: "ember_staff+keen@7", qty: 1 },
        { id: "potion_hp_weak", qty: 99 }, // capped to its max stack
        { id: "forged_crown", qty: 1 }, // unknown → dropped
        { id: "amulet_vigor", qty: 0 }, // empty → dropped
        null,
      ],
      gold: 1e9,
    })!;
    expect(c.items).toEqual([
      { id: "ember_staff+keen@7", qty: 1 },
      { id: "potion_hp_weak", qty: 5 },
    ]);
    expect(c.gold).toBe(GRAVE_LIMITS.maxGold);
  });

  test("nothing of value raises no grave", () => {
    expect(sanitizeGraveContents({ items: [], gold: 0 })).toBeNull();
    expect(sanitizeGraveContents("junk")).toBeNull();
    expect(sanitizeGraveContents({ items: [], gold: 12 })).toEqual({ items: [], gold: 12 });
  });

  test("stack count is bounded", () => {
    const items = Array.from({ length: 40 }, () => ({ id: "amulet_vigor", qty: 1 }));
    expect(sanitizeGraveContents({ items, gold: 0 })!.items).toHaveLength(GRAVE_LIMITS.maxStacks);
  });

  test("picks are validated against what's left, and taking keeps indices stable", () => {
    const grave = {
      items: [
        { id: "amulet_vigor", qty: 1 },
        { id: "potion_hp_weak", qty: 3 },
      ],
      gold: 40,
    };
    expect(
      sanitizePicks(grave, [
        { i: 1, qty: 9 }, // capped to 3
        { i: 1, qty: 1 }, // duplicate index
        { i: 7, qty: 1 }, // out of range
        { i: 0, qty: -2 }, // nonsense
      ]),
    ).toEqual([{ i: 1, qty: 3 }]);

    const first = takeFromGrave(grave, [{ i: 1, qty: 2 }], true);
    expect(first.taken).toEqual([{ id: "potion_hp_weak", qty: 2 }]);
    expect(first.gold).toBe(40);
    expect(first.grave.items[1].qty).toBe(1);
    expect(first.grave.gold).toBe(0);
    expect(graveItemCount(first.grave)).toBe(2);

    const second = takeFromGrave(first.grave, [{ i: 0, qty: 1 }, { i: 1, qty: 1 }], true);
    expect(second.gold).toBe(0);
    expect(graveIsEmpty(second.grave)).toBe(true);
    // Picking from an emptied stack yields nothing.
    expect(sanitizePicks(second.grave, [{ i: 0, qty: 1 }])).toEqual([]);
  });
});

describe("planning a plunder", () => {
  test("takes what fits, copy by copy", () => {
    const inv: Carried = {
      equipment: { staff: { defId: "apprentice_staff", runLoot: false }, amulet: null, cloak: null, boots: null },
      bag: [
        { defId: "amulet_focus", qty: 1, runLoot: false },
        { defId: "amulet_focus", qty: 1, runLoot: false },
        { defId: "amulet_focus", qty: 1, runLoot: false },
        { defId: "amulet_focus", qty: 1, runLoot: false },
        null,
      ],
      belt: [{ defId: "potion_mp_weak", qty: 5, runLoot: false }, null],
      chest: emptyGrid(CHEST_SLOTS),
    };
    expect(BAG_SLOTS).toBe(5);
    expect(BELT_SLOTS).toBe(2);
    const grave = {
      items: [
        { id: "amulet_vigor@4", qty: 1 }, // → empty amulet slot
        { id: "cloak_warden@4", qty: 1 }, // → empty cloak slot
        { id: "potion_hp_weak", qty: 7 }, // 5 → belt[1], 2 → the last bag cell
        { id: "boots_hover@4", qty: 1 }, // boots slot empty → equips
        { id: "arc_staff@4", qty: 1 }, // staff slot full, bag full → stays
      ],
      gold: 30,
    };
    expect(planGravePicks(inv, grave)).toEqual([
      { i: 0, qty: 1 },
      { i: 1, qty: 1 },
      { i: 2, qty: 7 },
      { i: 3, qty: 1 },
    ]);
  });
});
