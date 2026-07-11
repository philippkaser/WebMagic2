import { DUNGEON } from "../src/core/config";
import { Rng } from "../src/core/rng";
import { rollGamble } from "../src/items/loot";
import { FloorDirectory } from "../src/net/matchmaking";
import {
  CHANNEL_AUTHORITY,
  CHANNEL_PEER,
  CHANNEL_TO_HOST,
  type ClientMsg,
  type MemberInfo,
  type ServerMsg,
} from "../src/net/protocol";
import type { AccountRecord, AccountStore } from "./accounts";

/** The gameplay-blind relay core. Pure logic (I/O injected via `send`), so
 * the host-migration/authority/routing rules are unit-testable without a
 * socket in sight.
 *
 * Responsibilities — and the complete list, by design:
 *  - identity: device-token login backed by the AccountStore
 *  - matchmaking via FloorDirectory (max 4 wizards per floor instance),
 *    with floor-entry validation against the account's actual progress
 *  - host designation + migration (epoch bumps on every change)
 *  - clock pongs (one shared timeline for interpolation)
 *  - relaying opaque envelopes by channel-prefix rule:
 *      "a:" only the host may send (to the instance, or one member via `to`)
 *      "h:" anyone → current host only
 *      "p:" anyone → the rest of the instance
 *  - asking the host to world-sync each late joiner
 *  - saves: host-attested item grants, provenance-checked banking, run loss
 *
 * Everything else is client-side gameplay code. Adding a networked feature
 * never changes this file. */

export interface RelayPeer {
  id: string;
  name: string;
  send(msg: ServerMsg): void;
}

const MAX_NAME = 24;

export class Relay {
  private peers = new Map<string, RelayPeer>();
  private epochs = new Map<string, number>();
  /** peerId → account token (bound at login / first floor entry). */
  private tokens = new Map<string, string>();

  constructor(
    private directory: FloorDirectory,
    private accounts: AccountStore,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
  ) {}

  connect(peer: RelayPeer): void {
    this.peers.set(peer.id, peer);
    peer.send({ t: "welcome", playerId: peer.id });
  }

  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    // runFloor/runGrants stay on the account so a reconnect resumes the run.
    this.leaveInstance(peer);
    this.peers.delete(peerId);
    this.tokens.delete(peerId);
  }

  handle(peerId: string, msg: ClientMsg): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
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
        this.enterFloor(peer, Math.max(1, Math.min(DUNGEON.maxFloor, Math.floor(msg.floor))));
        break;
      case "leaveDungeon":
        this.leaveInstance(peer);
        break;
      case "bank": {
        const account = this.accountOf(peer);
        const inst = this.directory.instanceOf(peer.id);
        // Banking only counts where the portal exists: a checkpoint floor
        // you are ACTUALLY matchmade into — the floor claim can't be faked.
        if (!inst || inst.floor % DUNGEON.checkpointInterval !== 0) return;
        const save = this.accounts.bank(account, inst.floor, msg.inventory);
        peer.send({ t: "saved", save });
        this.log(`${peer.id} banked at floor ${inst.floor}`);
        break;
      }
      case "escape": {
        // Feather escape: bank from any floor you're actually on, paid for
        // with a provably-owned feather. Checkpoint stays where it was.
        const account = this.accountOf(peer);
        if (!this.directory.instanceOf(peer.id)) return;
        const save = this.accounts.escape(account, msg.inventory);
        if (!save) return; // no feather to spend — nothing banked
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
        const rolled = rollGamble(new Rng((Math.random() * 0xffffffff) >>> 0), account.checkpoint);
        const save = this.accounts.gamble(account, rolled);
        peer.send({ t: "saved", save: save ?? this.accounts.saveOf(account) });
        if (save) this.log(`${peer.id} gambled and drew ${rolled}`);
        break;
      }
      case "died":
        this.accounts.endRun(this.accountOf(peer));
        break;
      case "grant": {
        // Only the instance host may attest pickups, and only for members of
        // its own instance — loot provenance mirrors loot authority.
        if (this.hostOf(peer.id) !== peer.id) return;
        if (typeof msg.playerId !== "string" || typeof msg.itemId !== "string") return;
        const inst = this.directory.instanceOf(peer.id);
        if (!inst || !inst.players.has(msg.playerId)) return;
        const target = this.peers.get(msg.playerId);
        if (!target) return;
        this.accounts.grant(this.accountOf(target), msg.itemId);
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
        this.accounts.grantGold(this.accountOf(target), msg.amount);
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

  private enterFloor(peer: RelayPeer, floor: number): void {
    const account = this.accountOf(peer);
    // Progress-validated entry: floor 1, anything you've banked past, one
    // step deeper than the floor you're on (descending), or your current run
    // floor again (reconnect resume). No floor-skipping by message forgery.
    const allowed =
      floor === 1 ||
      floor <= account.checkpoint ||
      (account.runFloor > 0 && floor >= account.runFloor && floor <= account.runFloor + 1);
    if (!allowed) {
      this.log(`${peer.id} denied floor ${floor} (checkpoint ${account.checkpoint}, run ${account.runFloor})`);
      floor = 1;
    }
    this.leaveInstance(peer);
    const inst = this.directory.join(peer.id, floor);
    this.accounts.setRunFloor(account, floor);
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
    if (this.directory.instancesOnFloor(inst.floor).every((i) => i.id !== inst.id)) {
      this.epochs.delete(inst.id); // instance was garbage-collected
      return;
    }
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
