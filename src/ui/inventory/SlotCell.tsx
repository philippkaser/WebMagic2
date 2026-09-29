import type { CSSProperties, DragEvent } from "react";
import { resolveItem } from "../../items/catalog";
import { refsEqual, type SlotRef } from "../../items/inventory";
import type { ItemStack } from "../../items/types";
import { iconOf } from "../itemInfo";
import { FONT, palette } from "../theme";

/** Everything a cell needs from the screen besides its look: what it holds,
 * where it is, and the shared drag/hover wiring. Built per cell by
 * useInventoryDrag's `cellProps`. */
export interface SlotCellWiring {
  stack: ItemStack | null;
  dragRef: SlotRef;
  dragging: SlotRef | null;
  canDrop: (from: SlotRef) => boolean;
  onDropItem: (from: SlotRef) => void;
  onBeginDrag: (ref: SlotRef) => void;
  onEndDrag: () => void;
  onHover: (itemId: string | undefined) => void;
}

/** One inventory slot (gear, belt, bag or chest). A native <button> so it is
 * both a drag source and a drop target; it lights up only when the dragged
 * item could legally land here. */
export function SlotCell({
  label,
  stack,
  dragRef,
  dragging,
  canDrop,
  onDropItem,
  onBeginDrag,
  onEndDrag,
  onClick,
  onHover,
  accent = false,
  small = false,
}: SlotCellWiring & {
  label?: string;
  onClick?: () => void;
  accent?: boolean;
  small?: boolean;
}) {
  const item = stack ? resolveItem(stack.defId) : null;
  const def = item?.def ?? null;
  const size = small ? 42 : 58;
  const droppable = dragging !== null && !refsEqual(dragging, dragRef) && canDrop(dragging);
  return (
    <div style={{ textAlign: "center" }}>
      <button
        draggable={!!def}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item?.name ?? "");
          onBeginDrag(dragRef);
        }}
        onDragEnd={onEndDrag}
        onDragOver={(e: DragEvent) => {
          if (droppable) e.preventDefault();
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          if (dragging && droppable) onDropItem(dragging);
          onEndDrag();
        }}
        style={{
          ...cellStyles.cell,
          width: size,
          height: size,
          borderColor: droppable ? palette.accent : accent ? "#4a4436" : palette.border,
          background: droppable ? "#12241f" : palette.well,
          cursor: def ? "grab" : "default",
        }}
        onClick={def && onClick ? onClick : undefined}
        onMouseEnter={() => onHover(stack?.defId)}
        onMouseLeave={() => onHover(undefined)}
      >
        {item && def ? (
          <>
            <span style={{ color: def.color, fontSize: small ? 15 : 20, textShadow: `0 0 8px ${def.color}` }}>
              {iconOf(def)}
            </span>
            {stack!.qty > 1 && <span style={markStyles.qty}>{stack!.qty}</span>}
            {stack!.runLoot && (
              <span style={markStyles.runLoot} title="Lost on death until banked">
                ◦
              </span>
            )}
            {item.affix && (
              <span style={markStyles.enchantMark} title={`Enchanted: ${item.affix.desc}`}>
                ✦
              </span>
            )}
          </>
        ) : (
          <span style={{ color: palette.slotEmpty, fontSize: small ? 12 : 16 }}>·</span>
        )}
      </button>
      {label && <div style={cellStyles.cellLabel}>{label}</div>}
    </div>
  );
}

/** The square cell frame and its caption — shared with DropZone so the bin
 * lines up with the bag row. */
export const cellStyles = {
  cell: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: palette.well,
    border: `1px solid ${palette.border}`,
    fontFamily: FONT,
    padding: 0,
  },
  cellLabel: { fontSize: 10, color: palette.dim, marginTop: 3, letterSpacing: 1 },
} satisfies Record<string, CSSProperties>;

/** Corner badges: stack count, run-loot ◦, enchant ✦. */
const markStyles: Record<string, CSSProperties> = {
  qty: {
    position: "absolute",
    right: 3,
    bottom: 1,
    fontSize: 11,
    color: palette.bright,
    textShadow: "1px 1px 0 #000",
  },
  runLoot: { position: "absolute", left: 3, top: 0, fontSize: 12, color: palette.runLoot },
  enchantMark: { position: "absolute", right: 3, top: 0, fontSize: 10, color: palette.enchant },
};
