import type { ResolvedItem } from "../../../items/catalog";
import type { SlotRef } from "../../../items/inventory";
import type { GearSlot } from "../../../items/types";
import { statLines } from "../../../ui/itemInfo";
import type { TextSpan } from "../../font/layout";
import { ink } from "../../theme";
import { GRADES, gradeOf } from "./grade";
import { INK } from "./materials";
import type { SpriteName } from "./spriteArt";

/** The words on the item plaque, in the sections of artpass's tooltip:
 * the name in its grade's colour, a small-caps line (gem · grade · kind ·
 * level), what it is, its stat lines under "IF EQUIPPED" with the
 * comparison against what you wear (▲ green / ▼ red), and — under a rule —
 * the footnotes that matter right here: what it's compared with, unbanked,
 * what Maro would pay or asks, and what a shift-click would do. Pure, so the
 * wording is tested (plaqueText.test.ts) and the plaque only lays it out. */

export interface PlaqueNote {
  text: TextSpan[];
  /** A pixel icon before the line. */
  icon?: SpriteName;
  iconTint?: string;
}

export interface PlaqueText {
  title: TextSpan[];
  /** Small caps under the name, after a gem in `gem`. */
  sub: TextSpan[];
  gem: string;
  desc: string | null;
  /** Small caps over the stat lines ("IF EQUIPPED", "GRANTS", "EFFECT"). */
  statsHead: string | null;
  stats: TextSpan[];
  notes: PlaqueNote[];
  /** The plaque's frame: gold for the legendary, brass otherwise. */
  frame: "gold" | "brass";
}

export interface PlaqueExtras {
  qty?: number;
  runLoot?: boolean;
  /** Reading the worn piece itself (its stats are what it grants). */
  worn?: boolean;
  /** Maro's offer for the stack (merchant mode, your items). */
  sellFor?: number | null;
  /** Maro's asking price (his wares). */
  price?: { gold: number; affordable: boolean } | null;
  /** What a shift-click does (quickHint). */
  hint?: string | null;
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
  const grade = gradeOf(item);
  const title: TextSpan[] = [{ text: item.name, color: grade.color }];
  if ((extras.qty ?? 1) > 1) title.push({ text: ` ×${extras.qty}`, color: INK.bright });

  const consumable = def.slot === "consumable";
  const kind = consumable
    ? (def.maxStack ?? 1) > 1
      ? `Consumable · stacks to ${def.maxStack}`
      : "Consumable"
    : [SLOT_NAME[def.slot], ...(item.affix ? [`tier ${def.tier}`] : []), ...(item.level > 0 ? [`Lv ${item.level}`] : [])].join(" · ");
  const sub: TextSpan[] = consumable
    ? [{ text: kind.toUpperCase(), color: ink.faded }]
    : [
        { text: grade.label.toUpperCase(), color: grade.color },
        { text: ` · ${kind.toUpperCase()}`, color: ink.faded },
      ];

  const lines: TextSpan[][] = [];
  if (item.affix) lines.push([{ text: `Enchanted: ${item.affix.desc}`, color: GRADES.enchanted.color }]);
  for (const line of statLines(item, worn)) {
    if (line.delta === undefined) lines.push([{ text: line.text, color: INK.body }]);
    else {
      const better = line.delta > 0;
      // The arrow leads, so arrows line up in a column and never wrap alone.
      lines.push([{ text: `${better ? "▲" : "▼"} ${line.text}`, color: better ? INK.better : INK.worse }]);
    }
  }

  const notes: PlaqueNote[] = [];
  if (worn) notes.push({ text: [{ text: "vs. worn ", color: INK.faint }, { text: worn.name, color: gradeOf(worn).color }] });
  if (extras.runLoot) notes.push({ text: [{ text: "Unbanked — lost if you fall", color: INK.runLoot }], icon: "hourglass", iconTint: "#ff8e5a" });
  if (extras.sellFor != null) notes.push({ text: [{ text: `Maro pays ${extras.sellFor} gold`, color: INK.gold }], icon: "coin", iconTint: ink.gold });
  if (extras.price) {
    notes.push({
      text: [
        { text: `${extras.price.gold} gold`, color: extras.price.affordable ? INK.gold : INK.worse },
        ...(extras.price.affordable ? [] : [{ text: " — not enough", color: INK.faint }]),
      ],
      icon: "coin",
      iconTint: ink.gold,
    });
  }
  if (extras.hint) notes.push({ text: [{ text: extras.hint, color: ink.arcane }] });

  return {
    title,
    sub,
    gem: grade.color,
    desc: def.desc || null,
    statsHead: lines.length === 0 ? null : consumable ? "EFFECT" : worn ? "IF EQUIPPED" : extras.worn ? "GRANTS" : "STATS",
    stats: joinLines(lines),
    notes,
    frame: grade.id === "legendary" ? "gold" : "brass",
  };
}

/** The Orb of Fortune isn't an item — it gets its own words. */
export function fortuneText(price: number, affordable: boolean): PlaqueText {
  const g = GRADES.enchanted;
  return {
    title: [{ text: "Orb of Fortune", color: g.color }],
    sub: [{ text: "GAMBLE", color: g.color }, { text: " · RANDOM GEAR", color: ink.faded }],
    gem: g.color,
    desc: "Random gear, rolled beyond your deepest floor. Often enchanted.",
    statsHead: null,
    stats: [],
    notes: [
      {
        text: [
          { text: `${price} gold`, color: affordable ? INK.gold : INK.worse },
          ...(affordable ? [] : [{ text: " — not enough", color: INK.faint }]),
        ],
        icon: "coin",
        iconTint: ink.gold,
      },
    ],
    frame: "brass",
  };
}

/** What a shift-click (or double-click) on this cell would do, said plainly
 * (mirrors quickMove.ts's rules). */
export function quickHint(from: SlotRef, consumable: boolean, chestOpen: boolean): string | null {
  // The staff never leaves the wizard's hand.
  if (from.container === "equipment" && from.slot === "staff") return null;
  if (from.container === "equipment" || from.container === "belt" || from.container === "chest") return "Shift-click: into the satchel";
  if (chestOpen) return "Shift-click: into the stash";
  return consumable ? "Shift-click: onto the belt" : "Shift-click to equip";
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
