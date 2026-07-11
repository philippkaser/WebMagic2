import { BASIC_BOOTS_ID, BASIC_STAFF_ID, maxStackOf, SAVE_FEATHER_ID } from "../src/items/catalog";
import {
  addToWireBag,
  GAMBLE_PRICE,
  GOLD_RULES,
  isSubMultiset,
  merchantPrice,
  multisetOf,
  sellValue,
} from "../src/items/economy";
import { BAG_SLOTS, BELT_SLOTS, CHEST_SLOTS } from "../src/items/inventory";
import type { ServerSave, WireEquipment, WireInventory, WireStack } from "../src/net/protocol";

/** Server-side accounts & saves — the anti-cheat foundation.
 *
 * The client's localStorage is now just a cache; this store is the truth for
 * checkpoint progress, banked inventory (equipment + belt + bag + chest) and
 * gold. The core rule is PROVENANCE, not item knowledge (ids stay opaque
 * strings, keeping the server gameplay-blind):
 *
 *   an item may be banked ⇔ it was previously banked, is starter gear, or
 *   was GRANTED during the current run by the floor host's attestation.
 *   Gold follows the same rule with amounts (grantGold), under sanity caps.
 *
 * Hosts attest grants because loot is host-authoritative already (an orb can
 * only be taken once, and only the host announces pickups) — the beneficiary
 * never vouches for itself. Death or quitting discards the run's grants.
 * A hacked client can therefore repaint its own screen, but nothing survives
 * a bank round trip that the floor's authority didn't hand out.
 *
 * The only item MEANING the server borrows from the shared pure catalog is
 * the same kind it always has (starter ids): merchant prices and the feather
 * id, both via items/economy.ts — so purchases and feather escapes validate
 * server-side without the server learning what any item does.
 *
 * Identity is a device token: first login mints an account + token, the
 * client stores it, later logins present it. (Real auth — email/OAuth —
 * slots in behind login() without touching anything else.)
 *
 * Pure logic with injected persistence, so the rules are unit-testable. */

export interface AccountRecord {
  token: string;
  name: string;
  checkpoint: number;
  inventory: WireInventory;
  /** Item ids host-attested during the current (unbanked) run — a MULTISET
   * (duplicates count: two potions granted = two bankable potions). */
  runGrants: string[];
  /** Gold host-attested during the current run. */
  runGold: number;
  /** Floor the account is currently on (0 = not in a run) — lets a dropped
   * connection resume mid-run without opening floor-skipping. */
  runFloor: number;
}

/** Everyone owns starter gear implicitly. */
const DEFAULT_ITEMS: readonly string[] = [BASIC_STAFF_ID, BASIC_BOOTS_ID];

const MAX_NAME = 24;
const MAX_ITEM_ID = 64;
/** Cap per-run grants — far above any legitimate run, only bounds abuse. */
const MAX_RUN_GRANTS = 200;
/** Generic per-cell stack bound (real stack caps are client meaning). */
const MAX_STACK = 99;

export function defaultWireEquipment(): WireEquipment {
  return { staff: BASIC_STAFF_ID, amulet: null, cloak: null, boots: BASIC_BOOTS_ID };
}

export function defaultWireInventory(): WireInventory {
  return {
    equipment: defaultWireEquipment(),
    bag: new Array(BAG_SLOTS).fill(null),
    belt: new Array(BELT_SLOTS).fill(null),
    chest: new Array(CHEST_SLOTS).fill(null),
    gold: 0,
  };
}

export class AccountStore {
  private accounts = new Map<string, AccountRecord>();

  constructor(
    /** Called with the serialized store after every mutation (debounce lives
     * in the caller). Null = in-memory only (tests, local play). */
    private persist: ((json: string) => void) | null = null,
    initialJson?: string | null,
    private tokenFn: () => string = () => crypto.randomUUID(),
  ) {
    if (initialJson) {
      try {
        for (const raw of JSON.parse(initialJson) as (AccountRecord & {
          equipment?: WireEquipment; // pre-inventory record shape
        })[]) {
          if (typeof raw?.token === "string" && raw.token.length > 0) {
            this.accounts.set(raw.token, {
              token: raw.token,
              name: cleanName(raw.name),
              checkpoint: Math.max(1, Math.floor(Number(raw.checkpoint) || 1)),
              inventory: sanitizeInventory(raw.inventory ?? { equipment: raw.equipment }),
              runGrants: Array.isArray(raw.runGrants)
                ? raw.runGrants.filter(isItemId).slice(0, MAX_RUN_GRANTS)
                : [],
              runGold: clampGold(raw.runGold, GOLD_RULES.perRunCap),
              runFloor: Math.max(0, Math.floor(Number(raw.runFloor) || 0)),
            });
          }
        }
      } catch {
        // Corrupt store — start fresh rather than crash the server.
      }
    }
  }

  get size(): number {
    return this.accounts.size;
  }

