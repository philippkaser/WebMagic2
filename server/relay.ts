import { ARENA, boutOver, newScoreboard, ranked, recordFall, winnerOf, type Scoreboard } from "../src/arena/rules";
import { DUNGEON } from "../src/core/config";
import { Rng } from "../src/core/rng";
import { MAX_GRANT_QTY } from "../src/items/economy";
import { rollGamble } from "../src/items/loot";
import { ArenaQueue } from "../src/net/arenaQueue";
import { FloorDirectory, type FloorInstanceRecord, type JoinOptions } from "../src/net/matchmaking";
import { isPartyCode, normalizePartyCode, PartyDirectory, type Party, type PartyError } from "../src/net/party";
import {
  CHANNEL_AUTHORITY,
  CHANNEL_PEER,
  CHANNEL_TO_HOST,
  isWireSlot,
  type ClientMsg,
  type MemberInfo,
  type PartyInfo,
  type ServerMsg,
} from "../src/net/protocol";
import { canLeave, entryFloorForGear } from "../src/run/rules";
import type { AccountRecord, AccountStore } from "./accounts";
import { AccountAuth, argon2Hasher, type AuthDeps } from "./auth";

/** The gameplay-blind relay core. Pure logic (I/O injected via `send`), so
 * the host-migration/authority/routing rules are unit-testable without a
 * socket in sight.
 *
 * Responsibilities — and the complete list, by design:
 *  - identity: device-token login backed by the AccountStore, plus the
 *    ledger's password accounts and sign-in sessions (auth.ts decides,
 *    the relay binds the connection to the answer)
 *  - matchmaking via FloorDirectory (rare same-floor encounters, max 4 per
 *    instance), with run validation: fresh runs start where the account's
 *    banked gear resonates, continuing runs only go one floor deeper
 *  - the camp: wizards who are home share a camp room (a second directory
 *    where everyone meets), routed exactly like a floor
 *  - fellowships (net/party.ts): codes, invites, and keeping a party in one
 *    instance; room and party chat, trimmed and rate-limited
 *  - the Proving Ground (arena/): the obelisk's queue, each bout's room,
 *    clock and scoreboard, and each wizard's record with Varr — `tick()`
 *    starts and ends bouts on the server's clock
 *  - host designation + migration (epoch bumps on every change)
 *  - clock pongs (one shared timeline for interpolation)
 *  - relaying opaque envelopes by channel-prefix rule:
 *      "a:" only the host may send (to the instance, or one member via `to`)
 *      "h:" anyone → current host only
 *      "p:" anyone → the rest of the instance
 *  - asking the host to world-sync each late joiner
 *  - saves: host-attested item grants, provenance-checked banking (only once
 *    the run has paid the Tithe of Five), run loss
 *
 * Everything about the floor's world is client-side gameplay code: a new
 * networked feature on the floor never changes this file. The bank (and the
 * pure economy rules it runs on banked inventories) and the social rooms
 * live here. */

export interface RelayPeer {
  id: string;
  name: string;
  send(msg: ServerMsg): void;
}

const MAX_NAME = 24;
/** How many wizards share one camp. */
export const CAMP_SIZE = 12;
/** Chat: at most this long, and at most CHAT_BURST lines per CHAT_WINDOW_MS. */
export const CHAT_MAX = 140;
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 10_000;

/** Make a chat line safe to show: no control characters, no runs of
 * whitespace, at most CHAT_MAX characters. Empty → null. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, CHAT_MAX) : null;
}

/** How long after a bout's farewell a wizard still in its hall keeps the
 * seat (ms) — their client walks them home long before. */
const BOUT_STRAGGLE_MS = 60_000;

/** A bout under way (or just over) in the Proving Ground. */
interface Bout {
  board: Scoreboard;
  startedAt: number;
  /** When it ended (null: still fighting). */
  endedAt: number | null;
  /** When each wizard last fell (one fall per rising). */
  lastFall: Map<string, number>;
}

