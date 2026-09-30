import type { Rarity } from "./types";

export interface RarityInfo {
  id: Rarity;
  label: string;
  /** Power multiplier applied on top of item level. */
  mult: number;
  /** Frame / text color in the UI and the glow of dropped loot. */
  color: string;
}

export const RARITIES: Record<Rarity, RarityInfo> = {
  common: { id: "common", label: "Common", mult: 1, color: "#b9b0a0" },
  rare: { id: "rare", label: "Rare", mult: 1.15, color: "#5db9ff" },
  epic: { id: "epic", label: "Epic", mult: 1.3, color: "#c86bff" },
  legendary: { id: "legendary", label: "Legendary", mult: 1.5, color: "#ffb13d" },
};

export const RARITY_ORDER: readonly Rarity[] = ["common", "rare", "epic", "legendary"];

/** Drop weights by floor: deeper floors shift the odds toward better items. */
export function rarityWeights(floor: number): [Rarity, number][] {
  const depth = Math.min(floor / 100, 1);
  return [
    ["common", 70 - depth * 40],
    ["rare", 22 + depth * 14],
    ["epic", 7 + depth * 18],
    ["legendary", 1 + depth * 8],
  ];
}
