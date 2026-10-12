import type { ResolvedItem } from "../../../items/catalog";
import { RARITIES, type Rarity } from "../../../items/rarity";
import type { FrameColors } from "../../theme";

/** An item's rarity as the grimoire shows it — the colour of its card's
 * frame, its gem and its name (items/rarity.ts: common bone, enchanted
 * blue, arcane violet, legendary amber). Arcane cyan is deliberately NOT a
 * grade: while you drag, cyan frames mean "this socket takes it". */

export type GradeId = Rarity;

export interface Grade {
  id: GradeId;
  /** Shown in the tooltip's sub line, in `color`. */
  label: string;
  /** Name / gem / label colour. */
  color: string;
  /** The card frame's three tones. */
  frame: FrameColors;
}

export const GRADES: Record<GradeId, Grade> = {
  common: { id: "common", label: RARITIES.common.label, color: RARITIES.common.color, frame: { trim: "#7d7486", light: "#c9c0b0", dark: "#2e2836" } },
  enchanted: { id: "enchanted", label: RARITIES.enchanted.label, color: RARITIES.enchanted.color, frame: { trim: "#2f78c8", light: "#7cc8ff", dark: "#122e58" } },
  arcane: { id: "arcane", label: RARITIES.arcane.label, color: RARITIES.arcane.color, frame: { trim: "#8a3fd0", light: "#d99bff", dark: "#2c1250" } },
  legendary: { id: "legendary", label: RARITIES.legendary.label, color: RARITIES.legendary.color, frame: { trim: "#c98318", light: "#ffc860", dark: "#55320a" } },
};

export function gradeOf(item: ResolvedItem): Grade {
  return GRADES[item.rarity];
}

/** An empty socket's frame: dark iron, barely there (artpass's dashed
 * empty card). */
export const EMPTY_FRAME: FrameColors = { trim: "#3a3142", light: "#4e4458", dark: "#16111b" };

/** A frame lit up under the pointer: every tone one step brighter. */
export function litFrame(f: FrameColors): FrameColors {
  return { trim: f.light, light: "#fff6d8", dark: f.trim };
}
