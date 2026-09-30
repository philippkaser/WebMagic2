import { ENCHANT_COLOR } from "../../../items/affixes";
import type { ResolvedItem } from "../../../items/catalog";
import type { GearSlot } from "../../../items/types";
import { statLines } from "../../../ui/itemInfo";
import type { TextSpan } from "../../font/layout";
import { INK } from "./materials";

/** The words on the item plaque — name, what it is, its stat lines with the
 * comparison against what you wear (▲ better / ▼ worse, coloured), and the
 * footnotes that matter right here: unbanked, what Maro would pay, what he
 * asks. Pure, so the wording is tested (plaqueText.test.ts) and the plaque
 * only lays it out. */

export interface PlaqueText {
  title: TextSpan[];
  body: TextSpan[];
  /** The plaque's rim glows in this colour. */
  accent: string;
}

export interface PlaqueExtras {
  qty?: number;
  runLoot?: boolean;
  /** Maro's offer for the stack (merchant mode, your items). */
  sellFor?: number | null;
  /** Maro's asking price (his wares). */
  price?: { gold: number; affordable: boolean } | null;
}

const SLOT_NAME: Record<GearSlot | "consumable", string> = {
  staff: "Staff",
  amulet: "Amulet",
  cloak: "Cloak",
  boots: "Boots",
  consumable: "Consumable",
};

export function plaqueText(item: ResolvedItem, worn: ResolvedItem | null, extras: PlaqueExtras = {}): PlaqueText {
  const def = item.def;
  const accent = item.affix ? ENCHANT_COLOR : def.color;
  const title: TextSpan[] = [{ text: item.name, color: accent }];
  if ((extras.qty ?? 1) > 1) title.push({ text: ` ×${extras.qty}`, color: INK.bright });

  const lines: TextSpan[][] = [];
  const kind = def.slot === "consumable" && (def.maxStack ?? 1) > 1 ? `Consumable · stacks to ${def.maxStack}` : `${SLOT_NAME[def.slot]} · tier ${def.tier}`;
  lines.push([{ text: kind, color: INK.dim }]);
  if (item.affix) lines.push([{ text: `Enchanted: ${item.affix.desc}`, color: ENCHANT_COLOR }]);
  for (const line of statLines(item, worn)) {
    if (line.delta === undefined) lines.push([{ text: line.text, color: INK.body }]);
    else {
      const better = line.delta > 0;
      // The arrow leads, so arrows line up in a column and never wrap alone.
      lines.push([{ text: `${better ? "▲" : "▼"} ${line.text}`, color: better ? INK.better : INK.worse }]);
    }
  }
  if (worn) lines.push([{ text: "vs. worn ", color: INK.faint }, { text: worn.name, color: INK.dim }]);
  if (extras.runLoot) lines.push([{ text: "Unbanked — lost if you fall", color: INK.runLoot }]);
  if (extras.sellFor != null) lines.push([{ text: `Maro pays ${extras.sellFor} gold`, color: INK.gold }]);
  if (extras.price) {
    lines.push([
      { text: `${extras.price.gold} gold`, color: extras.price.affordable ? INK.gold : INK.worse },
      ...(extras.price.affordable ? [] : [{ text: " — not enough", color: INK.faint }]),
    ]);
  }
  return { title, body: joinLines(lines), accent };
}

/** The Orb of Fortune isn't an item — it gets its own words. */
export function fortuneText(price: number, affordable: boolean): PlaqueText {
  return {
    title: [{ text: "Orb of Fortune", color: ENCHANT_COLOR }],
    body: joinLines([
      [{ text: "Random gear, rolled beyond your", color: INK.body }],
      [{ text: "deepest floor · often enchanted", color: INK.body }],
      [{ text: `${price} gold`, color: affordable ? INK.gold : INK.worse }],
    ]),
    accent: ENCHANT_COLOR,
  };
}

function joinLines(lines: TextSpan[][]): TextSpan[] {
  const out: TextSpan[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ text: "\n" });
    out.push(...line);
  });
  return out;
}

/** The worn counterpart to compare against: same gear slot, a different
 * item, and not the socket being read itself. */
export function wornCounterpart(item: ResolvedItem, worn: ResolvedItem | null, readingWorn: boolean): ResolvedItem | null {
  if (readingWorn || !worn || item.def.slot === "consumable") return null;
  return worn.itemId === item.itemId ? null : worn;
}
