import type { CSSProperties } from "react";
import { allAffixDefs } from "../../items/affixes";
import { allItemDefs, computeStats } from "../../items/catalog";
import { makeItemId } from "../../items/itemId";
import type { GearSlot, ItemDef } from "../../items/types";
import { useGame } from "../../state/gameStore";
import { iconOf } from "../itemInfo";
import { FONT, palette } from "../theme";
import { Section } from "./Section";
import { styles } from "./styles";

/** The item half of the dev room: pick an enchant, then equip or bag any
 * gear with it, or hand yourself consumables. The chosen affix is owned by
 * the DevRoom root because the picker and the lists below both need it. */

/** Affix selector — applied to any gear you equip or add. */
export function EnchantSection({
  affix,
  onChange,
}: {
  affix: string | null;
  onChange: (affix: string | null) => void;
}) {
  return (
    <Section label="ENCHANT (applies to gear below)">
      <div style={styles.row}>
        <Chip label="none" on={affix === null} onClick={() => onChange(null)} />
        {allAffixDefs().map((a) => (
          <Chip
            key={a.id}
            label={a.name}
            title={a.desc}
            on={affix === a.id}
            onClick={() => onChange(a.id)}
          />
        ))}
      </div>
    </Section>
  );
}

/** One gear slot: equip any def (with the chosen affix) or drop a copy in
 * the bag; non-staff slots can also be emptied. */
export function GearSection({ slot, affix }: { slot: GearSlot; affix: string | null }) {
  const equipment = useGame((s) => s.equipment);
  return (
    <Section label={slot.toUpperCase()}>
      {slot !== "staff" && equipment[slot] && (
        <button style={styles.btnGhost} onClick={() => unequip(slot)}>
          unequip current
        </button>
      )}
      <div style={styles.itemList}>
        {defsForSlot(slot).map((def) => (
          <div key={def.id} style={styles.itemRow}>
            <span style={{ color: def.color, width: 18, textAlign: "center" }}>{iconOf(def)}</span>
            <span style={styles.itemName}>{def.name}</span>
            <span style={styles.itemDesc}>{def.desc}</span>
            <span style={styles.tier}>T{def.tier}</span>
            <button style={styles.mini} onClick={() => equipGear(def, affix)}>
              equip
            </button>
            <button style={miniGhostStyle} onClick={() => addItem(def, affix)}>
              → bag
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Consumables & feathers — straight into the bag, never enchanted. */
export function ConsumablesSection() {
  return (
    <Section label="CONSUMABLES">
      <div style={styles.itemList}>
        {defsForSlot("consumable").map((def) => (
          <div key={def.id} style={styles.itemRow}>
            <span style={{ color: def.color, width: 18, textAlign: "center" }}>{iconOf(def)}</span>
            <span style={styles.itemName}>{def.name}</span>
            <span style={styles.itemDesc}>{def.desc}</span>
            <button style={styles.mini} onClick={() => addItem(def, null)}>
              + add
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function defsForSlot(slot: string): ItemDef[] {
  return allItemDefs().filter((d) => d.slot === slot);
}

/** Bypasses the inventory rules on purpose (it's a test bench): writes the
 * slot directly and tops health up to the new max. */
function equipGear(def: ItemDef, affix: string | null): void {
  const slot = def.slot as GearSlot;
  const itemId = makeItemId(def.id, def.slot === "consumable" ? null : affix);
  useGame.setState((s) => {
    const next = { ...s.equipment, [slot]: { defId: itemId, runLoot: false } };
    return { equipment: next, health: computeStats(next).maxHealth };
  });
}

function unequip(slot: Exclude<GearSlot, "staff">): void {
  useGame.setState((s) => {
    const next = { ...s.equipment, [slot]: null };
    return { equipment: next, health: Math.min(s.health, computeStats(next).maxHealth) };
  });
}

/** Goes through the normal pickup path, so bag-full handling is real. */
function addItem(def: ItemDef, affix: string | null): void {
  const itemId = makeItemId(def.id, def.slot === "consumable" ? null : affix);
  useGame.getState().acquireItem(itemId);
}

/** Toggle pill for the affix picker. */
function Chip({
  label,
  title,
  on,
  onClick,
}: {
  label: string;
  title?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        ...chipStyle,
        borderColor: on ? palette.enchant : palette.borderStrong,
        color: on ? palette.bright : palette.muted,
        background: on ? "#231a33" : palette.buttonBg,
      }}
    >
      {label}
    </button>
  );
}

const miniGhostStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 11,
  padding: "3px 8px",
  background: "none",
  color: palette.muted,
  border: `1px solid ${palette.border}`,
  cursor: "pointer",
};

const chipStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 11,
  padding: "4px 10px",
  border: `1px solid ${palette.borderStrong}`,
  cursor: "pointer",
};