export class Relay {
  private peers = new Map<string, RelayPeer>();
  private epochs = new Map<string, number>();
  /** peerId → account token (bound at login / first floor entry). */
  private tokens = new Map<string, string>();
  /** account token → the instance its wizard was last seated in, so a
   * dropped connection resumes in the same world (not a fresh roll). Only
   * held while the account has a run open. */
  private lastInstance = new Map<string, string>();
  /** instance id → what wizards who died there were granted this run (the
   * upper bound on anything plundered from their graves). */
  private gravePools = new Map<string, { items: Map<string, number>; gold: number }>();

  /** Password accounts, sign-in sessions and their rate limits. */
  private auth: AccountAuth;
  /** The camp's rooms: everyone who's home meets (no encounter dice). */
  private camp: FloorDirectory;
  private parties: PartyDirectory;
  /** peerId → when their recent chat lines were sent (rate limit). */
  private chatTimes = new Map<string, number[]>();
  /** The Proving Ground: who waits at the obelisk, the bouts' rooms, and
   * each bout's score and sands (by room id). */
  private arenaQueue = new ArenaQueue();
  private arenas: FloorDirectory;
  private bouts = new Map<string, Bout>();

  constructor(
    private directory: FloorDirectory,
    private accounts: AccountStore,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
    /** Tests inject a fake hasher (argon2 is deliberately slow). */
    auth: Partial<AuthDeps> = {},
  ) {
    this.auth = new AccountAuth(accounts, { hasher: argon2Hasher, now, log, ...auth });
    this.camp = new FloorDirectory(
      CAMP_SIZE,
      () => 0,
      now,
      () => 0,
      { baseChance: 1, perSoloFloor: 0, maxChance: 1 },
      undefined,
      "camp",
    );
    this.parties = new PartyDirectory(Math.random, now);
    // A bout's room is made whole (never by chance meetings), and goes when
    // its last wizard does.
    this.arenas = new FloorDirectory(
      ARENA.maxPlayers,
      () => (Math.random() * 0xffffffff) >>> 0,
      now,
      () => 1,
      { baseChance: 0, perSoloFloor: 0, maxChance: 0 },
      0,
      "arena",
    );
  }

  /** The server's heartbeat (a few times a second): bouts start when the
   * obelisk has gathered enough challengers, and end on the score or the
   * sands. */
  tick(): void {
    const now = this.now();
    for (let ids = this.arenaQueue.take(now); ids; ids = this.arenaQueue.take(now)) this.startBout(ids);
    for (const [id, bout] of this.bouts) {
      const room = this.arenas.instanceById(id);
      if (!room) this.bouts.delete(id);
      else if (bout.endedAt === null && boutOver(bout.board, bout.startedAt, now)) this.endBout(id, bout);
      else if (bout.endedAt !== null && now - bout.endedAt > ARENA.afterMs + BOUT_STRAGGLE_MS) {
        // Everyone walks home on their own; a straggler's seat is let go.
        for (const pid of [...room.players]) {
          const p = this.peers.get(pid);
          if (p) this.leaveRoom(p, this.arenas);
          else this.arenas.leave(pid);
        }
        this.bouts.delete(id);
      }
    }
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
    // The camp as much as a floor: campmates see them go (or they'd keep a
    // frozen ghost by the fire), and a host who's gone hands it on.
    this.leaveCamp(peer);
    this.leaveArena(peer);
    this.directory.forget(peerId);
    this.camp.forget(peerId);
    this.arenas.forget(peerId);
    const party = this.parties.forget(peerId);
    if (party) this.tellParty(party);
    this.chatTimes.delete(peerId);
    this.arenaQueue.leave(peerId);
    this.tellQueue();
    this.peers.delete(peerId);
    this.tokens.delete(peerId);
    this.auth.forget(peerId);
  }

