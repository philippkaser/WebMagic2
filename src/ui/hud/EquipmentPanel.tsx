import { resolveItem } from "../../items/catalog";
import type { GearSlot } from "../../items/types";
import { useGame } from "../../state/gameStore";
import { ITEM_ICONS } from "../itemInfo";
import { palette, styles } from "../theme";

/** Bottom-right: what you're wearing, one row per gear slot, flagged when it
 * is unbanked run loot or enchanted. */
export function EquipmentPanel() {
  const equipment = useGame((s) => s.equipment);
  return (
    <div style={{ ...styles.panel, bottom: 16, right: 14, textAlign: "right" }}>
      <EquipRow slot="staff" defId={equipment.staff.defId} runLoot={equipment.staff.runLoot} />
      <EquipRow slot="amulet" defId={equipment.amulet?.defId} runLoot={equipment.amulet?.runLoot} />
      <EquipRow slot="cloak" defId={equipment.cloak?.defId} runLoot={equipment.cloak?.runLoot} />
      <EquipRow slot="boots" defId={equipment.boots?.defId} runLoot={equipment.boots?.runLoot} />
      <div style={{ fontSize: 10, color: palette.faint, marginTop: 3 }}>I — inventory</div>
    </div>
  );
}

/** One slot row: ◦ run-loot mark, ✦ enchant mark, name and slot glyph — or a
 * dimmed "no <slot>" placeholder so empty slots are noticed. */
export function EquipRow({ slot, defId, runLoot }: { slot: GearSlot; defId?: string; runLoot?: boolean }) {
  const item = defId ? resolveItem(defId) : null;
  return (
    <div style={{ fontSize: 12, marginBottom: 4, color: item ? palette.item : palette.faint }}>
      {item ? (
        <>
          {runLoot && <span style={{ color: palette.runLoot }} title="Lost on death until banked">◦ </span>}
          {item.affix && <span style={{ color: palette.enchant }} title={item.affix.desc}>✦ </span>}
          <span>{item.name}</span>{" "}
          <span style={{ color: item.def.color }}>{ITEM_ICONS[slot]}</span>
        </>
      ) : (
        <>
          <span>— no {slot} —</span> <span>{ITEM_ICONS[slot]}</span>
        </>
      )}
    </div>
  );
}
