import { describe, expect, test } from "bun:test";
import {
  addToGrid,
  emptyGrid,
  hasRoom,
  markBanked,
  stripRunLoot,
  takeOneAt,
  type Grid,
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