  handle(peerId: string, msg: ClientMsg): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    switch (msg.t) {
      case "login": {
        const resumed = this.auth.resume(
          peer.id,
          typeof msg.token === "string" ? msg.token : undefined,
          String(msg.name).slice(0, MAX_NAME),
        );
        if (!resumed) {
          peer.send({ t: "authError", reason: "session-expired" });
          break;
        }
        const { account, token } = resumed;
        peer.name = account.name;
        this.tokens.set(peer.id, account.token);
        peer.send({ t: "loggedIn", token, save: this.accounts.saveOf(account), username: account.username });
        break;
      }
      case "register":
      case "loginPassword":
      case "claim":
        void this.signIn(peer, msg);
        break;
      case "logout": {
        if (this.directory.instanceOf(peer.id)) {
          peer.send({ t: "authError", reason: "in-dungeon" });
          break;
        }
        this.auth.logout(peer.id, this.boundAccount(peer), msg.everywhere === true);
        this.tokens.delete(peer.id);
        peer.name = "Wizard";
        peer.send({ t: "loggedOut" });
        break;
      }
      case "ping":
        peer.send({ t: "pong", sent: msg.sent, serverTime: this.now() });
        break;
      case "enterFloor":
        this.enterFloor(
          peer,
          Math.max(1, Math.min(DUNGEON.maxFloor, Math.floor(Number(msg.floor)) || 1)),
          msg.fresh === true,
        );
        break;
      case "enterCamp":
        this.enterCamp(peer);
        break;
      case "chat":
        this.chat(peer, msg.text, msg.party === true);
        break;
      case "arenaJoin":
        // From home only: a wizard mid-run (or mid-bout) can't queue.
        if (this.directory.instanceOf(peer.id) || this.arenas.instanceOf(peer.id)) break;
        this.arenaQueue.join(peer.id, this.now());
        this.tellQueue();
        break;
      case "arenaLeave":
        // Out of the line. One who wasn't in it hears so anyway: a client
        // can think it's waiting after the relay let it go, and needs its
        // place-in-line button back.
        if (this.arenaQueue.has(peer.id)) this.leaveQueue(peer.id);
        else peer.send({ t: "arenaQueue", position: 0, waiting: this.arenaQueue.size });
        // And out of a bout just dealt that the client couldn't take: it was
        // already on the road down (arena/arenaFlow.ts turns it down).
        this.leaveArena(peer);
        break;
      case "arenaFell":
        this.arenaFell(peer, msg.by);
        break;
      case "partyCreate":
        this.tellParty(this.parties.create(peer.id));
        break;
      case "partyJoin": {
        const code = typeof msg.code === "string" ? normalizePartyCode(msg.code) : "";
        const before = this.parties.partyOf(peer.id);
        const out = isPartyCode(code) ? this.parties.join(peer.id, code) : "no-such-party";
        if (typeof out === "string") peer.send({ t: "partyError", reason: out });
        else {
          if (before && before.id !== out.id) this.tellParty(before, peer.id);
          this.tellParty(out);
        }
        break;
      }
      case "partyLeave": {
        const left = this.parties.leave(peer.id);
        peer.send({ t: "party", party: null });
        if (left) this.tellParty(left);
        break;
      }
      case "partyInvite": {
        const to = typeof msg.to === "string" ? this.peers.get(msg.to) : undefined;
        // Only someone who shares your room: you can see who you're asking.
        const room = this.roomOf(peer.id);
        if (!to || !room || this.roomOf(to.id)?.id !== room.id) {
          peer.send({ t: "partyError", reason: "no-invite" });
          break;
        }
        const out = this.parties.invite(peer.id, to.id);
        if (typeof out === "string") peer.send({ t: "partyError", reason: out });
        else to.send({ t: "partyInvited", from: peer.id, name: peer.name });
        break;
      }
      case "partyAccept": {
        const before = this.parties.partyOf(peer.id);
        const out = this.parties.accept(peer.id);
        if (typeof out === "string") peer.send({ t: "partyError", reason: out });
        else {
          if (before && before.id !== out.id) this.tellParty(before, peer.id);
          this.tellParty(out);
        }
        break;
      }
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
      case "craft": {
        // Cauldron and forge: the server's dice, the shared pure recipe,
        // the banked inventory. Never mid-run.
        const account = this.accountOf(peer);
        if (this.directory.instanceOf(peer.id)) return;
        if (typeof msg.recipe !== "string") return;
        const target = isWireSlot(msg.target) ? msg.target : undefined;
        const expect = typeof msg.expect === "string" ? msg.expect.slice(0, 200) : undefined;
        const recipe = msg.recipe.slice(0, 64);
        const out = this.accounts.craft(account, { recipe, target, expect }, new Rng((Math.random() * 0xffffffff) >>> 0));
        const save = this.accounts.saveOf(account);
        if (out.ok) {
          peer.send({ t: "crafted", recipe, save, ok: true, produced: out.produced, changed: out.changed });
          this.log(`${peer.id} crafted ${recipe}`);
        } else {
          peer.send({ t: "crafted", recipe, save, ok: false, reason: out.reason });
        }
        break;
      }
      case "died": {
        const account = this.accountOf(peer);
        const inst = this.directory.instanceOf(peer.id);
        // Died where others stood witness: what this run was granted may
        // lie in a grave now, so it becomes plunderable — and nothing else.
        if (inst && inst.players.size > 1) {
          const pool = this.gravePools.get(inst.id) ?? { items: new Map(), gold: 0 };
          for (const id of account.runGrants) pool.items.set(id, (pool.items.get(id) ?? 0) + 1);
          pool.gold += account.runGold;
          this.gravePools.set(inst.id, pool);
        }
        this.accounts.endRun(account);
        this.lastInstance.delete(account.token);
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
        let qty = typeof msg.qty === "number" && Number.isFinite(msg.qty) ? Math.max(1, Math.min(MAX_GRANT_QTY, Math.floor(msg.qty))) : 1;
        if (msg.source === "grave") {
          const pool = this.gravePools.get(inst.id);
          const left = pool?.items.get(msg.itemId) ?? 0;
          if (!pool || left < 1) {
            this.log(`refused grave grant of ${msg.itemId} in ${inst.id} (not in any grave)`);
            return;
          }
          qty = Math.min(qty, left);
          // Debit what was actually credited, not what was asked for.
          const got = this.accounts.grant(this.accountOf(target), msg.itemId, qty);
          pool.items.set(msg.itemId, left - got);
          break;
        }
        this.accounts.grant(this.accountOf(target), msg.itemId, qty);
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
        let amount = msg.amount;
        if (msg.source === "grave") {
          const pool = this.gravePools.get(inst.id);
          amount = Math.min(amount, pool?.gold ?? 0);
          if (!pool || amount <= 0) return;
          pool.gold -= amount;
        }
        this.accounts.grantGold(this.accountOf(target), amount);
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

  // ── The ledger ─────────────────────────────────────────────────────────────

  /** The account this connection is bound to, if any (never mints). */
  private boundAccount(peer: RelayPeer): AccountRecord | null {
    const token = this.tokens.get(peer.id);
    return token ? this.accounts.get(token) : null;
  }

  /** Register / sign in / claim: auth.ts hashes and decides; the relay binds
   * the connection to the answer. Out of the dungeon only — a wizard can't
   * change hands mid-floor. */
  private async signIn(
    peer: RelayPeer,
    msg: Extract<ClientMsg, { t: "register" | "loginPassword" | "claim" }>,
  ): Promise<void> {
    if (this.directory.instanceOf(peer.id)) {
      peer.send({ t: "authError", reason: "in-dungeon" });
      return;
    }
    const outcome =
      msg.t === "register"
        ? await this.auth.register(peer.id, msg.username, msg.password, String(msg.name ?? peer.name).slice(0, MAX_NAME))
        : msg.t === "claim"
          ? await this.auth.claim(peer.id, this.boundAccount(peer), msg.username, msg.password)
          : await this.auth.login(peer.id, msg.username, msg.password);
    const here = this.peers.get(peer.id) === peer;
    if (outcome.ok && (!here || this.directory.instanceOf(peer.id))) {
      this.auth.revoke(outcome.token); // never reached its wizard
      if (here) peer.send({ t: "authError", reason: "in-dungeon" });
      return;
    }
    if (!here) return;
    if (!outcome.ok) {
      const { reason, retryAfterMs } = outcome;
      peer.send(retryAfterMs === undefined ? { t: "authError", reason } : { t: "authError", reason, retryAfterMs });
      return;
    }
    const { account, token } = outcome;
    peer.name = account.name;
    this.tokens.set(peer.id, account.token);
    peer.send({
      t: "authOk",
      token,
      username: account.username ?? "",
      name: account.name,
      save: this.accounts.saveOf(account),
    });
    this.log(`${peer.id} ${msg.t === "register" ? "registered" : msg.t === "claim" ? "claimed" : "signed in"} as ${account.username}`);
  }

  // ── Instances ──────────────────────────────────────────────────────────────

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
      // A fellowship already below, no deeper than the Weighing allows:
      // start where they are, so you go down together.
      const below = this.companionFloors(peer.id).filter((f) => f <= floor);
      if (below.length > 0) floor = Math.max(...below);
      if (requested !== floor) {
        this.log(`${peer.id} asked for floor ${requested}; the Weighing says ${floor}`);
      }
      this.accounts.startRun(account, floor);
    }
    this.leaveInstance(peer);
    this.leaveCamp(peer);
    this.leaveArena(peer);
    this.leaveQueue(peer.id);
    opts.companions = this.parties.companionsOf(peer.id);
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
    this.leaveRoom(peer, this.directory);
  }

