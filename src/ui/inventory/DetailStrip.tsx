import type { CSSProperties } from "react";
import { resolveItem, type ResolvedItem } from "../../items/catalog";
import type { Carried } from "../../items/inventory";
import type { GearSlot } from "../../items/types";
import { iconOf, statLines } from "../itemInfo";
import { palette } from "../theme";
import type { InventoryMode } from "./InventoryScreen";

/** Detail strip: whatever the cursor is over, compared to what's worn in the
 * same slot. With nothing hovered it shows a per-mode usage hint instead, so
 * the strip never collapses and the layout doesn't jump. */
export function DetailStrip({
  inspected,
  inv,
  mode,
}: {
  inspected: ResolvedItem | null;
  inv: Carried;
  mode: InventoryMode;
}) {
  if (!inspected) {
    return (
      <div style={detailStyle}>
        <div style={{ color: palette.faint, fontSize: 12 }}>
          {mode === "chest"
            ? "Drag between bag and chest · click for the quick move"
            : mode === "merchant"
              ? "Everything is banked gold up front — Maro doesn't do credit"
              : "Drag items between slots · click for the quick move"}
        </div>
      </div>
    );
  }
  // What would this replace? Compare against the worn counterpart, with
  // per-stat arrows (▲ strictly better, ▼ worse — including what a swap
  // would give up).
  const def = inspected.def;
  const worn =
    def.slot !== "consumable" ? inv.equipment[def.slot as GearSlot] : null;
  const wornItem =
    worn && worn.defId !== inspected.itemId ? resolveItem(worn.defId) : null;
  return (
    <div style={detailStyle}>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: inspected.affix ? palette.enchant : def.color, fontSize: 14 }}>
            {inspected.affix && "✦ "}
            {iconOf(def)} {inspected.name}
            <span style={{ color: palette.dim, fontSize: 11 }}>{`  ·  tier ${def.tier}`}</span>
          </div>
          {statLines(inspected, wornItem).map((line) => (
            <div key={line.text} style={{ color: palette.body, fontSize: 12 }}>
              {line.text}
              {line.delta !== undefined && (
                <span style={{ color: line.delta > 0 ? "#7fdc8a" : "#e06a6a" }}>
                  {line.delta > 0 ? " ▲" : " ▼"}
                </span>
              )}
            </div>
          ))}
        </div>
        {wornItem && (
          <div style={{ flex: 1, opacity: 0.62 }}>
            <div style={{ color: palette.dim, fontSize: 10, letterSpacing: 2 }}>WEARING</div>
            <div style={{ color: wornItem.affix ? palette.enchant : wornItem.def.color, fontSize: 13 }}>
              {wornItem.affix && "✦ "}
              {iconOf(wornItem.def)} {wornItem.name}
            </div>
            {statLines(wornItem).map((line) => (
              <div key={line.text} style={{ color: palette.body, fontSize: 11 }}>
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const detailStyle: CSSProperties = {
  minHeight: 58,
  marginTop: 12,
  padding: "8px 12px",
  background: palette.inset,
  border: `1px solid ${palette.border}`,
};
