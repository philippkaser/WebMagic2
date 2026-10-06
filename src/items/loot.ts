import type { Rng } from "../core/rng";
import { allAffixDefs } from "./affixes";
import { lootPool, resolveItem, type ResolvedItem } from "./catalog";
import { makeItemId, MAX_ITEM_LEVEL } from "./itemId";
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

/** The level a piece of gear rolls at when found on `floor`: the floor
 * itself, give or take one — so two drops from the same depth still differ a
 * little, and a lucky find can nudge your resonance deeper. */
export function rollItemLevel(rng: Rng, floor: number): number {
  return Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(floor) + rng.int(-1, 1)));
}

/** Roll a full droppable item id: base item + possible enchantment + level.
 * Consumables never carry affixes or levels. This is what drops and treasure
 * use. */
export function rollDrop(rng: Rng, floor: number): string {
  const def = rollLoot(rng, floor);
  if (def.slot === "consumable") return def.id;
  const affix = rng.next() < affixChance(floor) ? rollAffixId(rng) : null;
  return makeItemId(def.id, affix, rollItemLevel(rng, floor));
}

/** Maro's Orb of Fortune: always gear, rolled a couple of floors past the
 * deepest floor you've come home from, with a juiced enchant chance —
 * gambling IS affix hunting (and a way to nudge your resonance deeper).
 * Shared pure logic: the server rolls with this exact function online. */
export function rollGamble(rng: Rng, deepest: number): string {
  const floor = Math.max(deepest, 1) + 2;
  const gearSlots: Slot[] = ["staff", "amulet", "cloak", "boots"];
  const slot = gearSlots[Math.floor(rng.next() * gearSlots.length) % gearSlots.length];
  const def = pickWeighted(rng, lootPool(slot, floor), floor);
  const affix = rng.next() < 0.45 ? rollAffixId(rng) : null;
  return makeItemId(def.id, affix, rollItemLevel(rng, floor));
}

// ── What a floor can give ────────────────────────────────────────────────────

/** How far past its own depth a floor's loot reaches: drops roll at the floor
 * ±1 (rollItemLevel) and the Warden's at two floors deeper still
 * (enemies/kinds/Warden.tsx). */
export const LOOT_REACH = 3;

/** Could this exact id have dropped on `floor`: a real catalog item (base,
 * enchantment and level all valid) no deeper than the floor's loot reaches?
 * The server holds every host-attested pickup to it (server/accounts.ts), so
 * a hacked host can't mint a level-120 staff on floor 1, or an id that
 * doesn't exist. Items another wizard gave up (graves, drops) don't come
 * through here — the server matches those against what was given up. */
export function couldDropOn(itemId: string, floor: number): boolean {
  let item: ResolvedItem;
  try {
    item = resolveItem(itemId);
  } catch {
    return false;
  }
  if (item.def.slot === "consumable" && item.affix) return false; // never rolled
  const reach = Math.max(1, floor) + LOOT_REACH;
  return item.def.minFloor <= reach && item.level <= reach;
}