  /** Fetch-or-create by token. Unknown/absent token mints a new account. */
  login(token: string | undefined, name: string): AccountRecord {
    const existing = token ? this.accounts.get(token) : undefined;
    if (existing) {
      existing.name = cleanName(name);
      this.flush();
      return existing;
    }
    const account: AccountRecord = {
      token: this.tokenFn(),
      name: cleanName(name),
      checkpoint: 1,
      inventory: defaultWireInventory(),
      runGrants: [],
      runGold: 0,
      runFloor: 0,
    };
    this.accounts.set(account.token, account);
    this.flush();
    return account;
  }

  get(token: string): AccountRecord | null {
    return this.accounts.get(token) ?? null;
  }

  saveOf(account: AccountRecord): ServerSave {
    return { checkpoint: account.checkpoint, inventory: cloneInventory(account.inventory) };
  }

  /** Host attested that this account picked up an item this run. Duplicates
   * are counted — the grants are a multiset. */
  grant(account: AccountRecord, itemId: string): void {
    if (!isItemId(itemId)) return;
    if (account.runGrants.length >= MAX_RUN_GRANTS) return;
    account.runGrants.push(itemId);
    this.flush();
  }

  /** Host attested a gold pickup this run (sanity-capped, never trusted raw). */
  grantGold(account: AccountRecord, amount: number): void {
    const n = clampGold(amount, GOLD_RULES.perGrantCap);
    if (n <= 0) return;
    account.runGold = Math.min(account.runGold + n, GOLD_RULES.perRunCap);
    this.flush();
  }

  setRunFloor(account: AccountRecord, floor: number): void {
    if (account.runFloor !== floor) {
      account.runFloor = floor;
      this.flush();
    }
  }

  /** The run ended without banking (death/quit) — its grants are lost. */
  endRun(account: AccountRecord): void {
    if (account.runGrants.length === 0 && account.runGold === 0 && account.runFloor === 0) return;
    account.runGrants = [];
    account.runGold = 0;
    account.runFloor = 0;
    this.flush();
  }

  /** Bank at `floor`: every submitted item must be provably owned (previous
   * bank ∪ starter gear ∪ this run's grants, counted as a multiset); anything
   * beyond that is stripped. Gold is clamped to banked + attested. Returns
   * the authoritative save. */
  bank(account: AccountRecord, floor: number, submitted: unknown): ServerSave {
    this.settle(account, submitted);
    account.checkpoint = Math.max(account.checkpoint, floor);
    account.runGrants = [];
    account.runGold = 0;
    account.runFloor = 0;
    this.flush();
    return this.saveOf(account);
  }

  /** Feather escape: bank from anywhere WITHOUT moving the checkpoint. Only
   * valid if a Feather of Safe Passage was provably owned and is now spent
   * (submitted contains one fewer than owned). Returns null if it wasn't. */
  escape(account: AccountRecord, submitted: unknown): ServerSave | null {
    const sub = sanitizeInventory(submitted);
    const owned = this.ownedMultiset(account);
    const submittedFeathers = multisetOf(sub).get(SAVE_FEATHER_ID) ?? 0;
    if ((owned.get(SAVE_FEATHER_ID) ?? 0) < submittedFeathers + 1) return null;
    this.settle(account, sub);
    account.runGrants = [];
    account.runGold = 0;
    account.runFloor = 0;
    this.flush();
    return this.saveOf(account);
  }

  /** Village-only rearrangement (chest/bag/belt moves, discards) and merchant
   * trades. The submitted inventory may only contain what's already banked —
   * plus exactly the purchased item when `trade.buyItemId` is set (paid from
   * banked gold at the shared economy price), minus exactly the sold copies
   * when `trade.sell` is set (credited at the shared sell value). Returns
   * null on any violation (the caller answers with the unchanged save). */
  rearrange(
    account: AccountRecord,
    submitted: unknown,
    trade?: { buyItemId?: string; sell?: { itemId: string; qty: number } },
  ): ServerSave | null {
    const sub = sanitizeInventory(submitted);
    const owned = multisetOf(account.inventory);
    const claimed = multisetOf(sub);
    let maxGold = account.inventory.gold;
    if (trade?.buyItemId !== undefined) {
      const price = merchantPrice(trade.buyItemId);
      if (price === null || account.inventory.gold < price) return null;
      owned.set(trade.buyItemId, (owned.get(trade.buyItemId) ?? 0) + 1);
      maxGold -= price;
    }
    if (trade?.sell !== undefined) {
      const qty = Math.floor(trade.sell.qty);
      const value = sellValue(trade.sell.itemId);
      if (value === null || qty < 1 || qty > MAX_STACK) return null;
      // The sold copies must be accounted for: submitted + sold ⊆ owned.
      claimed.set(trade.sell.itemId, (claimed.get(trade.sell.itemId) ?? 0) + qty);
      maxGold = clampGold(maxGold + value * qty, GOLD_RULES.accountCap);
    }
    if (!isSubMultiset(claimed, owned)) return null;
    if (sub.gold > maxGold) return null;
    // (A staff always exists: sanitizeInventory backfills the starter one.)
    account.inventory = sub;
    this.flush();
    return this.saveOf(account);
  }