  private leaveCamp(peer: RelayPeer): void {
    this.leaveRoom(peer, this.camp);
  }

  /** Seat a wizard who's home in the camp (their fellowship's camp first). */
  private enterCamp(peer: RelayPeer): void {
    if (this.directory.instanceOf(peer.id)) return; // mid-run: not home yet
    this.leaveCamp(peer);
    this.leaveArena(peer); // home from the Proving Ground
    const inst = this.camp.join(peer.id, 0, { companions: this.parties.companionsOf(peer.id) });
    if (!this.epochs.has(inst.id)) this.epochs.set(inst.id, 1);
    peer.send({
      t: "campAssigned",
      assignment: {
        instanceId: inst.id,
        hostId: this.hostOf(peer.id),
        epoch: this.epochs.get(inst.id)!,
        members: this.membersOf(inst),
      },
    });
    const member: MemberInfo = { id: peer.id, name: peer.name };
    for (const m of this.mates(peer.id)) m.send({ t: "peerJoined", member });
    // Your fellowship learns you're home (and you learn of it).
    const party = this.parties.partyOf(peer.id);
    if (party) this.tellParty(party);
  }

  private leaveRoom(peer: RelayPeer, dir: FloorDirectory): void {
    const inst = dir.instanceOf(peer.id);
    if (!inst) return;
    const wasHost = this.hostOf(peer.id) === peer.id;
    const remaining = this.mates(peer.id);
    for (const m of remaining) m.send({ t: "peerLeft", playerId: peer.id });
    dir.leave(peer.id);
    this.pruneGone();
    if (!dir.instanceById(inst.id)) return; // garbage-collected
    // Host migration: promote the next-oldest member, bump the epoch.
    if (wasHost && remaining.length > 0) {
      const hostId = this.hostOf(remaining[0].id);
      const epoch = (this.epochs.get(inst.id) ?? 1) + 1;
      this.epochs.set(inst.id, epoch);
      for (const m of remaining) m.send({ t: "hostChanged", hostId, epoch });
      this.log(`host of ${inst.id} -> ${hostId} (epoch ${epoch})`);
    }
  }

