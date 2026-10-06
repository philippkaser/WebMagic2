import { DUNGEON } from "../src/core/config";
import { Rng } from "../src/core/rng";
import { resolveItem } from "../src/items/catalog";
import { GOLD_RULES } from "../src/items/economy";
import { rollGamble } from "../src/items/loot";
import { DROPPED_ORB_PREFIX, LootBook, type IssuedOrb } from "../src/items/lootBook";
import type { ClientMsg, ServerMsg } from "../src/net/protocol";
import {
  canLeave,
  entryFloorForGear,
  PACE,
  paceWaitMs,
  spendPace,
  type PaceRules,
  type PaceState,
} from "../src/run/rules";
import { generateFloor } from "../src/world/gen";
import type { AccountRecord, AccountStore } from "./accounts";

/** The ledger — everything the server must never take a client's word for:
 * who you are, where your run stands, what you own. It knows the game's
 * rules where integrity needs them (run rules, the pace, what a floor can
 * drop, prices), unlike the router (server/relay.ts), which stays blind to
 * gameplay and only moves messages.
 *
 * Responsibilities:
 *  - identity: device-token login backed by the AccountStore
 *  - runs: fresh runs start where the banked gear resonates (the Weighing),
 *    continuing runs only go one floor deeper, no faster than the deep's
 *    pace (run/rules.ts PACE) — the router seats wherever the ledger says
 *  - loot: one book per floor instance (src/items/lootBook.ts), built from
 *    the instance's seed. The host reports what died or broke; the ledger
 *    rolls what it dropped and issues the orbs; a pickup claims an orb and
 *    is granted once. Dropped copies and the floor treasure are orbs too.
 *  - saves: provenance-checked banking once the Tithe of Five is paid,
 *    grave plunder up to what the dead were granted, the merchant, the Orb
 *    of Fortune, run loss
 *
 * It reaches the router only through `LedgerWorld`, so either side can be
 * replaced (a database behind the AccountStore, a server-side floor host
 * behind the router) without touching the other. Pure logic, time and
 * scheduling injected. */

/** A floor instance as the ledger sees it. */
export interface SeatedFloor {
  id: string;
  floor: number;
  /** The instance's floor seed (its layout, and so its loot book). */
  seed: number;
  players: ReadonlySet<string>;
}

/** Where a run continues — what the ledger asks the router to seat. */
export interface FloorEntry {
  floor: number;
  /** Rejoin this instance if it still exists (a reconnect). */
  preferInstanceId?: string;
  /** Floors this run has played, counting this one (the assignment carries it). */
  runFloors: number;
}

/** What the ledger needs from the router — and nothing more. */
export interface LedgerWorld {
  instanceOf(peerId: string): SeatedFloor | null;
  /** The instance's host (its oldest member); "" outside one. */
  hostOf(peerId: string): string;
  isConnected(peerId: string): boolean;
  nameOf(peerId: string): string;
  setName(peerId: string, name: string): void;
  send(peerId: string, msg: ServerMsg): void;
  /** Seat a connection on a floor (out of its current one) and announce it. */
  seat(peerId: string, entry: FloorEntry): SeatedFloor;
}

export interface LedgerOptions {
  /** The deep's pace for new floors; null lifts it (tests, the e2e smoke
   * test). Default: run/rules.ts PACE. */
  pace?: PaceRules | null;
  /** Runs `fn` after `ms` — how a floor request that came too soon is held
   * back. Default: setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Honor `dev` loot reports (a specific item or gold) — for the e2e smoke
   * test and local dev only; never in production. Default false. */
  devLoot?: boolean;
  /** The ledger's dice (loot books, the Orb of Fortune). Default Math.random. */
  random?: () => number;
}

/** Messages that change an account's course: any of them drops a floor
 * request still being held back for the pace (the newest intent wins). */
