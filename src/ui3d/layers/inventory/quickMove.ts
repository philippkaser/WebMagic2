import { getItemDef } from "../../../items/catalog";
import { readSlot, type Carried, type Grid, type SlotRef } from "../../../items/inventory";
import type { GearSlot } from "../../../items/types";

/** Where a shift-click (or double-click) on a socket sends its item — the
 * "obvious" move, so drag & drop is never required:
 *  - bag, with the chest open in the village → first free chest cell
 *  - chest → first free bag cell
 *  - bag consumable → first free belt slot (else swaps into Q)
 *  - bag gear → its equipment slot (swapping out what's worn)
 *  - equipment / belt → first free bag cell
 * Returns null when there is nothing to move or no room. Pure: it only
 * proposes a target; items/inventory.ts#moveItem (via the store) still
 * decides whether the move is legal. */
export function quickMoveTarget(inv: Carried, from: SlotRef, chestOpen: boolean): SlotRef | null {
  const stack = readSlot(inv, from);
  if (!stack) return null;
  const def = getItemDef(stack.defId);
  if (from.container === "bag" || from.container === "chest") {
    if (chestOpen && from.container === "bag") {
      const free = firstFree(inv.chest);
      return free !== -1 ? { container: "chest", index: free } : null;
    }
    if (from.container === "chest") {
      const free = firstFree(inv.bag);
      return free !== -1 ? { container: "bag", index: free } : null;
    }
    if (def.slot === "consumable") {
      const free = firstFree(inv.belt);
      return { container: "belt", index: free === -1 ? 0 : free };
    }
    return { container: "equipment", slot: def.slot as GearSlot };
  }
  // Equipment/belt → back to the bag.
  const free = firstFree(inv.bag);
  return free !== -1 ? { container: "bag", index: free } : null;
}

function firstFree(grid: Grid): number {
  return grid.indexOf(null);
}
