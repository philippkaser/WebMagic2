import type { ResolvedItem } from "../../../items/catalog";
import type { FrameColors } from "../../theme";

/** An item's "rarity" as the grimoire shows it — the colour of its card's
 * frame, its gem and its name (artpass frames cards by rarity: common grey,
 * rare blue, epic violet, legendary amber).
 *
 * Our items have no rarity roll; they have a tier (1–3) and maybe an
 * enchantment. Enchanted wins — violet is already the enchant hue of names
 * and loot light, so a violet frame always means "this one has an affix" —
 * otherwise the tier picks grey, blue or amber. Arcane cyan is deliberately
 * NOT a grade: while you drag, cyan frames mean "this socket takes it". */

export type GradeId = "common" | "rare" | "legendary" | "enchanted";

export interface Grade {
  id: GradeId;
  /** Shown in the tooltip's sub line, in `color`. */
  label: string;
  /** Name / gem / label colour. */
  color: string;
  /** The card frame's three tones. */
  frame: FrameColors;
}

/** Colours match the menus' item cards (layers/menus/itemLook.ts) and
 * artpass's RARITIES: common bone, rare blue, legendary amber, epic violet. */
export const GRADES: Record<GradeId, Grade> = {
  common: { id: "common", label: "Common", color: "#b9b0a0", frame: { trim: "#7d7486", light: "#c9c0b0", dark: "#2e2836" } },
  rare: { id: "rare", label: "Rare", color: "#5db9ff", frame: { trim: "#2f78c8", light: "#7cc8ff", dark: "#122e58" } },
  legendary: { id: "legendary", label: "Legendary", color: "#ffb13d", frame: { trim: "#c98318", light: "#ffc860", dark: "#55320a" } },
  enchanted: { id: "enchanted", label: "Enchanted", color: "#c86bff", frame: { trim: "#8a3fd0", light: "#d99bff", dark: "#2c1250" } },
};

export function gradeOf(item: ResolvedItem): Grade {
  if (item.affix) return GRADES.enchanted;
  if (item.def.tier >= 3) return GRADES.legendary;
  return item.def.tier === 2 ? GRADES.rare : GRADES.common;
}

/** An empty socket's frame: dark iron, barely there (artpass's dashed
 * empty card). */
export const EMPTY_FRAME: FrameColors = { trim: "#3a3142", light: "#4e4458", dark: "#16111b" };

/** A frame lit up under the pointer: every tone one step brighter. */
export function litFrame(f: FrameColors): FrameColors {
  return { trim: f.light, light: "#fff6d8", dark: f.trim };
}