const CHANGES_COURSE: ReadonlySet<ClientMsg["t"]> = new Set<ClientMsg["t"]>([
  "login",
  "enterFloor",
  "leaveDungeon",
  "bank",
  "escape",
  "stash",
  "buy",
  "sell",
  "gamble",
  "died",
]);

const MAX_NAME = 24;

export class Ledger {
  /** peerId → account token (bound at login / first floor entry). */
  private tokens = new Map<string, string>();
  /** account token → the instance its wizard was last seated in, so a
   * dropped connection resumes in the same world (not a fresh roll). Only
   * held while the account has a run open. */
  private lastInstance = new Map<string, string>();
  /** instance id → what the wizards who died there (with others watching)
   * were granted this run: the upper bound on anything plundered from their
   * graves. */
  private gravePools = new Map<string, { items: Map<string, number>; gold: number }>();
  /** instance id → its loot book (made on first use, from the seed). */
  private books = new Map<string, LootBook>();
  /** account token → its pace tokens (run/rules.ts). */
  private paces = new Map<string, PaceState>();
  /** peerId → the ticket of its floor request being held for the pace. */
  private heldEntries = new Map<string, number>();
  private nextTicket = 1;
  private pace: PaceRules | null;
  private schedule: (fn: () => void, ms: number) => void;
  private devLoot: boolean;
  private random: () => number;

  constructor(
    private accounts: AccountStore,
    private world: LedgerWorld,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
    options: LedgerOptions = {},
  ) {
    this.pace = options.pace === undefined ? PACE : options.pace;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.devLoot = options.devLoot === true;
    this.random = options.random ?? Math.random;
  }

  /** A connection closed. Its run stays on the account, so a reconnect
   * resumes it (and lastInstance remembers where, for the same world). */
  disconnect(peerId: string): void {
    this.tokens.delete(peerId);
    this.heldEntries.delete(peerId);
  }

  /** Drop bookkeeping for instances that no longer exist. */
  prune(exists: (instanceId: string) => boolean): void {
    for (const id of this.gravePools.keys()) if (!exists(id)) this.gravePools.delete(id);
    for (const id of this.books.keys()) if (!exists(id)) this.books.delete(id);
  }

