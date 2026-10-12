import type { ItemDef } from "./types";

/** Rarity — what an item's frame, name, gem and loot light say about it at a
 * glance. Derived, never stored: the affixes in an item's id and its def
 * decide it, so every id ever written has a rarity for free.
 *
 *   common     bone    — no enchantment
 *   enchanted  blue    — one affix
 *   arcane     violet  — two affixes
 *   legendary  amber   — a named unique with a power of its own
 *
 * Consumables and materials have no affixes; their def's tier stands in
 * (a feather or riftglass reads as precious, a weak draught as common).
 * Arcane cyan is deliberately NOT a rarity: in the inventory, cyan frames
 * mean "this socket takes it". */

export type Rarity = "common" | "enchanted" | "arcane" | "legendary";

export interface RarityLook {
  id: Rarity;
  label: string;
  /** Name / gem / beam colour. */
  color: string;
  /** Loot beam strength and sound weight, 0..1. */
  weight: number;
}

export const RARITIES: Record<Rarity, RarityLook> = {
  common: { id: "common", label: "Common", color: "#b9b0a0", weight: 0 },
  enchanted: { id: "enchanted", label: "Enchanted", color: "#5db9ff", weight: 0.35 },
  arcane: { id: "arcane", label: "Arcane", color: "#c86bff", weight: 0.7 },
  legendary: { id: "legendary", label: "Legendary", color: "#ffb13d", weight: 1 },
};

export function rarityOf(def: ItemDef, affixCount: number): Rarity {
  if (def.unique) return "legendary";
  if (affixCount >= 2) return "arcane";
  if (affixCount === 1) return "enchanted";
  if (def.slot === "consumable" || def.slot === "material") {
    return def.tier >= 3 ? "arcane" : def.tier === 2 ? "enchanted" : "common";
  }
  return "common";
}

export function rarityColor(r: Rarity): string {
  return RARITIES[r].color;
}
