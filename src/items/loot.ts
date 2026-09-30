import { DUNGEON } from "../core/config";
import type { Rng } from "../core/rng";
import { lootPool } from "./catalog";
import { rarityWeights } from "./rarity";
import type { ItemInstance, Rarity, Slot } from "./types";

const SLOT_WEIGHTS: [Slot, number][] = [
  ["staff", 22],
  ["amulet", 28],
  ["cloak", 25],
  ["boots", 25],
];

function weighted<T>(rng: Rng, entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

/** A globally unique-enough item id. Items travel between players (death
 * chests), so ids must never collide across clients. */
export function newItemUid(rng: Rng): string {
  const a = Math.floor(rng.next() * 0xffffffff).toString(36);
  const b = Math.floor(rng.next() * 0xffffffff).toString(36);
  return `i${a}${b}`;
}

/** Roll a random item for a floor. Level tracks the floor (±), deeper floors
 * shift rarity odds upward. `bonus` raises both (bosses, treasure). */
export function rollItem(rng: Rng, floor: number, bonus = 0): ItemInstance {
  const slot = weighted(rng, SLOT_WEIGHTS);
  const pool = lootPool(slot, floor + bonus);
  const def = weighted(rng, pool.map((d) => [d, d.weight ?? 1] as [typeof d, number]));
  const level = Math.max(1, Math.min(DUNGEON.maxFloor, floor + bonus + rng.int(-1, 2)));
  let rarity: Rarity = weighted(rng, rarityWeights(floor + bonus * 6));
  if (bonus > 0 && rarity === "common") rarity = "rare";
  return { uid: newItemUid(rng), defId: def.id, level, rarity, runLoot: true };
}