  handle(peerId: string, msg: ClientMsg): void {
    if (CHANGES_COURSE.has(msg.t)) this.heldEntries.delete(peerId);
    const send = (m: ServerMsg) => this.world.send(peerId, m);
    switch (msg.t) {
      case "login": {
        const account = this.accounts.login(
          typeof msg.token === "string" ? msg.token : undefined,
          String(msg.name).slice(0, MAX_NAME),
        );
        this.world.setName(peerId, account.name);
        this.tokens.set(peerId, account.token);
        send({ t: "loggedIn", token: account.token, save: this.accounts.saveOf(account) });
        break;
      }
      case "enterFloor":
        this.requestEntry(
          peerId,
          Math.max(1, Math.min(DUNGEON.maxFloor, Math.floor(Number(msg.floor)) || 1)),
          msg.fresh === true,
        );
        break;
      case "bank": {
        const account = this.accountOf(peerId);
        const inst = this.world.instanceOf(peerId);
        // The way home opens only once the run has paid the Tithe of Five,
        // counted server-side from floors actually entered — and the floor
        // recorded is the one you are ACTUALLY matchmade into.
        if (!inst || !canLeave(account.runFloors)) {
          send({ t: "saved", save: this.accounts.saveOf(account) });
          this.log(`${peerId} refused bank (${account.runFloors} floor(s) played)`);
          return;
        }
        const save = this.accounts.bank(account, inst.floor, msg.inventory);
        this.lastInstance.delete(account.token);
        send({ t: "saved", save });
        this.log(`${peerId} walked home from floor ${inst.floor}`);
        break;
      }
      case "escape": {
        // Feather escape: bank from any floor you're actually on, paid for
        // with a provably-owned feather. Checkpoint stays where it was.
        const account = this.accountOf(peerId);
        if (!this.world.instanceOf(peerId)) return;
        const save = this.accounts.escape(account, msg.inventory);
        if (!save) return; // no feather to spend — nothing banked
        this.lastInstance.delete(account.token);
        send({ t: "saved", save });
        this.log(`${peerId} escaped by feather`);
        break;
      }
      case "stash": {
        // Village-only rearrangement — no new items can enter this way.
        const account = this.accountOf(peerId);
        if (this.world.instanceOf(peerId)) return; // not mid-run
        const save = this.accounts.rearrange(account, msg.inventory);
        send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        break;
      }
      case "buy": {
        // Merchant purchase, validated against the shared economy price
        // table and the account's banked gold.
        const account = this.accountOf(peerId);
        if (this.world.instanceOf(peerId)) return; // village only
        if (typeof msg.itemId !== "string") return;
        const save = this.accounts.rearrange(account, msg.inventory, { buyItemId: msg.itemId });
        send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peerId} bought ${msg.itemId}`);
        break;
      }
      case "sell": {
        // Merchant sale: the sold copies must be provably owned; the credit
        // comes from the shared economy sell table.
        const account = this.accountOf(peerId);
        if (this.world.instanceOf(peerId)) return; // village only
        if (typeof msg.itemId !== "string" || typeof msg.qty !== "number") return;
        const save = this.accounts.rearrange(account, msg.inventory, {
          sell: { itemId: msg.itemId, qty: msg.qty },
        });
        send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peerId} sold ${msg.qty}× ${msg.itemId}`);
        break;
      }
      case "gamble": {
        // Orb of Fortune: the SERVER rolls (shared pure rollGamble) so a
        // client can't fish for outcomes. Refusal answers with the unchanged
        // save so the client's pending state resolves either way.
        const account = this.accountOf(peerId);
        if (this.world.instanceOf(peerId)) return; // village only
        const rolled = rollGamble(new Rng((this.random() * 0xffffffff) >>> 0), account.deepest);
        const save = this.accounts.gamble(account, rolled);
        send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peerId} gambled and drew ${rolled}`);
        break;
      }
      case "died": {
        const account = this.accountOf(peerId);
        const inst = this.world.instanceOf(peerId);
        // Died where others stood witness: what this run was granted may
        // lie in a grave now, so it becomes plunderable — and nothing else.
        if (inst && inst.players.size > 1) {
          const pool = this.gravePoolOf(inst.id);
          for (const id of account.runGrants) pool.items.set(id, (pool.items.get(id) ?? 0) + 1);
          pool.gold += account.runGold;
        }
        this.accounts.endRun(account);
        this.lastInstance.delete(account.token);
        break;
      }
      case "loot": {
        // Only the floor's host reports deaths and breaks; the book decides
        // whether that was a real source of this floor, and rolls its drops.
        if (this.world.hostOf(peerId) !== peerId) return;
        const inst = this.world.instanceOf(peerId);
        if (!inst || typeof msg.id !== "string") return;
        const book = this.bookOf(inst);
        const source = msg.source; // untrusted: the book only believes a split's generation
        let orbs: IssuedOrb[] | null;
        if (source?.kind === "dev") {
          const dev = this.devDrop(source);
          if (!dev) return;
          orbs = [book.issue(dev.itemId, dev.gold)];
        } else {
          orbs = book.roll(msg.id, source);
          if (!orbs) {
            this.log(`refused loot for ${msg.id.slice(0, 40)} in ${inst.id} (not this floor's, or already rolled)`);
            return;
          }
        }
        if (orbs.length > 0) send({ t: "lootRolled", id: msg.id, at: finiteVec3(msg.at), orbs });
        break;
      }
      case "drop": {
        // An inventory drop: the copy comes off the dropper's account and
        // becomes an orb in the floor's book — so a forged drop mints
        // nothing, and a dropper can't keep what someone else picked up.
        const inst = this.world.instanceOf(peerId);
        if (!inst || typeof msg.itemId !== "string") return;
        if (!this.accounts.release(this.accountOf(peerId), msg.itemId, msg.runLoot === true)) {
          this.log(`${peerId} dropped ${msg.itemId.slice(0, 64)} it doesn't own — nothing given up`);
          return;
        }
        send({ t: "released", orb: this.bookOf(inst).issue(msg.itemId, 0, DROPPED_ORB_PREFIX) });
        break;
      }
      case "claim": {
        // Only the instance host may attest pickups, and only for members of
        // its own instance — loot provenance mirrors loot authority. What is
        // granted is what the book put in the orb, once.
        if (this.world.hostOf(peerId) !== peerId) return;
        if (typeof msg.playerId !== "string" || typeof msg.orbId !== "string") return;
        const inst = this.world.instanceOf(peerId);
        if (!inst || !inst.players.has(msg.playerId) || !this.world.isConnected(msg.playerId)) return;
        const drop = this.bookOf(inst).claim(msg.orbId);
        if (!drop) {
          this.log(`refused claim of orb ${msg.orbId.slice(0, 40)} in ${inst.id} (unknown, or taken)`);
          return;
        }
        const target = this.accountOf(msg.playerId);
        if (drop.itemId) this.accounts.grant(target, drop.itemId);
        if (drop.gold > 0) this.accounts.grantGold(target, drop.gold, GOLD_RULES.perRunCap);
        break;
      }
      case "grant": {
        // Grave plunder, host-attested: honored only against what the dead
        // were granted in this instance (anything found is claimed by orb).
        if (this.world.hostOf(peerId) !== peerId) return;
        if (msg.source !== "grave" || typeof msg.playerId !== "string" || typeof msg.itemId !== "string") return;
        const inst = this.world.instanceOf(peerId);
        if (!inst || !inst.players.has(msg.playerId) || !this.world.isConnected(msg.playerId)) return;
        const pool = this.gravePools.get(inst.id);
        const left = pool?.items.get(msg.itemId) ?? 0;
        if (!pool || left < 1) {
          this.log(`refused grave grant of ${msg.itemId.slice(0, 64)} in ${inst.id} (not in any grave)`);
          return;
        }
        pool.items.set(msg.itemId, left - 1);
        this.accounts.grant(this.accountOf(msg.playerId), msg.itemId);
        break;
      }
      case "grantGold": {
        // Grave gold, up to what the dead carried — the pool bounds it.
        if (this.world.hostOf(peerId) !== peerId) return;
        if (msg.source !== "grave" || typeof msg.playerId !== "string" || typeof msg.amount !== "number") return;
        const inst = this.world.instanceOf(peerId);
        if (!inst || !inst.players.has(msg.playerId) || !this.world.isConnected(msg.playerId)) return;
        const pool = this.gravePools.get(inst.id);
        const amount = Math.floor(Math.min(msg.amount, pool?.gold ?? 0));
        if (!pool || !(amount > 0)) return;
        pool.gold -= amount;
        this.accounts.grantGold(this.accountOf(msg.playerId), amount, GOLD_RULES.perRunCap);
        break;
      }
    }
  }

  /** Account bound to this connection — auto-minted for clients that never
   * logged in, so every code path above has one. */
  private accountOf(peerId: string): AccountRecord {
    const token = this.tokens.get(peerId);
    const existing = token ? this.accounts.get(token) : null;
    if (existing) return existing;
    const account = this.accounts.login(undefined, this.world.nameOf(peerId));
    this.tokens.set(peerId, account.token);
    return account;
  }

  // ── Runs ───────────────────────────────────────────────────────────────────

  /** A floor request, kept to the deep's pace: re-entering the floor you're
   * on (a reconnect) goes straight through; a new floor spends a pace token,
   * and one asked for before a token is due is HELD — answered when it is,
   * unless something newer from this wizard (or a disconnect) drops it. The
   * client just hovers a little longer in the rift. */
  private requestEntry(peerId: string, requested: number, fresh: boolean): void {
    const account = this.accountOf(peerId);
    const resume = !fresh && account.runFloor > 0 && requested === account.runFloor;
    if (this.pace && !resume) {
      const state = this.paces.get(account.token);
      const wait = paceWaitMs(state, this.now(), this.pace);
      if (wait > 0) {
        const ticket = this.nextTicket++;
        this.heldEntries.set(peerId, ticket);
        this.log(`${peerId} is ahead of the deep's pace — floor request held ${wait} ms`);
        this.schedule(() => {
          if (this.heldEntries.get(peerId) !== ticket || !this.world.isConnected(peerId)) return;
          this.heldEntries.delete(peerId);
          this.requestEntry(peerId, requested, fresh);
        }, wait);
        return;
      }
      this.paces.set(account.token, spendPace(state, this.now(), this.pace));
    }
    this.enterFloor(peerId, requested, fresh);
  }

  private enterFloor(peerId: string, requested: number, fresh: boolean): void {
    const account = this.accountOf(peerId);
    // Run-validated entry — no floor-skipping by message forgery:
    //  - continuing a run: the same floor (reconnect → back into the same
    //    instance) or exactly one deeper (portal, warp rune);
    //  - anything else starts a FRESH run, which forfeits an unfinished one
    //    and always lands where the banked gear resonates (the Weighing).
    const inRun = account.runFloor > 0;
    let floor: number;
    let preferInstanceId: string | undefined;
    if (!fresh && inRun && requested === account.runFloor) {
      floor = requested;
      preferInstanceId = this.lastInstance.get(account.token);
    } else if (!fresh && inRun && requested === account.runFloor + 1) {
      floor = requested;
      this.accounts.advanceRun(account, floor);
    } else {
      const eq = account.inventory.equipment;
      floor = entryFloorForGear([eq.staff, eq.amulet, eq.cloak, eq.boots]);
      if (requested !== floor) {
        this.log(`${peerId} asked for floor ${requested}; the Weighing says ${floor}`);
      }
      this.accounts.startRun(account, floor);
    }
    const inst = this.world.seat(peerId, { floor, preferInstanceId, runFloors: account.runFloors });
    this.lastInstance.set(account.token, inst.id);
  }

  // ── Loot ───────────────────────────────────────────────────────────────────

  /** The instance's loot book, built from its seed on first use. */
  private bookOf(inst: SeatedFloor): LootBook {
    let book = this.books.get(inst.id);
    if (!book) {
      book = new LootBook(generateFloor(inst.seed, inst.floor), new Rng((this.random() * 0xffffffff) >>> 0));
      this.books.set(inst.id, book);
    }
    return book;
  }

  /** A dev drop, when this ledger honors them: a real item, or some gold. */
  private devDrop(raw: unknown): { itemId: string | null; gold: number } | null {
    if (!this.devLoot) {
      this.log("refused a dev loot report (devLoot is off)");
      return null;
    }
    const d = raw as { itemId?: unknown; gold?: unknown };
    if (typeof d.itemId === "string") {
      try {
        resolveItem(d.itemId);
      } catch {
        return null;
      }
      return { itemId: d.itemId, gold: 0 };
    }
    const gold = Math.floor(Number(d.gold));
    return Number.isFinite(gold) && gold > 0 ? { itemId: null, gold: Math.min(gold, GOLD_RULES.perGrantCap) } : null;
  }

  private gravePoolOf(instanceId: string): { items: Map<string, number>; gold: number } {
    let pool = this.gravePools.get(instanceId);
    if (!pool) {
      pool = { items: new Map(), gold: 0 };
      this.gravePools.set(instanceId, pool);
    }
    return pool;
  }
}

/** An untrusted position, made finite (it only places the host's own orbs). */
function finiteVec3(v: unknown): [number, number, number] {
  const a = Array.isArray(v) ? v : [];
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return [n(a[0]), n(a[1]), n(a[2])];
}
