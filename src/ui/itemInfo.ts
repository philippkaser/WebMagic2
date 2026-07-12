import { getAbility } from "../combat/abilities";
import { itemPassives, type ResolvedItem } from "../items/catalog";
import type { ItemDef, Passives, Slot } from "../items/types";

/** One glyph per item family — the same everywhere an item appears (equipment
 * HUD, inventory cells, merchant list), so items are recognizable at a glance. */
export const ITEM_ICONS: Record<Slot, string> = {
  staff: "⚚",
  amulet: "◈",
  cloak: "▲",
  boots: "⬢",
  consumable: "⚗",
};

export function iconOf(def: ItemDef): string {
  return ITEM_ICONS[def.slot];
}

/** One display line; `delta` (when comparing against the worn counterpart)
 * is normalized so positive = strictly better, negative = worse. */
export interface StatLine {
  text: string;
  delta?: number;
}

/** Human-readable stat lines for an item, with optional per-stat comparison
 * arrows against what's currently worn in the same slot. Lives in ui/ (not
 * items/) because it reads ability data from combat/, which depends on items/. */
export function statLines(item: ResolvedItem, comparedTo?: ResolvedItem | null): StatLine[] {
  const def = item.def;
  const lines: StatLine[] = [];
  if (def.primary) {
    const a = getAbility(def.primary);
    lines.push({ text: `LMB ${a.name} — ${a.info} · ${a.mana} MP` });
  }
  if (def.secondary) {
    const a = getAbility(def.secondary);
    lines.push({ text: `RMB ${a.name} — ${a.info} · ${a.mana} MP` });
  }
  lines.push(...passiveLines(item, comparedTo ?? null));
  if (def.jump === "double") lines.push({ text: "Double jump" });
  if (def.jump === "hover") lines.push({ text: "Hold Space to hover" });
  if (def.dash) lines.push({ text: "Shift: blink-dash" });
  if (def.consumable) {
    if (def.consumable.heal) lines.push({ text: `Restores ${def.consumable.heal} health` });
    if (def.consumable.mana) lines.push({ text: `Restores ${def.consumable.mana} mana` });
    if (def.consumable.escape)
      lines.push({ text: "Return to the village, banking this run's loot" });
    lines.push({ text: "Consumed on use (Q/E)" });
  }
  return lines;
}

// ── Passive comparison ───────────────────────────────────────────────────────
// Each passive gets a neutral value, a formatter, and a "which way is up".
// The diff for a line = (candidate - worn) × direction.

interface PassiveSpec {
  key: keyof Passives;
  neutral: number;
  /** Additive stats sum across gear; the rest multiply. */
  additive: boolean;
  /** +1: bigger is better; −1: smaller is better. */
  better: 1 | -1;
  format(value: number): string;
}

const PASSIVE_SPECS: PassiveSpec[] = [
  {
    key: "maxHealth",
    neutral: 0,
    additive: true,
    better: 1,
    format: (v) => `${v > 0 ? "+" : ""}${v} max health`,
  },
  { key: "speedMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "movement speed") },
  { key: "manaRegenMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "mana regeneration") },
  { key: "damageMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "spell damage") },
  { key: "damageTakenMult", neutral: 1, additive: false, better: -1, format: (v) => pct(v, "damage taken") },
  { key: "aggroMult", neutral: 1, additive: false, better: -1, format: (v) => pct(v, "enemy notice range") },
  {
    key: "extraProjectiles",
    neutral: 0,
    additive: true,
    better: 1,
    format: (v) => `+${v} projectile${Math.abs(v) === 1 ? "" : "s"} per cast`,
  },
  {
    key: "homing",
    neutral: 0,
    additive: true,
    better: 1,
    format: (v) => `+${Math.round(v * 100)}% projectile homing`,
  },
  { key: "fireRateMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "fire rate") },
];

function pct(mult: number, label: string): string {
  const delta = Math.round((mult - 1) * 100);
  return `${delta > 0 ? "+" : ""}${delta}% ${label}`;
}

/** Total passive value of an item (base + affix folded). */
export function totalPassives(item: ResolvedItem): Partial<Passives> {
  const total: Partial<Passives> = {};
  for (const block of itemPassives(item)) {
    for (const spec of PASSIVE_SPECS) {
      const v = block[spec.key];
      if (v === undefined) continue;
      const prev = total[spec.key] ?? spec.neutral;
      total[spec.key] = spec.additive ? prev + v : prev * v;
    }
  }
  return total;
}

function passiveLines(item: ResolvedItem, comparedTo: ResolvedItem | null): StatLine[] {
  const own = totalPassives(item);
  const other = comparedTo ? totalPassives(comparedTo) : null;
  const lines: StatLine[] = [];
  for (const spec of PASSIVE_SPECS) {
    const value = own[spec.key];
    const wornValue = other?.[spec.key];
    // Show a line when THIS item has the stat, or the worn one does (so the
    // arrows reveal what a swap would give up, not just what it adds).
    if (value === undefined && (wornValue === undefined || !comparedTo)) continue;
    const v = value ?? spec.neutral;
    const w = wornValue ?? spec.neutral;
    const line: StatLine = { text: spec.format(v) };
    if (comparedTo && v !== w) line.delta = (v - w) * spec.better;
    lines.push(line);
  }
  return lines;
}
