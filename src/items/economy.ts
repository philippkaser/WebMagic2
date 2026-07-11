import type { Rng } from "../core/rng";
import { resolveItem, SAVE_FEATHER_ID } from "./catalog";
import type { WireInventory, WireStack } from "../net/protocol";

/** The economy balance sheet — every gold and price number lives here.
 *
 * Pure logic, imported by BOTH the client (drops, merchant UI) and the server
 * (purchase validation, gold provenance caps), so the two can never disagree.
 *
 * Design intent (the greed loop): an early run to the floor-5 checkpoint
 * should net roughly 60–100 gold. One healing draught eats a third of that;
 * a Feather of Safe Passage costs about two banked runs. Gold must always
 * compete with "one more floor" — if consumables ever feel routine, raise
 * prices before lowering drops (finding gold should stay exciting). */

// ── Merchant ─────────────────────────────────────────────────────────────────

export interface MerchantWare {
  id: string;
  price: number;
}

/** What the village merchant sells. Deliberately pricy (see above). */
export const MERCHANT_STOCK: readonly MerchantWare[] = [
  { id: "potion_hp_weak", price: 35 },
  { id: "potion_mp_weak", price: 30 },
  { id: SAVE_FEATHER_ID, price: 180 },
];

export function merchantPrice(itemId: string): number | null {
  return MERCHANT_STOCK.find((w) => w.id === itemId)?.price ?? null;
}

/** What Maro pays for an item — deliberately stingy (roughly a quarter of
 * worth) so selling clears clutter without becoming the main income. Gear by
 * tier, +bonus if enchanted; consumables at a quarter of his own price.
 * Returns null for ids he won't touch (unknown/corrupt). */
const GEAR_SELL_BY_TIER = [0, 9, 21, 38] as const;
const AFFIX_SELL_BONUS = 14;

export function sellValue(itemId: string): number | null {
  try {
    const item = resolveItem(itemId);
    if (item.def.slot === "consumable") {
      const price = merchantPrice(item.def.id);
      return price !== null ? Math.ceil(price / 4) : 4;
    }
    return GEAR_SELL_BY_TIER[item.def.tier] + (item.affix ? AFFIX_SELL_BONUS : 0);
  } catch {
    return null;
  }
}

/** Maro's Orb of Fortune: pay up front, the dungeon decides what you get
 * (items/loot.ts#rollGamble — always gear, boosted enchant odds). */
export const GAMBLE_PRICE = 65;

// ── Gold drops ───────────────────────────────────────────────────────────────

export const GOLD_DROPS = {
  /** Chance an enemy kill scatters coins. */
  enemyChance: 0.6,
  /** Chance a broken prop hides a few coins. */
  propChance: 0.25,
} as const;

/** Coins from an enemy kill, scaling with depth (floor 1 ≈ 2–5g, floor 10 ≈ 8–16g). */
export function enemyGoldAmount(rng: Rng, floor: number): number {
  return Math.round(2 + floor * 0.7 + rng.next() * (2 + floor * 0.6));
}

/** Coins hidden in props — pocket change, even deep down. */
export function propGoldAmount(rng: Rng, floor: number): number {
  return Math.round(1 + rng.next() * (2 + floor * 0.25));
}

/** The boss guards a proper hoard. */
export function bossGoldAmount(rng: Rng, floor: number): number {
  return Math.round(20 + floor * 2.2 + rng.next() * 14);
}

// ── Server-side sanity caps (anti-cheat bounds, not balance) ────────────────

export const GOLD_RULES = {
  /** No single host-attested pickup exceeds this — far above any real drop. */
  perGrantCap: 500,
  /** Ceiling on gold attested per run — bounds a cheating host's damage. */
  perRunCap: 10_000,
  /** Absolute account ceiling, so a corrupt save can't overflow anything. */
  accountCap: 1_000_000,
} as const;

// ── Wire-inventory multiset helpers (shared provenance logic) ───────────────

/** Every item id in the inventory, counted — the shape provenance checks use. */
export function multisetOf(inv: WireInventory): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string | null, qty = 1) => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + qty);
  };
  add(inv.equipment.staff);
  add(inv.equipment.amulet);
  add(inv.equipment.cloak);
  add(inv.equipment.boots);
  for (const grid of [inv.bag, inv.belt, inv.chest]) {
    for (const stack of grid) if (stack) add(stack.id, stack.qty);
  }
  return counts;
}

/** True if `sub` contains no item beyond what `owned` covers. */
export function isSubMultiset(sub: Map<string, number>, owned: Map<string, number>): boolean {
  for (const [id, qty] of sub) {
    if ((owned.get(id) ?? 0) < qty) return false;
  }
  return true;
}

/** Total copies of one item across an inventory. */
export function countOf(inv: WireInventory, itemId: string): number {
  return multisetOf(inv).get(itemId) ?? 0;
}

/** Add an item into the first stackable/free bag cell (server-side purchase
 * placement fallback; the client normally submits its own arrangement). */
export function addToWireBag(bag: (WireStack | null)[], itemId: string, maxStack: number): boolean {
  if (maxStack > 1) {
    for (const stack of bag) {
      if (stack && stack.id === itemId && stack.qty < maxStack) {
        stack.qty++;
        return true;
      }
    }
  }
  const free = bag.indexOf(null);
  if (free === -1) return false;
  bag[free] = { id: itemId, qty: 1 };
  return true;
}
