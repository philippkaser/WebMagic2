import { resolveItem } from "../../../items/catalog";
import { RARITIES } from "../../../items/rarity";
import type { Slot } from "../../../items/types";

/** How an item card looks on the menu screens: framed and named in its
 * rarity colour (items/rarity.ts). */

export const RARITY_COLOR = {
  common: RARITIES.common.color,
  rare: RARITIES.enchanted.color,
  epic: RARITIES.arcane.color,
  legendary: RARITIES.legendary.color,
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
    return { name: item.name, level: item.level, slot: item.def.slot, color: RARITIES[item.rarity].color };
  } catch {
    return null;
  }
}
