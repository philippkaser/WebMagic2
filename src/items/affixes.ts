import type { Passives } from "./types";

/** Enchantment affixes — the rarity layer. An enchanted item carries exactly
 * one affix, encoded in its item id ("void_staff+keen" → "Keen Staff of the
 * Hollow"). Affixes are pure passive riders, so they apply to ANY gear slot
 * and fold into computeStats like a second passives block. Adding an affix
 * here is all it takes for it to drop, display, bank, and sell. */

export interface AffixDef {
  id: string;
  /** Name prefix ("Keen" → "Keen Ember Staff"). */
  name: string;
  desc: string;
  passives: Partial<Passives>;
}

const defs: AffixDef[] = [
  { id: "swift", name: "Swift", desc: "+8% movement speed", passives: { speedMult: 1.08 } },
  { id: "vigorous", name: "Vigorous", desc: "+25 max health", passives: { maxHealth: 25 } },
  { id: "keen", name: "Keen", desc: "+12% spell damage", passives: { damageMult: 1.12 } },
  { id: "focused", name: "Focused", desc: "+30% mana regeneration", passives: { manaRegenMult: 1.3 } },
  { id: "warded", name: "Warded", desc: "-10% damage taken", passives: { damageTakenMult: 0.9 } },
  { id: "veiled", name: "Veiled", desc: "-25% enemy notice range", passives: { aggroMult: 0.75 } },
];

const byId = new Map(defs.map((d) => [d.id, d]));

export function getAffixDef(id: string): AffixDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown affix: ${id}`);
  return def;
}

export function allAffixDefs(): readonly AffixDef[] {
  return defs;
}

/** UI hue for enchanted items (names, cell markers). */
export const ENCHANT_COLOR = "#c9a5ff";
