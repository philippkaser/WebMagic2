import { getItemDef, maxStackOf } from "./catalog";
import type { Equipment, GearSlot, ItemInstance, ItemStack } from "./types";

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

// ── Generic item movement (drag & drop, click-to-move) ──────────────────────
// One pure function covers every container pair: equipment ↔ bag ↔ belt ↔
// chest, with swap semantics, consumable stack merging, and the two hard
// rules (belt holds only consumables; the staff slot may never end empty).

export type SlotRef =
  | { container: "equipment"; slot: GearSlot }
  | { container: "bag" | "belt" | "chest"; index: number };

/** Everything a wizard owns, as one movable unit. */
export interface Carried {
  equipment: Equipment;
  bag: Grid;
  belt: Grid;
  chest: Grid;
}

export function refsEqual(a: SlotRef, b: SlotRef): boolean {
  if (a.container !== b.container) return false;
  if (a.container === "equipment") return a.slot === (b as { slot: GearSlot }).slot;
  return a.index === (b as { index: number }).index;
}

export function readSlot(inv: Carried, ref: SlotRef): ItemStack | null {
  if (ref.container === "equipment") {
    const item = inv.equipment[ref.slot];
    return item ? { defId: item.defId, qty: 1, runLoot: item.runLoot } : null;
  }
  return inv[ref.container][ref.index] ?? null;
}

/** Could this cell hold that stack (ignoring what's there now)? */
function accepts(ref: SlotRef, stack: ItemStack | null): boolean {
  if (!stack) return true;
  const def = getItemDef(stack.defId);
  if (ref.container === "equipment") return def.slot === ref.slot && stack.qty === 1;
  if (ref.container === "belt") return def.slot === "consumable";
  return true; // bag/chest take anything
}

function cloneCarried(inv: Carried): Carried {
  return {
    equipment: { ...inv.equipment },
    bag: cloneGrid(inv.bag),
    belt: cloneGrid(inv.belt),
    chest: cloneGrid(inv.chest),
  };
}

function writeSlot(inv: Carried, ref: SlotRef, stack: ItemStack | null): void {
  if (ref.container === "equipment") {
    // The staff-never-empty invariant is enforced by moveItem/clearSlot; the
    // cast lets one writer serve all four slots.
    (inv.equipment as Record<GearSlot, ItemInstance | null>)[ref.slot] = stack
      ? { defId: stack.defId, runLoot: stack.runLoot }
      : null;
  } else {
    inv[ref.container][ref.index] = stack;
  }
}

/** Empty a cell (item dropped/discarded). Refuses to empty the staff slot. */
export function clearSlot(inv: Carried, ref: SlotRef): Carried | null {
  if (ref.container === "equipment" && ref.slot === "staff") return null;
  if (!readSlot(inv, ref)) return null;
  const next = cloneCarried(inv);
  writeSlot(next, ref, null);
  return next;
}

/** Move/swap/merge between two cells. Returns the new Carried, or null when
 * the move is illegal (wrong slot type, staff left empty, nothing to move). */
export function moveItem(inv: Carried, from: SlotRef, to: SlotRef): Carried | null {
  if (refsEqual(from, to)) return null;
  const moving = readSlot(inv, from);
  if (!moving) return null;
  const target = readSlot(inv, to);

  // Same consumable with headroom → merge instead of swap.
  const max = maxStackOf(moving.defId);
  if (
    target &&
    max > 1 &&
    target.defId === moving.defId &&
    target.runLoot === moving.runLoot &&
    target.qty < max &&
    to.container !== "equipment"
  ) {
    const merged = Math.min(target.qty + moving.qty, max);
    const leftover = target.qty + moving.qty - merged;
    const next = cloneCarried(inv);
    writeSlot(next, to, { ...target, qty: merged });
    writeSlot(next, from, leftover > 0 ? { ...moving, qty: leftover } : null);
    return next;
  }

  // Swap: both cells must accept their new occupant…
  if (!accepts(to, moving) || !accepts(from, target)) return null;
  // …and the staff slot may never end up empty.
  if (from.container === "equipment" && from.slot === "staff" && !target) return null;
  const next = cloneCarried(inv);
  writeSlot(next, to, moving);
  writeSlot(next, from, target);
  return next;
}
