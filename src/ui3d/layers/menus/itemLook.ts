import { resolveItem } from "../../../items/catalog";
import type { Slot } from "../../../items/types";

/** How an item card looks on the menu screens: the artpass item card is
 * framed and named in its rarity colour. Our items have tiers and
 * enchantments instead of rarities, so they borrow its scale — plain
 * common bone, tier-two rare blue, tier-three legendary amber, and
 * anything enchanted (an affix) epic violet. */

export const RARITY_COLOR = {
  common: "#b9b0a0",
  rare: "#5db9ff",
  epic: "#c86bff",
  legendary: "#ffb13d",
} as const;

export interface ItemLook {
  name: string;
  level: number;
  slot: Slot;
  /** Frame and name colour. */
  color: string;
}

/** The look of an item id, or null for an id the catalog can't place. */
export function itemLook(itemId: string): ItemLook | null {
  try {
    const item = resolveItem(itemId);
    const color = item.affix
      ? RARITY_COLOR.epic
      : item.def.tier >= 3
        ? RARITY_COLOR.legendary
        : item.def.tier === 2
          ? RARITY_COLOR.rare
          : RARITY_COLOR.common;
    return { name: item.name, level: item.level, slot: item.def.slot, color };
  } catch {
    return null;
  }
}
