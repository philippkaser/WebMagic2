import type { Rng } from "../core/rng";
import { lootPool } from "./catalog";
import type { ItemDef, Slot } from "./types";

const SLOT_WEIGHTS: [Slot, number][] = [
  ["staff", 22],
  ["amulet", 30],
  ["cloak", 24],
  ["boots", 24],
];

/** Roll a random item appropriate for the given floor. Higher tiers get more
 * likely the deeper you are. */
export function rollLoot(rng: Rng, floor: number): ItemDef {
  const total = SLOT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  let slot: Slot = "amulet";
  for (const [s, w] of SLOT_WEIGHTS) {
    r -= w;
    if (r <= 0) {
      slot = s;
      break;
    }
  }
  const pool = lootPool(slot, floor);
  // Weight toward higher tiers as floors increase.
  const weights = pool.map((d) => 1 + d.tier * Math.min(floor / 6, 2.5));
  const sum = weights.reduce((a, b) => a + b, 0);
  let pick = rng.next() * sum;
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
