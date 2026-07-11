import { maxStackOf } from "./catalog";
import type { ItemStack } from "./types";

/** Pure inventory-grid logic: bags, the Q/E belt and the village chest are
 * all the same thing — a fixed row of stack cells. No stores, no rendering;
 * unit-tested and shared by every screen that moves items around. */

export const BAG_SLOTS = 5;
export const BELT_SLOTS = 2; // [0] = Q, [1] = E
export const CHEST_SLOTS = 30;

export type Grid = (ItemStack | null)[];

export function emptyGrid(size: number): Grid {
  return Array.from({ length: size }, () => null);
}

/** Clone a grid (cells are copied — mutations never leak into store state). */
export function cloneGrid(grid: Grid): Grid {
  return grid.map((s) => (s ? { ...s } : null));
}

/** Try to add one item: top up an existing stack first (only stacks with the
 * same runLoot flag merge — banked and at-risk copies must stay separable),
 * then the first empty cell. Returns a new grid, or null if there's no room. */
export function addToGrid(grid: Grid, defId: string, runLoot: boolean): Grid | null {
  const max = maxStackOf(defId);
  if (max > 1) {
    const i = grid.findIndex(
      (s) => s !== null && s.defId === defId && s.runLoot === runLoot && s.qty < max,
    );
    if (i !== -1) {
      const next = cloneGrid(grid);
      next[i]!.qty++;
      return next;
    }
  }
  const free = grid.indexOf(null);
  if (free === -1) return null;
  const next = cloneGrid(grid);
  next[free] = { defId, qty: 1, runLoot };
  return next;
}

export function hasRoom(grid: Grid, defId: string, runLoot: boolean): boolean {
  if (grid.includes(null)) return true;
  const max = maxStackOf(defId);
  return (
    max > 1 &&
    grid.some((s) => s !== null && s.defId === defId && s.runLoot === runLoot && s.qty < max)
  );
}

/** Remove one item from a cell; the cell empties when the stack runs out. */
export function takeOneAt(grid: Grid, index: number): Grid {
  const stack = grid[index];
  if (!stack) return grid;
  const next = cloneGrid(grid);
  next[index] = stack.qty > 1 ? { ...stack, qty: stack.qty - 1 } : null;
  return next;
}

/** Drop every at-risk stack (death: the dungeon keeps what wasn't banked).
 * Returns the surviving grid plus the names needed for the death screen. */
export function stripRunLoot(grid: Grid): { grid: Grid; lost: ItemStack[] } {
  const lost: ItemStack[] = [];
  const next = grid.map((s) => {
    if (s?.runLoot) {
      lost.push(s);
      return null;
    }
    return s;
  });
  return { grid: next, lost };
}

/** Banking: everything carried becomes safe. */
export function markBanked(grid: Grid): Grid {
  return grid.map((s) => (s ? { ...s, runLoot: false } : null));
}
