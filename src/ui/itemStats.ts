import { getItemDef } from "../items/catalog";
import { slotOf } from "../items/inventory";
import { computeStats, itemPower } from "../items/stats";
import type { DerivedStats, Equipment, ItemInstance } from "../items/types";

/** Turns stat blocks into the readable lines shown in tooltips and the
 * paper doll. Pure presentation over items/stats — no rules live here. */

export interface StatLine {
  label: string;
  value: string;
  /** Signed change vs the comparison, already formatted ("+12%"), or null. */
  delta: string | null;
  /** Is the change good for the wearer? */
  better: boolean | null;
}

type NumericKey = Exclude<keyof DerivedStats, "jump" | "dash">;

interface NumericSpec {
  key: NumericKey;
  label: string;
  /** Lower is better (damage taken, enemy notice). */
  invert?: boolean;
  /** Show as a flat number rather than a percentage multiplier. */
  flat?: boolean;
}

const NUMERIC: readonly NumericSpec[] = [
  { key: "maxHealth", label: "Max health", flat: true },
  { key: "damageMult", label: "Spell damage" },
  { key: "damageTakenMult", label: "Damage taken", invert: true },
  { key: "speedMult", label: "Move speed" },
  { key: "manaRegenMult", label: "Mana regen" },
  { key: "aggroMult", label: "Enemy notice", invert: true },
];

const JUMP_LABEL: Record<DerivedStats["jump"], string> = {
  single: "Single jump",
  double: "Double jump",
  hover: "Hover",
};

const pct = (m: number) => `${m >= 1 ? "+" : "−"}${Math.abs(Math.round((m - 1) * 100))}%`;
const EPS = 0.004;

/** Full stat sheet for the paper doll. */
export function statSheet(stats: DerivedStats): StatLine[] {
  const lines: StatLine[] = NUMERIC.map((s) => ({
    label: s.label,
    value: s.flat ? String(Math.round(stats[s.key])) : Math.abs(stats[s.key] - 1) < EPS ? "—" : pct(stats[s.key]),
    delta: null,
    better: null,
  }));
  lines.push({ label: "Jump", value: JUMP_LABEL[stats.jump], delta: null, better: null });
  if (stats.dash) lines.push({ label: "Blink", value: "Shift dash", delta: null, better: null });
  return lines;
}

/** Only the stats that change between `before` and `after`. */
export function statDiff(before: DerivedStats, after: DerivedStats): StatLine[] {
  const lines: StatLine[] = [];
  for (const s of NUMERIC) {
    const a = before[s.key];
    const b = after[s.key];
    if (Math.abs(a - b) < EPS) continue;
    const up = b > a;
    const delta = s.flat ? `${up ? "+" : "−"}${Math.abs(Math.round(b - a))}` : pct(b / a);
    lines.push({
      label: s.label,
      // Flat stats show the resulting total; for multipliers the change is
      // the whole story (the total would just repeat it from a base of 1).
      value: s.flat ? `→ ${Math.round(b)}` : "",
      delta,
      better: s.invert ? !up : up,
    });
  }
  if (before.jump !== after.jump) {
    const rank = { single: 0, double: 1, hover: 2 } as const;
    lines.push({ label: "Jump", value: JUMP_LABEL[after.jump], delta: null, better: rank[after.jump] > rank[before.jump] });
  }
  if (before.dash !== after.dash) {
    lines.push({ label: "Blink dash", value: after.dash ? "gained" : "lost", delta: null, better: after.dash });
  }
  return lines;
}

export interface Comparison {
  /** Stat lines: what equipping would change, or what the item grants. */
  lines: StatLine[];
  power: number;
  /** Power of the item it would replace (null: empty slot / it is equipped). */
  replacesPower: number | null;
  equipped: boolean;
}

/** Compare an item against what's currently worn in its slot. For an item
 * that *is* worn, show what it contributes (vs. the slot left empty). */
export function compareItem(item: ItemInstance, equipment: Equipment): Comparison {
  const slot = slotOf(item);
  const current = equipment[slot];
  const equipped = current?.uid === item.uid;
  const now = computeStats(equipment);
  if (equipped) {
    // Staff/boots can't really be empty, but computeStats tolerates it and
    // the difference is exactly the item's contribution.
    const without = computeStats({ ...equipment, [slot]: null } as unknown as Equipment);
    return { lines: statDiff(without, now), power: itemPower(item), replacesPower: null, equipped };
  }
  const withItem = computeStats({ ...equipment, [slot]: item });
  return {
    lines: statDiff(now, withItem),
    power: itemPower(item),
    replacesPower: current ? itemPower(current) : null,
    equipped,
  };
}

/** "Bolt / Force Blast" for staffs, the template's summary otherwise. */
export function itemSummary(item: ItemInstance): string {
  return getItemDef(item.defId).desc;
}

export function formatPower(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}
