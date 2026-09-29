import { maxStackOf, resolveItem } from "../items/catalog";
import { GOLD_RULES } from "../items/economy";
import { routeAcquire, type Carried } from "../items/inventory";
import type { Vec3 } from "../world/types";

/** Grave chests — the rules, pure.
 *
 * Lore: the dungeon keeps what the dead carried, but it is jealous and slow.
 * Where other living wizards stand witness, it cannot swallow the dead fast
 * enough — a grave remains, and anyone may plunder it.
 *
 * Mechanics: a wizard who dies on a SHARED floor leaves a grave chest at the
 * spot holding exactly what the death took from them (this run's loot and
 * gold). Graves are host-authoritative world state like loot orbs: the host
 * validates and announces them, grants every taken item (the same
 * provenance path as any pickup), and late joiners receive them in the world
 * sync. This module holds the validation and bookkeeping; the networking and
 * rendering live in encounters/Graves.tsx. */

export interface GraveItem {
  id: string;
  qty: number;
}

export interface GraveContents {
  items: GraveItem[];
  gold: number;
}

export interface GraveRecord extends GraveContents {
  id: string;
  ownerId: string;
  ownerName: string;
  /** Who the floor says killed them, or null (the dungeon did). */
  killerName: string | null;
  pos: Vec3;
  /** The fallen wizard's robe color — the grave glows with it. */
  color: string;
}

/** One pick from a grave: `qty` copies of the stack at `i`. */
export interface GravePick {
  i: number;
  qty: number;
}

export const GRAVE_LIMITS = {
  /** More stacks than any wizard can carry (4 gear + 5 bag + 2 belt). */
  maxStacks: 16,
  maxGold: GOLD_RULES.perRunCap,
} as const;

/** Coerce an untrusted grave payload into valid contents: known item ids
 * only, stack sizes within the catalog cap, bounded counts and gold. Returns
 * null when nothing of value remains (no grave is worth raising). */
export function sanitizeGraveContents(raw: unknown): GraveContents | null {
  const d = (raw ?? {}) as Partial<GraveContents>;
  const items: GraveItem[] = [];
  for (const s of Array.isArray(d.items) ? d.items : []) {
    if (items.length >= GRAVE_LIMITS.maxStacks) break;
    const stack = s as Partial<GraveItem> | null;
    if (!stack || typeof stack.id !== "string") continue;
    try {
      resolveItem(stack.id);
    } catch {
      continue; // unknown/forged id — the grave won't hold it
    }
    const qty = Math.floor(Number(stack.qty));
    if (!Number.isFinite(qty) || qty < 1) continue;
    items.push({ id: stack.id, qty: Math.min(qty, maxStackOf(stack.id)) });
  }
  const g = Math.floor(Number(d.gold));
  const gold = Number.isFinite(g) ? Math.max(0, Math.min(g, GRAVE_LIMITS.maxGold)) : 0;
  return items.length > 0 || gold > 0 ? { items, gold } : null;
}

/** Validate picks against what the grave still holds: in-range indices,
 * positive quantities capped at what's left, each stack at most once. */
export function sanitizePicks(grave: GraveContents, raw: unknown): GravePick[] {
  const picks: GravePick[] = [];
  const seen = new Set<number>();
  for (const p of Array.isArray(raw) ? raw : []) {
    const pick = p as Partial<GravePick> | null;
    const i = Math.floor(Number(pick?.i));
    const qty = Math.floor(Number(pick?.qty));
    if (!Number.isInteger(i) || i < 0 || i >= grave.items.length || seen.has(i)) continue;
    const left = grave.items[i].qty;
    if (!Number.isFinite(qty) || qty < 1 || left < 1) continue;
    seen.add(i);
    picks.push({ i, qty: Math.min(qty, left) });
  }
  return picks;
}

/** Apply validated picks (and optionally the gold) to a grave. Indices stay
 * stable — emptied stacks remain as qty 0 so later picks keep pointing at
 * the same cells on every machine. */
export function takeFromGrave<T extends GraveContents>(
  grave: T,
  picks: readonly GravePick[],
  takeGold: boolean,
): { grave: T; taken: GraveItem[]; gold: number } {
  const items = grave.items.map((s) => ({ ...s }));
  const taken: GraveItem[] = [];
  for (const { i, qty } of picks) {
    const stack = items[i];
    if (!stack) continue;
    const n = Math.min(qty, stack.qty);
    if (n < 1) continue;
    stack.qty -= n;
    taken.push({ id: stack.id, qty: n });
  }
  const gold = takeGold ? grave.gold : 0;
  return { grave: { ...grave, items, gold: grave.gold - gold }, taken, gold };
}

export function graveIsEmpty(grave: GraveContents): boolean {
  return grave.gold <= 0 && grave.items.every((s) => s.qty <= 0);
}

export function graveItemCount(grave: GraveContents): number {
  return grave.items.reduce((n, s) => n + Math.max(0, s.qty), 0);
}

/** The looter's side: everything from this grave that fits the carried kit,
 * copy by copy, routed exactly like any pickup. Plunder is run loot — lost
 * again if the looter dies before walking home. */
export function planGravePicks(inv: Carried, grave: GraveContents): GravePick[] {
  const picks: GravePick[] = [];
  let kit = inv;
  grave.items.forEach((stack, i) => {
    let qty = 0;
    for (let n = 0; n < stack.qty; n++) {
      const routed = routeAcquire(kit, stack.id, true);
      if (!routed) break;
      kit = routed.next;
      qty++;
    }
    if (qty > 0) picks.push({ i, qty });
  });
  return picks;
}
