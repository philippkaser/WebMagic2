import { STAT_SPECS } from "./stats";
import type { ItemDef, Passives } from "./types";

/** Item power — how an item's LEVEL and ENHANCEMENT turn into strength. The
 * one balance sheet for depth scaling on the player's side (enemies scale in
 * core/config.ts floorScale), shared by client stats, the server's
 * entry-floor rule, the economy and the forge.
 *
 * Design intent: a wizard wearing gear found around floor F should face floor
 * F's monsters at roughly the same odds as a fresh wizard faces floor 1 —
 * slightly worse, because deeper must always feel deeper. So:
 *  - the STAFF's level multiplies spell damage (tracks enemy health, which
 *    grows ~18%/floor, a little slower: kills take a few more hits deep down);
 *  - every other gear piece adds a WARD of max health (tracks enemy damage,
 *    ~12%/floor). An empty slot adds nothing — a naked wizard is fragile.
 *
 * Enhancement (+1…+5, the forge) is the slow, rare grind on top: each step
 * adds a little raw power AND amplifies the item's boons — a +5 Volatile
 * staff's blasts are wider than a plain Volatile one's — but never its
 * banes. It never changes an item's level, so it never changes how deep the
 * Weighing casts you: enhancing is how a wizard gets stronger at a depth. */

export const ITEM_POWER = {
  /** Spell damage gained per staff level above 1. */
  damagePerLevel: 0.07,
  /** Max health each non-staff gear piece adds per level above 1. */
  wardPerLevel: 3.2,
  /** Spell damage per enhancement step on a staff. */
  damagePerEnhance: 0.06,
  /** Max health per enhancement step on other gear. */
  healthPerEnhance: 6,
  /** How much each enhancement step amplifies an item's boons. */
  boonPerEnhance: 0.12,
} as const;

/** Effective level: the explicit `@level`, or for legacy ids (found before
 * items carried levels) the depth the item could first drop at. Consumables
 * and materials are levelless (0) — they don't resonate. */
export function effectiveLevel(def: ItemDef, explicit: number | null): number {
  if (def.slot === "consumable" || def.slot === "material") return 0;
  return explicit ?? Math.max(1, def.minFloor);
}

/** Spell-damage multiplier for a staff of this level. */
export function staffPotency(level: number): number {
  return 1 + Math.max(0, level - 1) * ITEM_POWER.damagePerLevel;
}

/** Bonus max health from one non-staff gear piece of this level. */
export function gearWard(level: number): number {
  return Math.round(Math.max(0, level - 1) * ITEM_POWER.wardPerLevel);
}

/** Extra spell damage from a staff's enhancement. */
export function enhancePotency(enhance: number): number {
  return 1 + Math.max(0, enhance) * ITEM_POWER.damagePerEnhance;
}

/** Extra max health from another piece's enhancement. */
export function enhanceWard(enhance: number): number {
  return Math.max(0, enhance) * ITEM_POWER.healthPerEnhance;
}

/** An item's passives with its enhancement applied: every BOON pushed
 * further from neutral (whole-number counts stay whole), every bane left
 * exactly as it was. */
export function amplifyPassives(block: Partial<Passives>, enhance: number): Partial<Passives> {
  if (enhance <= 0) return block;
  const k = 1 + enhance * ITEM_POWER.boonPerEnhance;
  const out: Partial<Passives> = {};
  for (const s of STAT_SPECS) {
    const v = block[s.key];
    if (v === undefined) continue;
    const boon = (v - s.neutral) * s.better > 0;
    out[s.key] = boon && !s.integer ? s.neutral + (v - s.neutral) * k : v;
  }
  return out;
}

/** How an item level reads in the UI ("Lv 12"). */
export function levelLabel(level: number): string {
  return level > 0 ? `Lv ${level}` : "";
}
