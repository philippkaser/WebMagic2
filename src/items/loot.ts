import type { Rng } from "../core/rng";
import { rollAffixIds } from "./affixes";
import { lootPool, uniquePool } from "./catalog";
import { makeItemId, MAX_ITEM_LEVEL } from "./itemId";
import { isGearSlot, type GearSlot, type ItemDef, type Slot } from "./types";

const SLOT_WEIGHTS: [Slot, number][] = [
  ["staff", 20],
  ["amulet", 26],
  ["cloak", 21],
  ["boots", 21],
  ["consumable", 12],
];

/** Roll a random item appropriate for the given floor. Higher tiers get more
 * likely the deeper you are; per-item dropWeight scales rarity within a slot
 * (feathers are a lucky find, not a supply line). Legendaries and materials
 * never come from here. */
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

// ── Rarity ───────────────────────────────────────────────────────────────────

/** Chance a dropped piece of GEAR is enchanted at all, scaling with depth. */
export function affixChance(floor: number): number {
  return Math.min(0.12 + floor * 0.02, 0.5);
}

/** Given it's enchanted, the chance it carries a second affix (arcane). */
export function arcaneChance(floor: number): number {
  return Math.min(0.08 + floor * 0.01, 0.35);
}

/** Chance an ordinary drop is a legendary instead — vanishingly rare up
 * top, never common anywhere. Bosses and vaults roll their own. */
export function legendaryChance(floor: number): number {
  return floor < 8 ? 0 : Math.min(0.004 + floor * 0.00015, 0.02);
}

/** How many affixes a piece of gear rolls: 0, 1 or 2. */
export function rollAffixCount(rng: Rng, floor: number, boost = 0): number {
  if (rng.next() >= Math.min(1, affixChance(floor) + boost)) return 0;
  return rng.next() < Math.min(1, arcaneChance(floor) + boost * 0.5) ? 2 : 1;
}

/** The level a piece of gear rolls at when found on `floor`: the floor
 * itself, give or take one — so two drops from the same depth still differ a
 * little, and a lucky find can nudge your resonance deeper. */
export function rollItemLevel(rng: Rng, floor: number): number {
  return Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(floor) + rng.int(-1, 1)));
}

/** A full gear id for a def: affixes (slot-appropriate, distinct) + level. */
export function rollGearId(rng: Rng, def: ItemDef, floor: number, affixBoost = 0): string {
  if (!isGearSlot(def.slot) || def.unique) return makeItemId(def.id, null, rollItemLevel(rng, floor));
  const count = rollAffixCount(rng, floor, affixBoost);
  const affixes = count > 0 ? rollAffixIds(rng, def.slot as GearSlot, count) : [];
  return makeItemId(def.id, affixes, rollItemLevel(rng, floor));
}

/** A legendary for this depth (null if none can drop this shallow). */
export function rollUnique(rng: Rng, floor: number): string | null {
  const pool = uniquePool(floor);
  if (pool.length === 0) return null;
  const def = pickWeighted(rng, pool, floor);
  return makeItemId(def.id, null, rollItemLevel(rng, floor));
}

/** Roll a full droppable item id: base item + possible enchantments + level,
 * now and then a legendary. Consumables never carry affixes or levels. This
 * is what drops and treasure use. */
export function rollDrop(rng: Rng, floor: number): string {
  if (rng.next() < legendaryChance(floor)) {
    const unique = rollUnique(rng, floor);
    if (unique) return unique;
  }
  const def = rollLoot(rng, floor);
  if (def.slot === "consumable") return def.id;
  return rollGearId(rng, def, floor);
}

/** A richer roll for vaults, ward stones and bosses: always gear, a juiced
 * enchant chance, and `legendary` odds of a named piece. */
export function rollReward(rng: Rng, floor: number, legendary: number, affixBoost = 0.3): string {
  if (rng.next() < legendary) {
    const unique = rollUnique(rng, floor);
    if (unique) return unique;
  }
  const gearSlots: GearSlot[] = ["staff", "amulet", "cloak", "boots"];
  const slot = gearSlots[Math.floor(rng.next() * gearSlots.length) % gearSlots.length]!;
  const def = pickWeighted(rng, lootPool(slot, floor), floor);
  return rollGearId(rng, def, floor, affixBoost);
}

/** Maro's Orb of Fortune: always gear, rolled a couple of floors past the
 * deepest floor you've come home from, with a juiced enchant chance —
 * gambling IS affix hunting (and a way to nudge your resonance deeper).
 * Shared pure logic: the server rolls with this exact function online. */
export function rollGamble(rng: Rng, deepest: number): string {
  const floor = Math.max(deepest, 1) + 2;
  return rollReward(rng, floor, floor >= 8 ? 0.012 : 0, 0.33);
}
