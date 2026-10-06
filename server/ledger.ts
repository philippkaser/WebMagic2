import { DUNGEON } from "../src/core/config";
import { Rng } from "../src/core/rng";
import { GOLD_RULES } from "../src/items/economy";
import { rollGamble } from "../src/items/loot";
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
 *  - saves: host-attested grants (found loot must be something the floor
 *    could drop; what a wizard gave up — a grave, a drop — only up to what
 *    was given up), provenance-checked banking once the Tithe of Five is
 *    paid, the merchant, the Orb of Fortune, run loss
 *
 * It reaches the router only through `LedgerWorld`, so either side can be
 * replaced (a database behind the AccountStore, a server-side floor host
 * behind the router) without touching the other. Pure logic, time and
 * scheduling injected. */

/** A floor instance as the ledger sees it. */
export interface SeatedFloor {
  id: string;
  floor: number;
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
  /** instance id → what wizards gave up there: the run grants of those who
   * died on it (their graves) and every copy dropped on it. The upper bound
   * on anything granted with source "grave" or "drop". */
  private floorPools = new Map<string, { items: Map<string, number>; gold: number }>();
  /** account token → its pace tokens (run/rules.ts). */
  private paces = new Map<string, PaceState>();
  /** peerId → the ticket of its floor request being held for the pace. */
  private heldEntries = new Map<string, number>();
  private nextTicket = 1;
  private pace: PaceRules | null;
  private schedule: (fn: () => void, ms: number) => void;

  constructor(
    private accounts: AccountStore,
    private world: LedgerWorld,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
    options: LedgerOptions = {},
  ) {
    this.pace = options.pace === undefined ? PACE : options.pace;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  /** A connection closed. Its run stays on the account, so a reconnect
   * resumes it (and lastInstance remembers where, for the same world). */
  disconnect(peerId: string): void {
    this.tokens.delete(peerId);
    this.heldEntries.delete(peerId);
  }

  /** Drop bookkeeping for instances that no longer exist. */
  prune(exists: (instanceId: string) => boolean): void {
    for (const id of this.floorPools.keys()) if (!exists(id)) this.floorPools.delete(id);
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
        const rolled = rollGamble(new Rng((Math.random() * 0xffffffff) >>> 0), account.deepest);
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
          const pool = this.poolOf(inst.id);
          for (const id of account.runGrants) pool.items.set(id, (pool.items.get(id) ?? 0) + 1);
          pool.gold += account.runGold;
        }
        this.accounts.endRun(account);
        this.lastInstance.delete(account.token);
        break;
      }
      case "drop": {
        // An inventory drop: the copy comes off the dropper's account before
        // anyone can be granted it, and goes into the floor's pool — so a
        // forged drop mints nothing, and a dropper can't keep what someone
        // else has picked up.
        const inst = this.world.instanceOf(peerId);
        if (!inst || typeof msg.itemId !== "string") return;
        if (!this.accounts.release(this.accountOf(peerId), msg.itemId, msg.runLoot === true)) {
          this.log(`${peerId} dropped ${msg.itemId} it doesn't own — nothing given up`);
          return;
        }
        const pool = this.poolOf(inst.id);
        pool.items.set(msg.itemId, (pool.items.get(msg.itemId) ?? 0) + 1);
        break;
      }
      case "grant": {
        // Only the instance host may attest pickups, and only for members of
        // its own instance — loot provenance mirrors loot authority.
        if (this.world.hostOf(peerId) !== peerId) return;
        if (typeof msg.playerId !== "string" || typeof msg.itemId !== "string") return;
        const inst = this.world.instanceOf(peerId);
        if (!inst || !inst.players.has(msg.playerId)) return;
        if (!this.world.isConnected(msg.playerId)) return;
        const target = this.accountOf(msg.playerId);
        if (msg.source === "grave" || msg.source === "drop") {
          // Something another wizard gave up here — never more than that.
          const pool = this.floorPools.get(inst.id);
          const left = pool?.items.get(msg.itemId) ?? 0;
          if (!pool || left < 1) {
            this.log(`refused ${msg.source} grant of ${msg.itemId} in ${inst.id} (nobody gave one up)`);
            return;
          }
          pool.items.set(msg.itemId, left - 1);
          this.accounts.grant(target, msg.itemId);
        } else if (!this.accounts.grantFound(target, msg.itemId, inst.floor)) {
          // A lone wizard is its own host: what it says it found must be
          // something this floor could have dropped.
          this.log(`refused grant of ${msg.itemId} on floor ${inst.floor} (not this floor's loot)`);
        }
        break;
      }
      case "grantGold": {
        // Gold provenance mirrors item grants: host-only, own instance only.
        if (this.world.hostOf(peerId) !== peerId) return;
        if (typeof msg.playerId !== "string" || typeof msg.amount !== "number") return;
        const inst = this.world.instanceOf(peerId);
        if (!inst || !inst.players.has(msg.playerId)) return;
        if (!this.world.isConnected(msg.playerId)) return;
        const target = this.accountOf(msg.playerId);
        if (msg.source === "grave") {
          const pool = this.floorPools.get(inst.id);
          const amount = Math.floor(Math.min(msg.amount, pool?.gold ?? 0));
          if (!pool || !(amount > 0)) return;
          pool.gold -= amount;
          // The pool already bounds it — no per-pickup cap on top.
          this.accounts.grantGold(target, amount, GOLD_RULES.perRunCap);
        } else {
          this.accounts.grantFoundGold(target, msg.amount, inst.floor);
        }
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

  private poolOf(instanceId: string): { items: Map<string, number>; gold: number } {
    let pool = this.floorPools.get(instanceId);
    if (!pool) {
      pool = { items: new Map(), gold: 0 };
      this.floorPools.set(instanceId, pool);
    }
    return pool;
  }
}
