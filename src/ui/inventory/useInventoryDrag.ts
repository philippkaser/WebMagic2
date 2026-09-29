import { useState } from "react";
import { resolveItem, type ResolvedItem } from "../../items/catalog";
import { moveItem as moveItemPure, type Carried, type SlotRef } from "../../items/inventory";
import type { ItemStack } from "../../items/types";
import { useGame } from "../../state/gameStore";
import type { SlotCellWiring } from "./SlotCell";

/** Drag-and-drop state for the inventory screen. HTML5 drag events carry no
 * typed payload, so the SlotRef being dragged lives here in React state, and
 * every cell gets identical wiring from `cellProps`. A cell asks the pure
 * move rules whether it would accept the drop (to light up as a target);
 * the store — and the server — still have the final say on the move. */
export function useInventoryDrag(
  inv: Carried,
  inVillage: boolean,
  onInspect: (item: ResolvedItem | null) => void,
) {
  const [drag, setDrag] = useState<SlotRef | null>(null);
  const endDrag = () => setDrag(null);

  const cellProps = (ref: SlotRef, stack: ItemStack | null): SlotCellWiring => ({
    stack,
    dragRef: ref,
    dragging: drag,
    onBeginDrag: setDrag,
    onEndDrag: endDrag,
    canDrop: (from: SlotRef) =>
      moveItemPure(inv, from, ref) !== null &&
      // Chest moves only work in the village (the store enforces it too).
      (inVillage || (from.container !== "chest" && ref.container !== "chest")),
    onDropItem: (from: SlotRef) => useGame.getState().moveItem(from, ref),
    onHover: (itemId: string | undefined) => onInspect(itemId ? resolveItem(itemId) : null),
  });

  return { drag, endDrag, cellProps };
}