  // ── The Proving Ground ─────────────────────────────────────────────────────

  private leaveQueue(peerId: string): void {
    if (!this.arenaQueue.has(peerId)) return;
    this.arenaQueue.leave(peerId);
    this.peers.get(peerId)?.send({ t: "arenaQueue", position: 0, waiting: this.arenaQueue.size });
    this.tellQueue();
  }

  /** Everyone at the obelisk learns their place in line. */
  private tellQueue(): void {
    for (const p of this.peers.values()) {
      const position = this.arenaQueue.position(p.id);
      if (position > 0) p.send({ t: "arenaQueue", position, waiting: this.arenaQueue.size });
    }
  }

  private startBout(ids: string[]): void {
    // Whoever's still home (and still here) goes in; the rest wait again.
    const fighters = ids
      .map((id) => this.peers.get(id))
      .filter((p): p is RelayPeer => !!p && !this.directory.instanceOf(p.id) && !this.arenas.instanceOf(p.id));
    if (fighters.length < ARENA.minPlayers) {
      for (const p of fighters) this.arenaQueue.join(p.id, this.now());
      return;
    }
    const now = this.now();
    let inst: FloorInstanceRecord | null = null;
    for (const p of fighters) {
      this.leaveCamp(p);
      inst = this.arenas.join(p.id, 0, inst ? { companions: [fighters[0]!.id] } : {});
    }
    const room = inst!;
    this.epochs.set(room.id, 1);
    this.bouts.set(room.id, { board: newScoreboard(fighters), startedAt: now, endedAt: null, lastFall: new Map() });
    const members = this.membersOf(room);
    for (const p of fighters) {
      p.send({
        t: "arenaAssigned",
        assignment: {
          instanceId: room.id,
          seed: room.seed,
          hostId: this.hostOf(p.id),
          epoch: 1,
          members,
          endsAt: now + ARENA.durationMs,
          killsToWin: ARENA.killsToWin,
        },
      });
    }
    this.tellQueue();
    this.log(`bout ${room.id}: ${fighters.map((p) => p.name).join(" vs ")}`);
  }

