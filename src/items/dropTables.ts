import { Rng } from "../core/rng";
import { SLIME_MAX_GEN } from "../enemies/brains/slime";
import type { EnemyId } from "../enemies/roster";
import type { PropKind } from "../world/types";
import { SAVE_FEATHER_ID } from "./catalog";
import { bossGoldAmount, enemyGoldAmount, GOLD_DROPS, propGoldAmount } from "./economy";
import { rollDrop } from "./loot";

/** What falls when something dies or breaks — the drop tables, pure.
 *
 * Whoever keeps the floor's loot book rolls them (items/lootBook.ts): the
 * server's ledger online, the offline loopback in single-player. The floor
 * host only reports WHAT died; it never rolls what that dropped. */

/** Base chance a regular enemy drops an item (the floor's omen scales it). */
export const ENEMY_LOOT_CHANCE = 0.24;

/** Base item chance per breakable prop. */
export const PROP_LOOT_CHANCE: Readonly<Record<PropKind, number>> = { crate: 0.08, barrel: 0.08, pot: 0.12 };

/** The Warden's hoard: two guaranteed items rolled a couple of floors
 * deeper, a proper pile of gold, and sometimes a feather — it hoards escapes
 * too. */
export const BOSS_LOOT = { items: 2, depthBonus: 2, featherChance: 0.35 } as const;

/** Something that drops loot. */
export type LootSource =
  /** `gen`: a slime's split generation (0 for everything else). */
  | { kind: "enemy"; enemy: Exclude<EnemyId, "boss">; gen: number }
  | { kind: "boss" }
  | { kind: "prop"; prop: PropKind };

/** One thing that fell: an item, or a pile of gold. */
export interface LootDrop {
  itemId: string | null;
  gold: number;
}

/** The floor's omen, as far as loot cares. */
export interface LootRules {
  lootChanceMult: number;
  goldMult: number;
}

/** Roll what `source` drops on `floor`. The omen scales item chances and
 * gold amounts — gold chances are its own. */
export function rollSourceLoot(rng: Rng, source: LootSource, floor: number, rules: LootRules): LootDrop[] {
  const drops: LootDrop[] = [];
  const item = (chance: number, depth = floor) => {
    if (rng.next() < chance * rules.lootChanceMult) drops.push({ itemId: rollDrop(rng, depth), gold: 0 });
  };
  const gold = (chance: number, amount: (rng: Rng, floor: number) => number) => {
    if (rng.next() >= chance) return;
    const g = Math.round(amount(rng, floor) * rules.goldMult);
    if (g > 0) drops.push({ itemId: null, gold: g });
  };
  switch (source.kind) {
    case "enemy":
      // A slime drops an item only when it dies for good (the last split);
      // every generation scatters coins.
      item(source.enemy === "slime" && source.gen < SLIME_MAX_GEN ? 0 : ENEMY_LOOT_CHANCE);
      gold(GOLD_DROPS.enemyChance, enemyGoldAmount);
      break;
    case "prop":
      item(PROP_LOOT_CHANCE[source.prop]);
      gold(GOLD_DROPS.propChance, propGoldAmount);
      break;
    case "boss":
      for (let i = 0; i < BOSS_LOOT.items; i++) item(1, floor + BOSS_LOOT.depthBonus);
      gold(1, bossGoldAmount);
      if (rng.next() < BOSS_LOOT.featherChance) drops.push({ itemId: SAVE_FEATHER_ID, gold: 0 });
      break;
  }
  return drops;
}

/** The floor's guaranteed treasure — rolled from the floor seed, so every
 * wizard in the instance (and the ledger) sees the same reward. */
export function treasureItem(seed: number, floor: number): string {
  return rollDrop(new Rng((seed ^ 0x9c67f3a1) >>> 0), floor);
}
