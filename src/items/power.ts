import type { ItemDef } from "./types";

/** Item power — how an item's LEVEL turns into strength. The one balance sheet
 * for depth scaling on the player's side (enemies scale in core/config.ts
 * floorScale), shared by client stats, the server's entry-floor rule and the
 * economy.
 *
 * Design intent: a wizard wearing gear found around floor F should face floor
 * F's monsters at roughly the same odds as a fresh wizard faces floor 1 —
 * slightly worse, because deeper must always feel deeper. So:
 *  - the STAFF's level multiplies spell damage (tracks enemy health, which
 *    grows ~18%/floor, a little slower: kills take a few more hits deep down);
 *  - every other gear piece adds a WARD of max health (tracks enemy damage,
 *    ~12%/floor). An empty slot adds nothing — a naked wizard is fragile. */

export const ITEM_POWER = {
  /** Spell damage gained per staff level above 1. */
  damagePerLevel: 0.07,
  /** Max health each non-staff gear piece adds per level above 1. */
  wardPerLevel: 3.2,
} as const;

/** Effective level: the explicit `@level`, or for legacy ids (found before
 * items carried levels) the depth the item could first drop at. Consumables
 * are levelless (0) — they don't resonate. */
export function effectiveLevel(def: ItemDef, explicit: number | null): number {
  if (def.slot === "consumable") return 0;
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

/** How an item level reads in the UI ("Lv 12"). */
export function levelLabel(level: number): string {
  return level > 0 ? `Lv ${level}` : "";
}
