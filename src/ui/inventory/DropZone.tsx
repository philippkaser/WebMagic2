import type { DragEvent } from "react";
import { sellValue } from "../../items/economy";
import { readSlot, type Carried, type SlotRef } from "../../items/inventory";
import { palette } from "../theme";
import { cellStyles } from "./SlotCell";

/** What letting go of an item over the bin does on this screen. */
export type DropMode = "drop" | "discard" | "sell";

/** Drag an item here to get rid of it. In the dungeon it drops as real orbs
 * at your feet (floor-mates can grab them — gifting!); in the village it
 * discards; at the merchant it SELLS, showing Maro's offer live. */
export function DropZone({
  drag,
  inv,
  mode,
  onDropItem,
}: {
  drag: SlotRef | null;
  inv: Carried;
  mode: DropMode;
  onDropItem: (from: SlotRef) => void;
}) {
  const active =
    drag !== null && !(drag.container === "equipment" && drag.slot === "staff");
  const stack = active && drag ? readSlot(inv, drag) : null;
  const offer =
    mode === "sell" && stack ? (sellValue(stack.defId) ?? 0) * stack.qty : null;
  const hue = mode === "sell" ? palette.gold : "#d84a4a";
  return (
    <div style={{ textAlign: "center" }}>
      <div
        onDragOver={(e: DragEvent) => {
          if (active) e.preventDefault();
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          if (drag && active) onDropItem(drag);
        }}
        style={{
          ...cellStyles.cell,
          width: 58,
          height: 58,
          borderStyle: "dashed",
          borderColor: active ? hue : palette.slotEmpty,
          background: active ? (mode === "sell" ? "#241f10" : "#241214") : palette.well,
          color: active ? hue : palette.faint,
          fontSize: offer !== null ? 13 : 20,
        }}
      >
        {offer !== null ? `+${offer}◈` : "⤓"}
      </div>
      <div style={cellStyles.cellLabel}>{mode}</div>
    </div>
  );
}
