import { getAbility } from "../../combat/abilities";
import { getItemDef } from "../../items/catalog";
import { SLOTS } from "../../items/types";
import { useGame } from "../../state/gameStore";
import { EmptySlot, ItemCard } from "../components/ItemCard";
import { KeyCap, Panel } from "../components/Panel";

/** Bottom-right: the four worn items as small rarity-framed cards, and the
 * staff's two spells on their mouse buttons. */
export function EquipStrip() {
  const equipment = useGame((s) => s.equipment);
  const staff = getItemDef(equipment.staff.defId);
  return (
    <div className="wm-hud-br">
      <Panel frame="iron" className="wm-abil">
        {staff.primary && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <KeyCap k="L" mouse /> {getAbility(staff.primary).name}
          </span>
        )}
        {staff.secondary && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <KeyCap k="R" mouse /> {getAbility(staff.secondary).name}
          </span>
        )}
      </Panel>
      <Panel frame="iron" className="wm-equip">
        {SLOTS.map((slot) => {
          const item = equipment[slot];
          return item ? <ItemCard key={slot} item={item} small /> : <EmptySlot key={slot} slot={slot} small />;
        })}
      </Panel>
    </div>
  );
}
