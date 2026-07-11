import type { Rng } from "../core/rng";
import { lootPool } from "./catalog";
import type { ItemDef, Slot } from "./types";

const SLOT_WEIGHTS: [Slot, number][] = [
  ["staff", 20],
  ["amulet", 26],
  ["cloak", 21],
  ["boots", 21],
  ["consumable", 12],
];

/** Roll a random item appropriate for the given floor. Higher tiers get more
 * likely the deeper you are; per-item dropWeight scales rarity within a slot
 * (feathers are a lucky find, not a supply line). */
export function rollLoot(rng: Rng, floor: number): ItemDef {
  // Only slots that have anything to offer at this depth participate
  // (consumables start at floor 2 — floor 1 must never roll an empty pool).
  const eligible = SLOT_WEIGHTS.filter(([s]) => lootPool(s, floor).length > 0);
  const total = eligible.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  let slot: Slot = "amulet";
  for (const [s, w] of eligible) {
    r -= w;
    if (r <= 0) {
      slot = s;
      break;
    }
  }
  const pool = lootPool(slot, floor);
  // Weight toward higher tiers as floors increase.
  const weights = pool.map((d) => (1 + d.tier * Math.min(floor / 6, 2.5)) * (d.dropWeight ?? 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let pick = rng.next() * sum;
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
