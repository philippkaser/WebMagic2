import { useCallback, useContext, useState, type MouseEvent } from "react";
import { getItemDef } from "../../items/catalog";
import { RARITIES } from "../../items/rarity";
import type { Equipment, ItemInstance } from "../../items/types";
import { UiScaleContext } from "../hooks";
import { compareItem, formatPower } from "../itemStats";
import { rarityColor } from "../theme";
import { Icon } from "./Icon";
import { Panel, Rule } from "./Panel";

const SLOT_LABEL = { staff: "Staff", amulet: "Amulet", cloak: "Cloak", boots: "Boots" } as const;
const TIP_W = 264;

/** Hover state for a set of cards: which item, and where the cursor is (in
 * the zoomed chrome's coordinate space). */
export function useItemTooltip() {
  const scale = useContext(UiScaleContext);
  const [hover, setHover] = useState<{ item: ItemInstance; x: number; y: number } | null>(null);
  const onHover = useCallback(
    (item: ItemInstance, e: MouseEvent) => setHover({ item, x: e.clientX / scale, y: e.clientY / scale }),
    [scale],
  );
  const onLeave = useCallback(() => setHover(null), []);
  return { hover, onHover, onLeave, scale };
}

/** Parchment tooltip: name in rarity colour, slot/level/power, what it does,
 * the stat change if equipped (or what it grants if worn), its lore, and the
 * one thing that matters most in a run: whether death can take it. */
export function ItemTooltip({
  item,
  x,
  y,
  equipment,
  hint,
}: {
  item: ItemInstance;
  x: number;
  y: number;
  /** Compare against this loadout; omit for items you can't equip here. */
  equipment?: Equipment;
  /** Footer call to action ("Click to equip"). */
  hint?: string;
}) {
  const scale = useContext(UiScaleContext);
  const def = getItemDef(item.defId);
  const rc = rarityColor(item.rarity);
  const cmp = equipment ? compareItem(item, equipment) : null;
  const viewW = window.innerWidth / scale;
  const viewH = window.innerHeight / scale;
  // Flip to the cursor's left near the right edge; clamp vertically.
  const left = x + 18 + TIP_W > viewW ? x - 18 - TIP_W : x + 18;
  const top = Math.max(8, Math.min(y - 20, viewH - 300));
  const powerDelta = cmp && cmp.replacesPower !== null ? cmp.power - cmp.replacesPower : null;

  return (
    <Panel parchment frame={item.rarity === "legendary" ? "gold" : "brass"} className="wm-tip" style={{ left, top }}>
      <div className="wm-tip__name" style={{ color: rc }}>
        {def.name}
      </div>
      <div className="wm-tip__sub">
        <Icon name="gem" tint={rc} scale={1} />
        <span className="wm-label" style={{ color: rc }}>
          {RARITIES[item.rarity].label}
        </span>
        <span className="wm-label">· {SLOT_LABEL[def.slot]} · Lv {item.level}</span>
      </div>
      <div className="wm-tip__desc">{def.desc}</div>

      <div className="wm-tip__power">
        <span className="wm-label">Power</span>
        <span style={{ fontSize: 16, color: "var(--wm-brass-light)" }}>{formatPower(cmp?.power ?? 0)}</span>
        {powerDelta !== null && Math.abs(powerDelta) > 0.05 && (
          <span className={powerDelta > 0 ? "wm-tip__up" : "wm-tip__down"}>
            {powerDelta > 0 ? "▲" : "▼"} {formatPower(Math.abs(powerDelta))} vs worn
          </span>
        )}
        {cmp?.equipped && <span className="wm-label" style={{ color: "var(--wm-arcane)" }}>worn</span>}
      </div>

      {cmp && cmp.lines.length > 0 && (
        <>
          <div className="wm-label" style={{ marginTop: 5 }}>
            {cmp.equipped ? "Grants" : "If equipped"}
          </div>
          <div className="wm-tip__stats">
            {cmp.lines.map((l) => (
              <FragmentLine key={l.label} {...l} />
            ))}
          </div>
        </>
      )}

      <Rule />
      <div className="wm-tip__lore wm-lore">“{def.lore}”</div>

      <div className="wm-tip__foot">
        {item.runLoot && (
          <span style={{ color: "#ff9a7a", display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="hourglass" tint="#ff8e5a" scale={1} /> Lost on death — escape to keep it
          </span>
        )}
        {hint && <span style={{ color: "var(--wm-arcane)" }}>{hint}</span>}
      </div>
    </Panel>
  );
}

function FragmentLine({ label, value, delta, better }: { label: string; value: string; delta: string | null; better: boolean | null }) {
  const cls = better === null ? undefined : better ? "wm-tip__up" : "wm-tip__down";
  return (
    <>
      <span className="wm-dim">{label}</span>
      <span className={cls}>{delta ?? value}</span>
      <span className={delta === null ? cls : "wm-dim"}>{delta === null ? (better ? "▲" : "▼") : value}</span>
    </>
  );
}
