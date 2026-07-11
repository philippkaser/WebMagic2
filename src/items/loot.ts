import type { Rng } from "../core/rng";
import { allAffixDefs } from "./affixes";
import { lootPool } from "./catalog";
import { makeItemId } from "./itemId";
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
  return pickWeighted(rng, pool, floor);
}

function pickWeighted(rng: Rng, pool: ItemDef[], floor: number): ItemDef {
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

// ── Enchantments (rarity) ────────────────────────────────────────────────────

/** Chance a dropped piece of GEAR is enchanted, scaling with depth. */
export function affixChance(floor: number): number {
  return Math.min(0.12 + floor * 0.02, 0.5);
}

export function rollAffixId(rng: Rng): string {
  const pool = allAffixDefs();
  return pool[Math.floor(rng.next() * pool.length) % pool.length].id;
}

/** Roll a full droppable item id: base item + possible enchantment.
 * Consumables never carry affixes. This is what drops and treasure use. */
export function rollDrop(rng: Rng, floor: number): string {
  const def = rollLoot(rng, floor);
  if (def.slot !== "consumable" && rng.next() < affixChance(floor)) {
    return makeItemId(def.id, rollAffixId(rng));
  }
  return def.id;
}

/** Maro's Orb of Fortune: always gear, rolled a couple of floors past your
 * checkpoint, with a juiced enchant chance — gambling IS affix hunting.
 * Shared pure logic: the server rolls with this exact function online. */
export function rollGamble(rng: Rng, checkpoint: number): string {
  const floor = Math.max(checkpoint, 1) + 2;
  const gearSlots: Slot[] = ["staff", "amulet", "cloak", "boots"];
  const slot = gearSlots[Math.floor(rng.next() * gearSlots.length) % gearSlots.length];
  const def = pickWeighted(rng, lootPool(slot, floor), floor);
  return rng.next() < 0.45 ? makeItemId(def.id, rollAffixId(rng)) : def.id;
}
