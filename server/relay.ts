import { DUNGEON } from "../src/core/config";
import { Rng } from "../src/core/rng";
import { GOLD_RULES } from "../src/items/economy";
import { rollGamble } from "../src/items/loot";
import { FloorDirectory, type JoinOptions } from "../src/net/matchmaking";
import {
  CHANNEL_AUTHORITY,
  CHANNEL_PEER,
  CHANNEL_TO_HOST,
  type ClientMsg,
  type MemberInfo,
  type ServerMsg,
} from "../src/net/protocol";
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

/** The gameplay-blind relay core. Pure logic (I/O injected via `send`), so
 * the host-migration/authority/routing rules are unit-testable without a
 * socket in sight.
 *
 * Responsibilities — and the complete list, by design:
 *  - identity: device-token login backed by the AccountStore
 *  - matchmaking via FloorDirectory (rare same-floor encounters, max 4 per
 *    instance), with run validation: fresh runs start where the account's
 *    banked gear resonates, continuing runs only go one floor deeper — and
 *    no faster than the deep's pace (run/rules.ts PACE)
 *  - host designation + migration (epoch bumps on every change)
 *  - clock pongs (one shared timeline for interpolation)
 *  - relaying opaque envelopes by channel-prefix rule:
 *      "a:" only the host may send (to the instance, or one member via `to`)
 *      "h:" anyone → current host only
 *      "p:" anyone → the rest of the instance
 *  - asking the host to world-sync each late joiner
 *  - saves: host-attested item grants (found loot must be something the
 *    floor could drop; what a wizard gave up — a grave, a drop — only up to
 *    what was given up), provenance-checked banking (only once the run has
 *    paid the Tithe of Five), run loss
 *
 * Everything else is client-side gameplay code. Adding a networked feature
 * never changes this file. */

export interface RelayPeer {
  id: string;
  name: string;
  send(msg: ServerMsg): void;
}

export interface RelayOptions {
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

export class Relay {
  private peers = new Map<string, RelayPeer>();
  private epochs = new Map<string, number>();
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
    private directory: FloorDirectory,
    private accounts: AccountStore,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
    options: RelayOptions = {},
  ) {
    this.pace = options.pace === undefined ? PACE : options.pace;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  connect(peer: RelayPeer): void {
    this.peers.set(peer.id, peer);
    peer.send({ t: "welcome", playerId: peer.id });
  }

  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    // runFloor/runGrants stay on the account so a reconnect resumes the run
    // (and lastInstance remembers where, for the same world).
    this.leaveInstance(peer);
    this.directory.forget(peerId);
    this.peers.delete(peerId);
    this.tokens.delete(peerId);
    this.heldEntries.delete(peerId);
  }

