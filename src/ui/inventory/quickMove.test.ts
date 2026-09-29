import { describe, expect, test } from "bun:test";
import { emptyGrid, type Carried } from "../../items/inventory";
import type { ItemStack } from "../../items/types";
import { quickMoveTarget } from "./quickMove";

const stack = (defId: string, qty = 1): ItemStack => ({ defId, qty, runLoot: false });

function carried(over: Partial<Carried> = {}): Carried {
  return {
    equipment: {
      staff: { defId: "apprentice_staff", runLoot: false },
      amulet: { defId: "amulet_focus", runLoot: false },
      cloak: null,
      boots: null,
    },
    bag: emptyGrid(5),
    belt: emptyGrid(2),
    chest: emptyGrid(30),
    ...over,
  };
}

describe("quickMoveTarget (click-to-move in the inventory screen)", () => {
  test("empty cell → nothing to move", () => {
    expect(quickMoveTarget(carried(), { container: "bag", index: 0 }, false)).toBeNull();
  });

  test("bag gear → its equipment slot", () => {
    const inv = carried({ bag: [stack("cloak_shadow"), null, null, null, null] });
    expect(quickMoveTarget(inv, { container: "bag", index: 0 }, false)).toEqual({
      container: "equipment",
      slot: "cloak",
    });
  });

  test("bag consumable → first free belt slot, else Q", () => {
    const bag = [stack("potion_hp_weak"), null, null, null, null];
    expect(quickMoveTarget(carried({ bag }), { container: "bag", index: 0 }, false)).toEqual({
      container: "belt",
      index: 0,
    });
    const halfBelt = [stack("potion_mp_weak"), null];
    expect(
      quickMoveTarget(carried({ bag, belt: halfBelt }), { container: "bag", index: 0 }, false),
    ).toEqual({ container: "belt", index: 1 });
    const fullBelt = [stack("potion_mp_weak"), stack("potion_mp_weak")];
    expect(
      quickMoveTarget(carried({ bag, belt: fullBelt }), { container: "bag", index: 0 }, false),
    ).toEqual({ container: "belt", index: 0 });
  });

  test("with the chest open, bag → first free chest cell (none free → no move)", () => {
    const bag = [stack("cloak_shadow"), null, null, null, null];
    const chest = emptyGrid(30);
    chest[0] = stack("boots_hover");
    expect(quickMoveTarget(carried({ bag, chest }), { container: "bag", index: 0 }, true)).toEqual({
      container: "chest",
      index: 1,
    });
    const full = Array.from({ length: 30 }, () => stack("boots_hover"));
    expect(quickMoveTarget(carried({ bag, chest: full }), { container: "bag", index: 0 }, true)).toBeNull();
  });

  test("chest → first free bag cell (none free → no move)", () => {
    const chest = emptyGrid(30);
    chest[3] = stack("boots_hover");
    const bag = [stack("cloak_shadow"), null, null, null, null];
    expect(quickMoveTarget(carried({ bag, chest }), { container: "chest", index: 3 }, true)).toEqual({
      container: "bag",
      index: 1,
    });
    const fullBag = Array.from({ length: 5 }, () => stack("cloak_shadow"));
    expect(
      quickMoveTarget(carried({ bag: fullBag, chest }), { container: "chest", index: 3 }, true),
    ).toBeNull();
  });

  test("equipment and belt → back to the first free bag cell", () => {
    expect(quickMoveTarget(carried(), { container: "equipment", slot: "amulet" }, false)).toEqual({
      container: "bag",
      index: 0,
    });
    const belt = [null, stack("potion_hp_weak")];
    const bag = [stack("cloak_shadow"), null, null, null, null];
    expect(quickMoveTarget(carried({ bag, belt }), { container: "belt", index: 1 }, true)).toEqual({
      container: "bag",
      index: 1,
    });
    const fullBag = Array.from({ length: 5 }, () => stack("cloak_shadow"));
    expect(
      quickMoveTarget(carried({ bag: fullBag }), { container: "equipment", slot: "amulet" }, false),
    ).toBeNull();
  });
});
