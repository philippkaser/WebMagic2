import { PLAYER } from "../core/config";
import { getItemDef } from "./catalog";
import { RARITIES } from "./rarity";
import type { DerivedStats, Equipment, ItemInstance, Slot } from "./types";

/** Item power: the single number behind both an item's strength and the
 * wearer's gear level. Level 1 common = 1; a legendary is worth 1.5 levels. */
export function itemPower(item: ItemInstance): number {
  return item.level * RARITIES[item.rarity].mult;
}

/** What each slot grants per point of item power, on top of the template's
 * flat passives. Data, not code — tune here. */
const SLOT_SCALING: Record<Slot, (power: number, stats: DerivedStats) => void> = {
  // Staffs carry your damage: +11% per power above 1.
  staff: (p, s) => {
    s.damageMult *= 1 + (p - 1) * 0.11;
  },
  amulet: (p, s) => {
    s.maxHealth += Math.round(p * 3);
  },
  cloak: (p, s) => {
    s.damageTakenMult *= 1 / (1 + p * 0.025);
  },
  boots: (p, s) => {
    s.maxHealth += Math.round((p - 1) * 2);
  },
};

const BASE: DerivedStats = {
  maxHealth: PLAYER.maxHealth,
  speedMult: 1,
  manaRegenMult: 1,
  damageMult: 1,
  damageTakenMult: 1,
  aggroMult: 1,
  jump: "single",
  dash: false,
};

export function equippedItems(equipment: Equipment): ItemInstance[] {
  return [equipment.staff, equipment.amulet, equipment.cloak, equipment.boots].filter(
    (i): i is ItemInstance => i !== null,
  );
}

/** Fold every equipped item into a single stat block. */
export function computeStats(equipment: Equipment): DerivedStats {
  const stats: DerivedStats = { ...BASE };
  for (const inst of equippedItems(equipment)) {
    const def = getItemDef(inst.defId);
    SLOT_SCALING[def.slot](itemPower(inst), stats);
    const p = def.passives;
    if (p) {
      stats.maxHealth += p.maxHealth ?? 0;
      stats.speedMult *= p.speedMult ?? 1;
      stats.manaRegenMult *= p.manaRegenMult ?? 1;
      stats.damageMult *= p.damageMult ?? 1;
      stats.damageTakenMult *= p.damageTakenMult ?? 1;
      stats.aggroMult *= p.aggroMult ?? 1;
    }
    if (def.jump) stats.jump = def.jump;
    if (def.dash) stats.dash = true;
  }
  stats.maxHealth = Math.max(20, stats.maxHealth);
  return stats;
}

/** Gear level: the mean item power across all four slots (an empty slot
 * counts as zero, so going without an amulet costs you). This is what the
 * rift reads to decide how deep to throw you. */
export function gearLevel(equipment: Equipment): number {
  const total = equippedItems(equipment).reduce((sum, item) => sum + itemPower(item), 0);
  return Math.max(1, Math.round(total / 4));
}