  handle(peerId: string, msg: ClientMsg): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (CHANGES_COURSE.has(msg.t)) this.heldEntries.delete(peerId);
    switch (msg.t) {
      case "login": {
        const account = this.accounts.login(
          typeof msg.token === "string" ? msg.token : undefined,
          String(msg.name).slice(0, MAX_NAME),
        );
        peer.name = account.name;
        this.tokens.set(peer.id, account.token);
        peer.send({ t: "loggedIn", token: account.token, save: this.accounts.saveOf(account) });
        break;
      }
      case "ping":
        peer.send({ t: "pong", sent: msg.sent, serverTime: this.now() });
        break;
      case "enterFloor":
        this.requestEntry(
          peer,
          Math.max(1, Math.min(DUNGEON.maxFloor, Math.floor(Number(msg.floor)) || 1)),
          msg.fresh === true,
        );
        break;
      case "leaveDungeon":
        this.leaveInstance(peer);
        break;
      case "bank": {
        const account = this.accountOf(peer);
        const inst = this.directory.instanceOf(peer.id);
        // The way home opens only once the run has paid the Tithe of Five,
        // counted server-side from floors actually entered — and the floor
        // recorded is the one you are ACTUALLY matchmade into.
        if (!inst || !canLeave(account.runFloors)) {
          peer.send({ t: "saved", save: this.accounts.saveOf(account) });
          this.log(`${peer.id} refused bank (${account.runFloors} floor(s) played)`);
          return;
        }
        const save = this.accounts.bank(account, inst.floor, msg.inventory);
        this.lastInstance.delete(account.token);
        peer.send({ t: "saved", save });
        this.log(`${peer.id} walked home from floor ${inst.floor}`);
        break;
      }
      case "escape": {
        // Feather escape: bank from any floor you're actually on, paid for
        // with a provably-owned feather. Checkpoint stays where it was.
        const account = this.accountOf(peer);
        if (!this.directory.instanceOf(peer.id)) return;
        const save = this.accounts.escape(account, msg.inventory);
        if (!save) return; // no feather to spend — nothing banked
        this.lastInstance.delete(account.token);
        peer.send({ t: "saved", save });
        this.log(`${peer.id} escaped by feather`);
        break;
      }
      case "stash": {
        // Village-only rearrangement — no new items can enter this way.
        const account = this.accountOf(peer);
        if (this.directory.instanceOf(peer.id)) return; // not mid-run
        const save = this.accounts.rearrange(account, msg.inventory);
        peer.send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        break;
      }
      case "buy": {
        // Merchant purchase, validated against the shared economy price
        // table and the account's banked gold.
        const account = this.accountOf(peer);
        if (this.directory.instanceOf(peer.id)) return; // village only
        if (typeof msg.itemId !== "string") return;
        const save = this.accounts.rearrange(account, msg.inventory, { buyItemId: msg.itemId });
        peer.send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peer.id} bought ${msg.itemId}`);
        break;
      }
      case "sell": {
        // Merchant sale: the sold copies must be provably owned; the credit
        // comes from the shared economy sell table.
        const account = this.accountOf(peer);
        if (this.directory.instanceOf(peer.id)) return; // village only
        if (typeof msg.itemId !== "string" || typeof msg.qty !== "number") return;
        const save = this.accounts.rearrange(account, msg.inventory, {
          sell: { itemId: msg.itemId, qty: msg.qty },
        });
        peer.send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peer.id} sold ${msg.qty}× ${msg.itemId}`);
        break;
      }
      case "gamble": {
        // Orb of Fortune: the SERVER rolls (shared pure rollGamble) so a
        // client can't fish for outcomes. Refusal answers with the unchanged
        // save so the client's pending state resolves either way.
        const account = this.accountOf(peer);
        if (this.directory.instanceOf(peer.id)) return; // village only
        const rolled = rollGamble(new Rng((Math.random() * 0xffffffff) >>> 0), account.deepest);
        const save = this.accounts.gamble(account, rolled);
        peer.send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peer.id} gambled and drew ${rolled}`);
        break;
      }
      case "died": {
        const account = this.accountOf(peer);
        const inst = this.directory.instanceOf(peer.id);
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
        const inst = this.directory.instanceOf(peer.id);
        if (!inst || typeof msg.itemId !== "string") return;
        if (!this.accounts.release(this.accountOf(peer), msg.itemId, msg.runLoot === true)) {
          this.log(`${peer.id} dropped ${msg.itemId} it doesn't own — nothing given up`);
          return;
        }
        const pool = this.poolOf(inst.id);
        pool.items.set(msg.itemId, (pool.items.get(msg.itemId) ?? 0) + 1);
        break;
      }
      case "grant": {
        // Only the instance host may attest pickups, and only for members of
        // its own instance — loot provenance mirrors loot authority.
        if (this.hostOf(peer.id) !== peer.id) return;
        if (typeof msg.playerId !== "string" || typeof msg.itemId !== "string") return;
        const inst = this.directory.instanceOf(peer.id);
        if (!inst || !inst.players.has(msg.playerId)) return;
        const target = this.peers.get(msg.playerId);
        if (!target) return;
        if (msg.source === "grave" || msg.source === "drop") {
          // Something another wizard gave up here — never more than that.
          const pool = this.floorPools.get(inst.id);
          const left = pool?.items.get(msg.itemId) ?? 0;
          if (!pool || left < 1) {
            this.log(`refused ${msg.source} grant of ${msg.itemId} in ${inst.id} (nobody gave one up)`);
            return;
          }
          pool.items.set(msg.itemId, left - 1);
          this.accounts.grant(this.accountOf(target), msg.itemId);
        } else if (!this.accounts.grantFound(this.accountOf(target), msg.itemId, inst.floor)) {
          // A lone wizard is its own host: what it says it found must be
          // something this floor could have dropped.
          this.log(`refused grant of ${msg.itemId} on floor ${inst.floor} (not this floor's loot)`);
        }
        break;
      }
      case "grantGold": {
        // Gold provenance mirrors item grants: host-only, own instance only.
        if (this.hostOf(peer.id) !== peer.id) return;
        if (typeof msg.playerId !== "string" || typeof msg.amount !== "number") return;
        const inst = this.directory.instanceOf(peer.id);
        if (!inst || !inst.players.has(msg.playerId)) return;
        const target = this.peers.get(msg.playerId);
        if (!target) return;
        if (msg.source === "grave") {
          const pool = this.floorPools.get(inst.id);
          const amount = Math.floor(Math.min(msg.amount, pool?.gold ?? 0));
          if (!pool || !(amount > 0)) return;
          pool.gold -= amount;
          // The pool already bounds it — no per-pickup cap on top.
          this.accounts.grantGold(this.accountOf(target), amount, GOLD_RULES.perRunCap);
        } else {
          this.accounts.grantFoundGold(this.accountOf(target), msg.amount, inst.floor);
        }
        break;
      }
      case "msg":
        this.relay(peer, msg.ch, msg.data, msg.to);
        break;
    }
  }

  /** Account bound to this connection — auto-minted for clients that never
   * logged in, so every code path below has one. */
  private accountOf(peer: RelayPeer): AccountRecord {
    const token = this.tokens.get(peer.id);
    const existing = token ? this.accounts.get(token) : null;
    if (existing) return existing;
    const account = this.accounts.login(undefined, peer.name);
    this.tokens.set(peer.id, account.token);
    return account;
  }

  // ── Instances ──────────────────────────────────────────────────────────────

  /** A floor request, kept to the deep's pace: re-entering the floor you're
   * on (a reconnect) goes straight through; a new floor spends a pace token,
   * and one asked for before a token is due is HELD — answered when it is,
   * unless something newer from this wizard (or a disconnect) drops it. The
   * client just hovers a little longer in the rift. */
  private requestEntry(peer: RelayPeer, requested: number, fresh: boolean): void {
    const account = this.accountOf(peer);
    const resume = !fresh && account.runFloor > 0 && requested === account.runFloor;
    if (this.pace && !resume) {
      const state = this.paces.get(account.token);
      const wait = paceWaitMs(state, this.now(), this.pace);
      if (wait > 0) {
        const ticket = this.nextTicket++;
        this.heldEntries.set(peer.id, ticket);
        this.log(`${peer.id} is ahead of the deep's pace — floor request held ${wait} ms`);
        this.schedule(() => {
          if (this.heldEntries.get(peer.id) !== ticket || !this.peers.has(peer.id)) return;
          this.heldEntries.delete(peer.id);
          this.requestEntry(peer, requested, fresh);
        }, wait);
        return;
      }
      this.paces.set(account.token, spendPace(state, this.now(), this.pace));
    }
    this.enterFloor(peer, requested, fresh);
  }

  private enterFloor(peer: RelayPeer, requested: number, fresh: boolean): void {
    const account = this.accountOf(peer);
    // Run-validated entry — no floor-skipping by message forgery:
    //  - continuing a run: the same floor (reconnect → back into the same
    //    instance) or exactly one deeper (portal, warp rune);
    //  - anything else starts a FRESH run, which forfeits an unfinished one
    //    and always lands where the banked gear resonates (the Weighing).
    const inRun = account.runFloor > 0;
    const opts: JoinOptions = {};
    let floor: number;
    if (!fresh && inRun && requested === account.runFloor) {
      floor = requested;
      opts.preferInstanceId = this.lastInstance.get(account.token);
    } else if (!fresh && inRun && requested === account.runFloor + 1) {
      floor = requested;
      this.accounts.advanceRun(account, floor);
    } else {
      const eq = account.inventory.equipment;
      floor = entryFloorForGear([eq.staff, eq.amulet, eq.cloak, eq.boots]);
      if (requested !== floor) {
        this.log(`${peer.id} asked for floor ${requested}; the Weighing says ${floor}`);
      }
      this.accounts.startRun(account, floor);
    }
    this.leaveInstance(peer);
    const inst = this.directory.join(peer.id, floor, opts);
    this.lastInstance.set(account.token, inst.id);
    if (!this.epochs.has(inst.id)) this.epochs.set(inst.id, 1);
    const hostId = this.hostOf(peer.id);
    const members: MemberInfo[] = [...inst.players].map((id) => ({
      id,
      name: this.peers.get(id)?.name ?? "Wizard",
    }));
    peer.send({
      t: "floorAssigned",
      assignment: {
        instanceId: inst.id,
        floor: inst.floor,
        seed: inst.seed,
        hostId,
        epoch: this.epochs.get(inst.id)!,
        members,
        runFloors: account.runFloors,
      },
    });
    const member: MemberInfo = { id: peer.id, name: peer.name };
    for (const m of this.mates(peer.id)) m.send({ t: "peerJoined", member });
    // Late join: the host brings this player up to date (dead entities, live
    // snapshots, loot) so they don't land on a pristine "ghost" floor.
    const host = this.peers.get(hostId);
    if (host && host.id !== peer.id) {
      host.send({ t: "syncRequest", playerId: peer.id });
    }
    this.log(`${peer.id} -> floor ${floor} (${inst.id}, ${inst.players.size} player(s))`);
  }

  private leaveInstance(peer: RelayPeer): void {
    const inst = this.directory.instanceOf(peer.id);
    if (!inst) return;
    const wasHost = this.hostOf(peer.id) === peer.id;
    const remaining = this.mates(peer.id);
    for (const m of remaining) m.send({ t: "peerLeft", playerId: peer.id });
    this.directory.leave(peer.id);
    this.pruneGone();
    if (!this.directory.instanceById(inst.id)) return; // garbage-collected
    // Host migration: promote the next-oldest member, bump the epoch.
    if (wasHost && remaining.length > 0) {
      const hostId = this.hostOf(remaining[0].id);
      const epoch = (this.epochs.get(inst.id) ?? 1) + 1;
      this.epochs.set(inst.id, epoch);
      for (const m of remaining) m.send({ t: "hostChanged", hostId, epoch });
      this.log(`host of ${inst.id} -> ${hostId} (epoch ${epoch})`);
    }
  }

  // ── Envelope routing ───────────────────────────────────────────────────────

  private relay(sender: RelayPeer, ch: string, data: unknown, to?: string): void {
    if (typeof ch !== "string") return;
    const inst = this.directory.instanceOf(sender.id);
    if (!inst) return;
    const prefix = ch.slice(0, 2);
    const hostId = this.hostOf(sender.id);
    const epoch = this.epochs.get(inst.id) ?? 1;
    const relayed: ServerMsg = {
      t: "msg",
      ch,
      from: sender.id,
      epoch,
      serverTime: this.now(),
      data,
    };

    switch (prefix) {
      case CHANNEL_AUTHORITY: {
        if (sender.id !== hostId) return; // only the host may publish authority
        if (to !== undefined) {
          const target = this.peers.get(to);
          // Deliver only if the target is still in the same instance.
          if (target && this.directory.instanceOf(to)?.id === inst.id) {
            target.send(relayed);
          }
          return;
        }
        for (const m of this.mates(sender.id)) m.send(relayed);
        return;
      }
      case CHANNEL_TO_HOST: {
        if (sender.id === hostId) return; // host handles its own locally
        this.peers.get(hostId)?.send(relayed);
        return;
      }
      case CHANNEL_PEER: {
        for (const m of this.mates(sender.id)) m.send(relayed);
        return;
      }
      default:
        return; // unknown prefix — drop
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private poolOf(instanceId: string): { items: Map<string, number>; gold: number } {
    let pool = this.floorPools.get(instanceId);
    if (!pool) {
      pool = { items: new Map(), gold: 0 };
      this.floorPools.set(instanceId, pool);
    }
    return pool;
  }

  /** Drop per-instance bookkeeping for instances the directory has let go
   * (empty ones linger briefly for reconnects, then vanish). */
  private pruneGone(): void {
    for (const id of this.epochs.keys()) if (!this.directory.instanceById(id)) this.epochs.delete(id);
    for (const id of this.floorPools.keys()) {
      if (!this.directory.instanceById(id)) this.floorPools.delete(id);
    }
  }

  /** Simulation host = first (oldest) member of the instance's player set. */
  private hostOf(playerId: string): string {
    const inst = this.directory.instanceOf(playerId);
    if (!inst) return "";
    return inst.players.values().next().value ?? "";
  }

  /** Everyone sharing the peer's instance, excluding itself. */
  private mates(peerId: string): RelayPeer[] {
    const inst = this.directory.instanceOf(peerId);
    if (!inst) return [];
    const result: RelayPeer[] = [];
    for (const id of inst.players) {
      if (id === peerId) continue;
      const p = this.peers.get(id);
      if (p) result.push(p);
    }
    return result;
  }
}
