import { getBuffDef } from "../items/buffs";
import { enhancePotency, enhanceWard, gearWard, staffPotency } from "../items/power";
import { STAT_SPECS } from "../items/stats";
import { getAbility } from "../weapons/spells";
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
  material: "◆",
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
 * items/) because it reads ability data from weapons/, which depends on items/. */
export function statLines(item: ResolvedItem, comparedTo?: ResolvedItem | null): StatLine[] {
  const def = item.def;
  const lines: StatLine[] = [];
  const level = levelLine(item, comparedTo ?? null);
  if (level) lines.push(level);
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
  if (def.jump === "triple") lines.push({ text: "Triple jump" });
  if (def.dash) lines.push({ text: "Shift: blink-dash" });
  if (def.consumable) {
    if (def.consumable.heal) lines.push({ text: `Restores ${def.consumable.heal} health` });
    if (def.consumable.mana) lines.push({ text: `Restores ${def.consumable.mana} mana` });
    if (def.consumable.buff) {
      const b = getBuffDef(def.consumable.buff);
      lines.push({ text: `${b.name} for ${b.seconds} s` });
    }
    if (def.consumable.escape)
      lines.push({ text: "Return to the village, banking this run's loot" });
    lines.push({ text: "Consumed on use (Q/E)" });
  }
  return lines;
}

/** The item level and what it's worth: spell damage for a staff, a health
 * ward for other gear (items/power.ts). Compared against the worn piece. */
function levelLine(item: ResolvedItem, worn: ResolvedItem | null): StatLine | null {
  if (item.level <= 0) return null;
  const sameSlot = worn && worn.def.slot === item.def.slot ? worn : null;
  if (item.def.slot === "staff") {
    const power = (i: ResolvedItem) => staffPotency(i.level) * enhancePotency(i.enhance);
    const pct = Math.round((power(item) - 1) * 100);
    const delta = sameSlot ? power(item) - power(sameSlot) : 0;
    return { text: `Lv ${item.level} — +${pct}% spell damage from depth${item.enhance ? " and forge" : ""}`, delta: delta || undefined };
  }
  const wardOf = (i: ResolvedItem) => gearWard(i.level) + enhanceWard(i.enhance);
  const ward = wardOf(item);
  const delta = sameSlot ? ward - wardOf(sameSlot) : 0;
  return { text: `Lv ${item.level} — +${ward} max health ward`, delta: delta || undefined };
}

// ── Passive comparison ───────────────────────────────────────────────────────
// Each passive has a neutral value, a formatter, and a "which way is up"
// (items/stats.ts). The diff for a line = (candidate - worn) × direction.

const PASSIVE_SPECS = STAT_SPECS;

/** Total passive value of an item (base + affixes folded, enhancement applied). */
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