  /** Only the fallen say they fell (they know who struck last), once per
   * rising; the yield goes to a wizard who's really in the bout. */
  private arenaFell(peer: RelayPeer, by: unknown): void {
    const room = this.arenas.instanceOf(peer.id);
    const bout = room && this.bouts.get(room.id);
    if (!room || !bout || bout.endedAt !== null) return;
    const now = this.now();
    if (now - (bout.lastFall.get(peer.id) ?? -Infinity) < ARENA.respawnMs) return;
    bout.lastFall.set(peer.id, now);
    const killer = typeof by === "string" && by !== peer.id && room.players.has(by) ? by : null;
    bout.board = recordFall(bout.board, peer.id, killer, now);
    for (const id of room.players) {
      this.peers.get(id)?.send({ t: "arenaScore", board: bout.board, fell: { victim: peer.id, by: killer } });
    }
    if (boutOver(bout.board, bout.startedAt, now)) this.endBout(room.id, bout);
  }

  private endBout(roomId: string, bout: Bout): void {
    const room = this.arenas.instanceById(roomId);
    if (!room || bout.endedAt !== null) return;
    bout.endedAt = this.now();
    const winner = winnerOf(bout.board, room.players);
    const board = ranked(bout.board);
    for (const id of room.players) {
      const peer = this.peers.get(id);
      if (!peer) continue;
      const yields = bout.board.find((s) => s.id === id)?.kills ?? 0;
      const record = this.accounts.recordBout(this.accountOf(peer), id === winner, yields);
      peer.send({ t: "arenaEnded", board, winner, record });
    }
    this.log(`bout ${roomId} over: ${winner ? this.peers.get(winner)?.name : "nobody"} wins`);
  }

