import { describe, expect, test } from "bun:test";
import {
  addToGrid,
  clearSlot,
  emptyGrid,
  hasRoom,
  markBanked,
  moveItem,
  readSlot,
  stripRunLoot,
  takeOneAt,
  type Carried,
  type Grid,
  type SlotRef,
} from "./inventory";
import type { ItemStack } from "./types";

const stack = (defId: string, qty = 1, runLoot = false): ItemStack => ({ defId, qty, runLoot });

describe("inventory grids", () => {
  test("addToGrid fills the first empty cell", () => {
    const grid = addToGrid(emptyGrid(3), "amulet_vigor", false)!;
    expect(grid[0]).toEqual(stack("amulet_vigor"));
    expect(grid[1]).toBeNull();
  });

  test("consumables stack up to their cap, then overflow to a new cell", () => {
    let grid = emptyGrid(2);
    for (let i = 0; i < 6; i++) grid = addToGrid(grid, "potion_hp_weak", false)!;
    expect(grid[0]).toEqual(stack("potion_hp_weak", 5)); // maxStack 5
    expect(grid[1]).toEqual(stack("potion_hp_weak", 1));
  });

  test("gear never stacks", () => {
    let grid = emptyGrid(2);
    grid = addToGrid(grid, "amulet_vigor", false)!;
    grid = addToGrid(grid, "amulet_vigor", false)!;
    expect(grid[0]!.qty).toBe(1);
    expect(grid[1]!.qty).toBe(1);
  });

  test("banked and at-risk stacks never merge", () => {
    let grid = emptyGrid(3);
    grid = addToGrid(grid, "potion_hp_weak", false)!;
    grid = addToGrid(grid, "potion_hp_weak", true)!;
    expect(grid[0]).toEqual(stack("potion_hp_weak", 1, false));
    expect(grid[1]).toEqual(stack("potion_hp_weak", 1, true));
  });

  test("addToGrid returns null when truly full", () => {
    let grid = emptyGrid(1);
    grid = addToGrid(grid, "amulet_vigor", false)!;
    expect(addToGrid(grid, "amulet_fury", false)).toBeNull();
    expect(hasRoom(grid, "amulet_fury", false)).toBe(false);
    // ...but a stackable with headroom still fits.
    const potions = [stack("potion_hp_weak", 2)];
    expect(hasRoom(potions, "potion_hp_weak", false)).toBe(true);
  });

  test("addToGrid never mutates its input", () => {
    const grid = [stack("potion_hp_weak", 1)];
    addToGrid(grid, "potion_hp_weak", false);
    expect(grid[0]!.qty).toBe(1);
  });

  test("takeOneAt decrements and empties", () => {
    let grid: Grid = [stack("potion_hp_weak", 2)];
    grid = takeOneAt(grid, 0);
    expect(grid[0]).toEqual(stack("potion_hp_weak", 1));
    grid = takeOneAt(grid, 0);
    expect(grid[0]).toBeNull();
  });

  test("death strips exactly the at-risk stacks", () => {
    const grid = [stack("amulet_vigor", 1, true), stack("potion_hp_weak", 3, false), null];
    const { grid: kept, lost } = stripRunLoot(grid);
    expect(kept[0]).toBeNull();
    expect(kept[1]).toEqual(stack("potion_hp_weak", 3));
    expect(lost).toEqual([stack("amulet_vigor", 1, true)]);
  });

  test("banking marks everything safe", () => {
    const grid = markBanked([stack("amulet_vigor", 1, true), null]);
    expect(grid[0]!.runLoot).toBe(false);
  });
});