  /** Orb of Fortune: the caller rolls the item (shared pure logic + its own
   * RNG) and the store validates gold and bag room. Null = refused, nothing
   * charged. */
  gamble(account: AccountRecord, rolledItemId: string): ServerSave | null {
    if (!isItemId(rolledItemId)) return null;
    if (account.inventory.gold < GAMBLE_PRICE) return null;
    const bag = account.inventory.bag.map((s) => (s ? { ...s } : null));
    if (!addToWireBag(bag, rolledItemId, safeMaxStack(rolledItemId))) return null;
    account.inventory = {
      ...account.inventory,
      bag,
      gold: account.inventory.gold - GAMBLE_PRICE,
    };
    this.flush();
    return this.saveOf(account);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Everything this account may legitimately bank right now. */
  private ownedMultiset(account: AccountRecord): Map<string, number> {
    const owned = multisetOf(account.inventory);
    for (const id of DEFAULT_ITEMS) owned.set(id, (owned.get(id) ?? 0) + 1);
    for (const id of account.runGrants) owned.set(id, (owned.get(id) ?? 0) + 1);
    return owned;
  }

  /** Provenance-settle a submitted inventory into the account: clamp every
   * cell to the owned multiset (consuming as it goes), clamp gold, keep the
   * previous staff/boots if the submitted ones don't check out. */
  private settle(account: AccountRecord, submitted: unknown): void {
    const sub = sanitizeInventory(submitted);
    const budget = this.ownedMultiset(account);

    const claim = (id: string | null, qty = 1): number => {
      if (!id) return 0;
      const take = Math.min(qty, budget.get(id) ?? 0);
      if (take > 0) budget.set(id, budget.get(id)! - take);
      return take;
    };
    const settleGrid = (grid: (WireStack | null)[]) =>
      grid.map((stack) => {
        if (!stack) return null;
        const qty = claim(stack.id, stack.qty);
        return qty > 0 ? { id: stack.id, qty } : null;
      });

    account.inventory = {
      equipment: {
        staff: claim(sub.equipment.staff) ? sub.equipment.staff : account.inventory.equipment.staff,
        amulet: sub.equipment.amulet && claim(sub.equipment.amulet) ? sub.equipment.amulet : null,
        cloak: sub.equipment.cloak && claim(sub.equipment.cloak) ? sub.equipment.cloak : null,
        boots: sub.equipment.boots && claim(sub.equipment.boots) ? sub.equipment.boots : null,
      },
      belt: settleGrid(sub.belt),
      bag: settleGrid(sub.bag),
      chest: settleGrid(sub.chest),
      gold: Math.min(
        sub.gold,
        clampGold(account.inventory.gold + account.runGold, GOLD_RULES.accountCap),
      ),
    };
  }

  private flush(): void {
    this.persist?.(JSON.stringify([...this.accounts.values()]));
  }
}

function cleanName(name: unknown): string {
  return String(name ?? "").slice(0, MAX_NAME) || "Wizard";
}

function isItemId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ITEM_ID;
}

/** Stack cap for gamble placement — item meaning stays optional here. */
function safeMaxStack(itemId: string): number {
  try {
    return maxStackOf(itemId);
  } catch {
    return 1;
  }
}

function clampGold(raw: unknown, cap: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.max(0, Math.min(n, cap)) : 0;
}

function sanitizeStack(raw: unknown): WireStack | null {
  const s = raw as Partial<WireStack> | null;
  if (!s || !isItemId(s.id)) return null;
  const qty = Math.floor(Number(s.qty));
  if (!Number.isFinite(qty) || qty < 1) return null;
  return { id: s.id, qty: Math.min(qty, MAX_STACK) };
}

function sanitizeGrid(raw: unknown, size: number): (WireStack | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: size }, (_, i) => sanitizeStack(arr[i]));
}

/** Coerce an untrusted inventory payload into the right SHAPE (provenance is
 * checked separately). Also upgrades pre-inventory saves ({equipment} only). */
export function sanitizeInventory(raw: unknown): WireInventory {
  const d = (raw ?? {}) as Partial<WireInventory>;
  const e = (d.equipment ?? {}) as Partial<WireEquipment>;
  return {
    equipment: {
      staff: isItemId(e.staff) ? e.staff : BASIC_STAFF_ID,
      amulet: isItemId(e.amulet) ? e.amulet : null,
      cloak: isItemId(e.cloak) ? e.cloak : null,
      boots: isItemId(e.boots) ? e.boots : null,
    },
    bag: sanitizeGrid(d.bag, BAG_SLOTS),
    belt: sanitizeGrid(d.belt, BELT_SLOTS),
    chest: sanitizeGrid(d.chest, CHEST_SLOTS),
    gold: clampGold(d.gold, GOLD_RULES.accountCap),
  };
}

function cloneInventory(inv: WireInventory): WireInventory {
  return {
    equipment: { ...inv.equipment },
    bag: inv.bag.map((s) => (s ? { ...s } : null)),
    belt: inv.belt.map((s) => (s ? { ...s } : null)),
    chest: inv.chest.map((s) => (s ? { ...s } : null)),
    gold: inv.gold,
  };
}
