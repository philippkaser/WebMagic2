import type { CSSProperties } from "react";
import { getItemDef, resolveItem, type ResolvedItem } from "../../items/catalog";
import { GAMBLE_PRICE, MERCHANT_STOCK } from "../../items/economy";
import { useGame } from "../../state/gameStore";
import { iconOf } from "../itemInfo";
import { FONT, palette } from "../theme";

/** Maro's ware list under the bag: fixed stock at fixed prices, plus the
 * Orb of Fortune gamble. Selling happens through the DropZone, not here. */
export function MerchantPanel({
  gold,
  onInspect,
}: {
  gold: number;
  onInspect: (item: ResolvedItem | null) => void;
}) {
  const act = useGame.getState();
  return (
    <div style={styles.wares}>
      {MERCHANT_STOCK.map(({ id, price }) => {
        const def = getItemDef(id);
        const affordable = gold >= price;
        return (
          <div key={id} style={styles.wareRow}>
            <span style={{ color: def.color, width: 22, textAlign: "center" }}>
              {iconOf(def)}
            </span>
            <span
              style={{ flex: 1, color: palette.item, cursor: "default" }}
              onMouseEnter={() => onInspect(resolveItem(id))}
            >
              {def.name}
              <span style={{ color: palette.dim, fontSize: 11 }}> — {def.desc}</span>
            </span>
            <span style={{ color: affordable ? palette.gold : "#7d6a3a", width: 70, textAlign: "right" }}>
              ◈ {price}
            </span>
            <button
              style={{ ...styles.buyButton, ...(affordable ? {} : styles.buyDisabled) }}
              disabled={!affordable}
              onClick={() => act.buyItem(id)}
            >
              BUY
            </button>
          </div>
        );
      })}
      {/* The gold sink: gear only, rolled past your checkpoint, juiced
          enchant odds. The dungeon decides; Maro just takes the coin. */}
      <div style={{ ...styles.wareRow, borderColor: "#4a3d5c" }}>
        <span style={{ color: palette.enchant, width: 22, textAlign: "center" }}>❖</span>
        <span style={{ flex: 1, color: palette.item }}>
          Orb of Fortune
          <span style={{ color: palette.dim, fontSize: 11 }}>
            {" "}— random gear, rolled beyond your checkpoint · often enchanted
          </span>
        </span>
        <span style={{ color: gold >= GAMBLE_PRICE ? palette.gold : "#7d6a3a", width: 70, textAlign: "right" }}>
          ◈ {GAMBLE_PRICE}
        </span>
        <button
          style={{
            ...styles.buyButton,
            ...(gold >= GAMBLE_PRICE ? { borderColor: palette.enchant } : styles.buyDisabled),
          }}
          disabled={gold < GAMBLE_PRICE}
          onClick={() => act.gamble()}
        >
          TEMPT
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wares: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 },
  wareRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    background: palette.inset,
    border: `1px solid ${palette.border}`,
    fontSize: 13,
  },
  buyButton: {
    fontFamily: FONT,
    fontSize: 12,
    letterSpacing: 2,
    padding: "5px 14px",
    background: palette.buttonBg,
    color: palette.bright,
    border: `1px solid ${palette.accent}`,
    cursor: "pointer",
  },
  buyDisabled: { borderColor: palette.slotEmpty, color: palette.faint, cursor: "default" },
};