describe("moveItem (drag & drop)", () => {
  const carried = (over: Partial<Carried> = {}): Carried => ({
    equipment: {
      staff: { defId: "apprentice_staff", runLoot: false },
      amulet: null,
      cloak: null,
      boots: { defId: "worn_boots", runLoot: false },
    },
    bag: emptyGrid(5),
    belt: emptyGrid(2),
    chest: emptyGrid(30),
    ...over,
  });
  const bag0: SlotRef = { container: "bag", index: 0 };
  const beltQ: SlotRef = { container: "belt", index: 0 };
  const staffSlot: SlotRef = { container: "equipment", slot: "staff" };
  const bootsSlot: SlotRef = { container: "equipment", slot: "boots" };

  test("bag gear equips into its matching slot, swapping the occupant back", () => {
    const inv = carried({ bag: [stack("ember_staff", 1, true), null, null, null, null] });
    const next = moveItem(inv, bag0, staffSlot)!;
    expect(next.equipment.staff).toEqual({ defId: "ember_staff", runLoot: true });
    expect(next.bag[0]).toEqual(stack("apprentice_staff"));
  });

  test("gear refuses the wrong equipment slot and the belt", () => {
    const inv = carried({ bag: [stack("ember_staff"), null, null, null, null] });
    expect(moveItem(inv, bag0, bootsSlot)).toBeNull();
    expect(moveItem(inv, bag0, beltQ)).toBeNull();
  });

  test("boots can be unequipped to the bag; the staff cannot", () => {
    const inv = carried();
    const next = moveItem(inv, bootsSlot, bag0)!;
    expect(next.equipment.boots).toBeNull();
    expect(next.bag[0]).toEqual(stack("worn_boots"));
    expect(moveItem(inv, staffSlot, bag0)).toBeNull(); // empty target = staffless
  });

  test("the staff CAN be swapped with another staff in the bag", () => {
    const inv = carried({ bag: [stack("void_staff"), null, null, null, null] });
    const next = moveItem(inv, staffSlot, bag0)!;
    expect(next.equipment.staff.defId).toBe("void_staff");
    expect(next.bag[0]!.defId).toBe("apprentice_staff");
  });

  test("consumables move to the belt; merging tops up stacks with leftover", () => {
    const inv = carried({
      bag: [stack("potion_hp_weak", 4), null, null, null, null],
      belt: [stack("potion_hp_weak", 3), null],
    });
    const next = moveItem(inv, bag0, beltQ)!;
    expect(next.belt[0]).toEqual(stack("potion_hp_weak", 5)); // maxStack 5
    expect(next.bag[0]).toEqual(stack("potion_hp_weak", 2));
  });

  test("banked and at-risk stacks swap instead of merging", () => {
    const inv = carried({
      bag: [stack("potion_hp_weak", 2, true), null, null, null, null],
      belt: [stack("potion_hp_weak", 2, false), null],
    });
    const next = moveItem(inv, bag0, beltQ)!;
    expect(next.belt[0]).toEqual(stack("potion_hp_weak", 2, true));
    expect(next.bag[0]).toEqual(stack("potion_hp_weak", 2, false));
  });

  test("bag ↔ chest moves whole stacks", () => {
    const inv = carried({ bag: [stack("potion_mp_weak", 3), null, null, null, null] });
    const next = moveItem(inv, bag0, { container: "chest", index: 7 })!;
    expect(next.chest[7]).toEqual(stack("potion_mp_weak", 3));
    expect(next.bag[0]).toBeNull();
  });

  test("no-ops: same cell, empty source", () => {
    const inv = carried({ bag: [stack("amulet_vigor"), null, null, null, null] });
    expect(moveItem(inv, bag0, bag0)).toBeNull();
    expect(moveItem(inv, { container: "bag", index: 1 }, bag0)).toBeNull();
  });

  test("moveItem never mutates its input", () => {
    const inv = carried({ bag: [stack("ember_staff"), null, null, null, null] });
    moveItem(inv, bag0, staffSlot);
    expect(inv.bag[0]!.defId).toBe("ember_staff");
    expect(inv.equipment.staff.defId).toBe("apprentice_staff");
  });

  test("clearSlot empties any cell except the staff", () => {
    const inv = carried({ bag: [stack("amulet_vigor"), null, null, null, null] });
    expect(clearSlot(inv, bag0)!.bag[0]).toBeNull();
    expect(clearSlot(inv, staffSlot)).toBeNull();
    expect(clearSlot(inv, bootsSlot)!.equipment.boots).toBeNull();
    expect(readSlot(clearSlot(inv, bootsSlot)!, bootsSlot)).toBeNull();
  });
});
