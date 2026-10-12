import type { Passives } from "./types";

/** How every passive stat behaves — the one table that the stat fold
 * (catalog.computeStats), the forge's enhancement (power.amplifyPassives) and
 * the tooltips (ui/itemInfo) all read, so they can never disagree about
 * whether a number is good, how it stacks, or what it's called. Pure. */

export interface StatSpec {
  key: keyof Passives;
  /** The value that changes nothing. */
  neutral: number;
  /** Additive stats sum across gear; the rest multiply. */
  additive: boolean;
  /** +1: bigger is better; −1: smaller is better. */
  better: 1 | -1;
  /** Whole-number counts (bolts, bounces…) — never amplified fractionally. */
  integer?: boolean;
  format(value: number): string;
}

function pct(mult: number, label: string): string {
  const delta = Math.round((mult - 1) * 100);
  return `${delta > 0 ? "+" : ""}${delta}% ${label}`;
}

function count(v: number, one: string, many: string): string {
  return `${v > 0 ? "+" : ""}${v} ${Math.abs(v) === 1 ? one : many}`;
}

export const STAT_SPECS: readonly StatSpec[] = [
  { key: "maxHealth", neutral: 0, additive: true, better: 1, format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} max health` },
  { key: "speedMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "movement speed") },
  { key: "manaRegenMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "mana regeneration") },
  { key: "damageMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "spell damage") },
  { key: "damageTakenMult", neutral: 1, additive: false, better: -1, format: (v) => pct(v, "damage taken") },
  { key: "aggroMult", neutral: 1, additive: false, better: -1, format: (v) => pct(v, "enemy notice range") },
  { key: "extraProjectiles", neutral: 0, additive: true, better: 1, integer: true, format: (v) => count(v, "projectile per cast", "projectiles per cast") },
  { key: "homing", neutral: 0, additive: true, better: 1, format: (v) => `+${Math.round(v * 100)}% projectile homing` },
  { key: "fireRateMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "fire rate") },
  { key: "manaCostMult", neutral: 1, additive: false, better: -1, format: (v) => pct(v, "mana cost") },
  { key: "bounces", neutral: 0, additive: true, better: 1, integer: true, format: (v) => count(v, "ricochet", "ricochets") },
  { key: "pierce", neutral: 0, additive: true, better: 1, integer: true, format: (v) => count(v, "foe pierced", "foes pierced") },
  { key: "blastRadiusMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "blast radius") },
  { key: "projectileSpeedMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "projectile speed") },
  { key: "splitShards", neutral: 0, additive: true, better: 1, integer: true, format: (v) => count(v, "shard on impact", "shards on impact") },
  { key: "lifesteal", neutral: 0, additive: true, better: 1, format: (v) => `Heal ${Math.round(v * 100)}% of damage dealt` },
  { key: "chain", neutral: 0, additive: true, better: 1, integer: true, format: (v) => count(v, "foe chained", "foes chained") },
  { key: "knockbackMult", neutral: 1, additive: false, better: 1, format: (v) => pct(v, "knockback") },
];

const byKey = new Map(STAT_SPECS.map((s) => [s.key, s]));

export function statSpec(key: keyof Passives): StatSpec {
  return byKey.get(key)!;
}

/** Neutral passives — what a bare wizard has before any gear. */
export function neutralPassives(): Passives {
  const out = {} as Passives;
  for (const s of STAT_SPECS) out[s.key] = s.neutral;
  return out;
}

/** Fold one block of partial passives into a running total. */
export function foldPassives(total: Passives, block: Partial<Passives>): void {
  for (const s of STAT_SPECS) {
    const v = block[s.key];
    if (v === undefined) continue;
    total[s.key] = s.additive ? total[s.key] + v : total[s.key] * v;
  }
}

/** Is this value of a stat a boon (moves the right way from neutral)? */
export function isBoon(key: keyof Passives, value: number): boolean {
  const s = byKey.get(key)!;
  return (value - s.neutral) * s.better > 0;
}
