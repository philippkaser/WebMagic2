import { BASIC_BOOTS_ID, BASIC_STAFF_ID } from "../src/items/catalog";
import type { ServerSave, WireEquipment } from "../src/net/protocol";

/** Server-side accounts & saves — the anti-cheat foundation.
 *
 * The client's localStorage is now just a cache; this store is the truth for
 * checkpoint progress and banked gear. The core rule is PROVENANCE, not item
 * knowledge (ids stay opaque strings, keeping the server gameplay-blind):
 *
 *   an item may be banked ⇔ it was previously banked, is starter gear, or
 *   was GRANTED during the current run by the floor host's attestation.
 *
 * Hosts attest grants because loot is host-authoritative already (an orb can
 * only be taken once, and only the host announces pickups) — the beneficiary
 * never vouches for itself. Death or quitting discards the run's grants.
 * A hacked client can therefore repaint its own screen, but nothing survives
 * a bank round trip that the floor's authority didn't hand out.
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
  equipment: WireEquipment;
  /** Item ids host-attested during the current (unbanked) run. */
  runGrants: string[];
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

export function defaultWireEquipment(): WireEquipment {
  return { staff: BASIC_STAFF_ID, amulet: null, cloak: null, boots: BASIC_BOOTS_ID };
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
        for (const raw of JSON.parse(initialJson) as AccountRecord[]) {
          if (typeof raw?.token === "string" && raw.token.length > 0) {
            this.accounts.set(raw.token, {
              token: raw.token,
              name: cleanName(raw.name),
              checkpoint: Math.max(1, Math.floor(Number(raw.checkpoint) || 1)),
              equipment: sanitizeShape(raw.equipment),
              runGrants: Array.isArray(raw.runGrants)
                ? raw.runGrants.filter(isItemId).slice(0, MAX_RUN_GRANTS)
                : [],
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
      equipment: defaultWireEquipment(),
      runGrants: [],
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
    return { checkpoint: account.checkpoint, equipment: { ...account.equipment } };
  }

  /** Host attested that this account picked up an item this run. */
  grant(account: AccountRecord, itemId: string): void {
    if (!isItemId(itemId)) return;
    if (account.runGrants.length >= MAX_RUN_GRANTS) return;
    if (!account.runGrants.includes(itemId)) {
      account.runGrants.push(itemId);
      this.flush();
    }
  }

  setRunFloor(account: AccountRecord, floor: number): void {
    if (account.runFloor !== floor) {
      account.runFloor = floor;
      this.flush();
    }
  }

  /** The run ended without banking (death/quit) — its grants are lost. */
  endRun(account: AccountRecord): void {
    if (account.runGrants.length === 0 && account.runFloor === 0) return;
    account.runGrants = [];
    account.runFloor = 0;
    this.flush();
  }

  /** Bank at `floor`: every submitted item must be provably owned (previous
   * bank ∪ starter gear ∪ this run's grants); anything else is stripped back
   * to the previous bank. Returns the authoritative save. */
  bank(account: AccountRecord, floor: number, submitted: unknown): ServerSave {
    const sub = sanitizeShape(submitted);
    const owned = new Set<string>([
      ...DEFAULT_ITEMS,
      ...account.runGrants,
      account.equipment.staff,
      account.equipment.boots,
    ]);
    if (account.equipment.amulet) owned.add(account.equipment.amulet);
    if (account.equipment.cloak) owned.add(account.equipment.cloak);

    const keep = (id: string | null, fallback: string | null): string | null =>
      id !== null && owned.has(id) ? id : fallback;

    account.equipment = {
      staff: keep(sub.staff, account.equipment.staff) ?? BASIC_STAFF_ID,
      amulet: sub.amulet === null ? null : keep(sub.amulet, account.equipment.amulet),
      cloak: sub.cloak === null ? null : keep(sub.cloak, account.equipment.cloak),
      boots: keep(sub.boots, account.equipment.boots) ?? BASIC_BOOTS_ID,
    };
    account.checkpoint = Math.max(account.checkpoint, floor);
    account.runGrants = [];
    account.runFloor = 0;
    this.flush();
    return this.saveOf(account);
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

/** Coerce an untrusted equipment payload into the right SHAPE (provenance is
 * checked separately in bank()). */
function sanitizeShape(raw: unknown): WireEquipment {
  const d = (raw ?? {}) as Partial<WireEquipment>;
  return {
    staff: isItemId(d.staff) ? d.staff : BASIC_STAFF_ID,
    amulet: isItemId(d.amulet) ? d.amulet : null,
    cloak: isItemId(d.cloak) ? d.cloak : null,
    boots: isItemId(d.boots) ? d.boots : BASIC_BOOTS_ID,
  };
}
