import type { CSSProperties } from "react";
import type { Grid, SlotRef } from "../../items/inventory";
import type { ItemStack } from "../../items/types";
import { SlotCell, type SlotCellWiring } from "./SlotCell";

/** The village chest: 30 small cells under the bag, same drag wiring as
 * every other cell. */
export function ChestPanel({
  chest,
  cellProps,
  onQuickMove,
}: {
  chest: Grid;
  cellProps: (ref: SlotRef, stack: ItemStack | null) => SlotCellWiring;
  onQuickMove: (ref: SlotRef) => void;
}) {
  return (
    <div style={chestGridStyle}>
      {chest.map((stack, i) => (
        <SlotCell
          key={i}
          small
          {...cellProps({ container: "chest", index: i }, stack)}
          onClick={() => onQuickMove({ container: "chest", index: i })}
        />
      ))}
    </div>
  );
}

const chestGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: 8,
  marginTop: 12,
  justifyItems: "center",
};
