import { useState, type CSSProperties } from "react";
import type { ResolvedItem } from "../../items/catalog";
import type { Carried, SlotRef } from "../../items/inventory";
import type { ItemStack } from "../../items/types";
import { useGame, type Overlay } from "../../state/gameStore";
import { useEscapeClosesOverlay } from "../hooks";
import { palette, styles as theme } from "../theme";
import { ChestPanel } from "./ChestPanel";
import { DetailStrip } from "./DetailStrip";
import { DropZone, type DropMode } from "./DropZone";
import { MerchantPanel } from "./MerchantPanel";
import { quickMoveTarget } from "./quickMove";
import { SlotCell } from "./SlotCell";
import { useInventoryDrag } from "./useInventoryDrag";
import { WizardViewer } from "./WizardViewer";

/** The in-game overlays this screen renders. Listed explicitly (not "every
 * overlay but X") so a new overlay kind in the store never falls through to
 * the inventory by accident. */
export type InventoryMode = Extract<Overlay, "inventory" | "chest" | "merchant">;

export function isInventoryMode(overlay: Overlay): overlay is InventoryMode {
  return overlay === "inventory" || overlay === "chest" || overlay === "merchant";
}

/** The inventory screen family. One layout, three flavors:
 *  - "inventory": the wizard, gear, belt and bag
 *  - "chest":     inventory + the 30-slot village chest below
 *  - "merchant":  inventory + Maro's ware list below
 * Items move by DRAG & DROP between any cells (click still does the obvious
 * quick-move). All rules live in items/inventory.ts#moveItem — this screen
 * only proposes moves; the store (and the server) decide. */
export function InventoryScreen({ mode }: { mode: InventoryMode }) {
  const equipment = useGame((s) => s.equipment);
  const bag = useGame((s) => s.bag);
  const belt = useGame((s) => s.belt);
  const chest = useGame((s) => s.chest);
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const phase = useGame((s) => s.phase);
  const [inspected, setInspected] = useState<ResolvedItem | null>(null);

  // Escape (already unlocks the pointer) also closes the screen.
  useEscapeClosesOverlay();

  const act = useGame.getState();
  const inv: Carried = { equipment, bag, belt, chest };
  const inVillage = phase === "village";
  const { drag, endDrag, cellProps } = useInventoryDrag(inv, inVillage, setInspected);

  /** Click = the obvious quick-move for that cell. */
  const quickMove = (ref: SlotRef) => {
    const to = quickMoveTarget(inv, ref, mode === "chest" && inVillage);
    if (to) act.moveItem(ref, to);
  };

  const title =
    mode === "chest" ? "YOUR CHEST" : mode === "merchant" ? "MARO THE PROVISIONER" : "INVENTORY";
  const dropMode: DropMode = mode === "merchant" ? "sell" : phase === "dungeon" ? "drop" : "discard";

  return (
    <div style={theme.modalBackdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>{title}</span>
          <span style={styles.gold}>
            ◈ {gold}
            {runGold > 0 && <span style={{ color: palette.runLoot }}> +{runGold}◦</span>}
            <span style={{ color: palette.dim }}> gold</span>
          </span>
          <button style={theme.closeButton} onClick={() => act.setOverlay("none")}>
            ✕
          </button>
        </div>

        <div style={styles.columns}>
          {/* Left: staff + belt */}
          <div style={styles.sideColumn}>
            <SlotCell
              label="staff"
              {...cellProps({ container: "equipment", slot: "staff" }, toStack(equipment.staff))}
            />
            {[0, 1].map((i) => (
              <SlotCell
                key={i}
                label={i === 0 ? "Q" : "E"}
                accent
                {...cellProps({ container: "belt", index: i }, belt[i])}
                onClick={() => quickMove({ container: "belt", index: i })}
              />
            ))}
          </div>

          <WizardViewer />

          {/* Right: gear */}
          <div style={styles.sideColumn}>
            {(["amulet", "cloak", "boots"] as const).map((slot) => (
              <SlotCell
                key={slot}
                label={slot}
                {...cellProps({ container: "equipment", slot }, toStack(equipment[slot]))}
                onClick={() => quickMove({ container: "equipment", slot })}
              />
            ))}
          </div>
        </div>

        {/* Bag + the drop zone */}
        <div style={styles.bagRow}>
          {bag.map((stack, i) => (
            <SlotCell
              key={i}
              label={`${i + 1}`}
              {...cellProps({ container: "bag", index: i }, stack)}
              onClick={() => quickMove({ container: "bag", index: i })}
            />
          ))}
          <DropZone
            drag={drag}
            inv={inv}
            mode={dropMode}
            onDropItem={(from) => {
              if (mode === "merchant") act.sellStack(from);
              else act.dropStack(from);
              endDrag();
            }}
          />
        </div>

        {/* Detail strip: whatever the cursor is over, compared to what's worn. */}
        <DetailStrip inspected={inspected} inv={inv} mode={mode} />

        {mode === "chest" && <ChestPanel chest={chest} cellProps={cellProps} onQuickMove={quickMove} />}

        {mode === "merchant" && <MerchantPanel gold={gold} onInspect={setInspected} />}

        <div style={styles.footer}>
          drag items to move · drag onto ⤓ to{" "}
          {dropMode} · Q/E use belt ·
          I closes
        </div>
      </div>
    </div>
  );
}

/** Equipment holds bare instances; cells render stacks. */
function toStack(inst: { defId: string; runLoot: boolean } | null): ItemStack | null {
  return inst ? { defId: inst.defId, qty: 1, runLoot: inst.runLoot } : null;
}

const styles: Record<string, CSSProperties> = {
  panel: {
    width: "min(92vw, 640px)",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "rgba(12,9,18,0.96)",
    border: `1px solid ${palette.borderStrong}`,
    padding: "16px 22px 12px",
    letterSpacing: 1,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
    borderBottom: `1px solid ${palette.border}`,
    paddingBottom: 10,
    marginBottom: 14,
  },
  title: { fontSize: 18, letterSpacing: 4, color: palette.bright, flex: 1 },
  gold: { fontSize: 15, color: palette.gold },
  columns: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 26,
  },
  sideColumn: { display: "flex", flexDirection: "column", gap: 10 },
  bagRow: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  footer: { marginTop: 12, fontSize: 10, color: palette.faint, textAlign: "center", letterSpacing: 2 },
};