  /** Out of a bout (home, into the dungeon, turned down, or gone). A bout
   * left with one wizard ends: the hall is theirs if they took a yield. */
  private leaveArena(peer: RelayPeer): void {
    const room = this.arenas.instanceOf(peer.id);
    if (!room) return;
    const bout = this.bouts.get(room.id);
    this.leaveRoom(peer, this.arenas);
    if (bout && bout.endedAt === null && room.players.size < ARENA.minPlayers && room.players.size > 0) {
      this.endBout(room.id, bout);
    }
    if (!this.arenas.instanceById(room.id)) this.bouts.delete(room.id);
  }

  // ── Envelope routing ───────────────────────────────────────────────────────

  private relay(sender: RelayPeer, ch: string, data: unknown, to?: string): void {
    if (typeof ch !== "string") return;
    const inst = this.roomOf(sender.id);
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
          if (target && this.roomOf(to)?.id === inst.id) {
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

  /** Drop per-instance bookkeeping for instances the directory has let go
   * (empty ones linger briefly for reconnects, then vanish). */
  private pruneGone(): void {
    for (const id of this.epochs.keys()) if (!this.roomById(id)) this.epochs.delete(id);
    for (const id of this.gravePools.keys()) {
      if (!this.directory.instanceById(id)) this.gravePools.delete(id);
    }
  }

  /** The room a wizard is in: a floor instance, a camp, or a bout. */
  private roomOf(playerId: string): FloorInstanceRecord | null {
    return this.directory.instanceOf(playerId) ?? this.camp.instanceOf(playerId) ?? this.arenas.instanceOf(playerId);
  }

  private roomById(id: string): FloorInstanceRecord | null {
    return this.directory.instanceById(id) ?? this.camp.instanceById(id) ?? this.arenas.instanceById(id);
  }

  private membersOf(inst: FloorInstanceRecord): MemberInfo[] {
    return [...inst.players].map((id) => ({ id, name: this.peers.get(id)?.name ?? "Wizard" }));
  }

  /** Floors a wizard's fellowship is on right now (mid-run members). */
  private companionFloors(peerId: string): number[] {
    const out: number[] = [];
    for (const mate of this.parties.companionsOf(peerId)) {
      const inst = this.directory.instanceOf(mate);
      if (inst) out.push(inst.floor);
    }
    return out;
  }

  /** Tell every member how their fellowship stands now (and, when someone
   * just left it, tell them too). */
  private tellParty(party: Party, leaver?: string): void {
    const info: PartyInfo = {
      code: party.code,
      leader: party.leader,
      members: party.members.map((id) => ({ id, name: this.peers.get(id)?.name ?? "Wizard" })),
    };
    for (const id of party.members) this.peers.get(id)?.send({ t: "party", party: info });
    if (leaver) this.peers.get(leaver)?.send({ t: "party", party: null });
  }

  private chat(peer: RelayPeer, raw: unknown, toParty: boolean): void {
    const text = cleanChat(raw);
    if (!text) return;
    const now = this.now();
    const recent = (this.chatTimes.get(peer.id) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return; // speaking too fast: dropped
    recent.push(now);
    this.chatTimes.set(peer.id, recent);
    const line: ServerMsg = { t: "chat", from: peer.id, name: peer.name, text, party: toParty };
    if (toParty) {
      const party = this.parties.partyOf(peer.id);
      if (!party) return void peer.send({ t: "partyError", reason: "not-in-a-party" satisfies PartyError });
      for (const id of party.members) this.peers.get(id)?.send(line);
      return;
    }
    peer.send(line);
    for (const m of this.mates(peer.id)) m.send(line);
  }

  /** Simulation host = first (oldest) member of the instance's player set. */
  private hostOf(playerId: string): string {
    const inst = this.roomOf(playerId);
    if (!inst) return "";
    return inst.players.values().next().value ?? "";
  }

  /** Everyone sharing the peer's instance, excluding itself. */
  private mates(peerId: string): RelayPeer[] {
    const inst = this.roomOf(peerId);
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
