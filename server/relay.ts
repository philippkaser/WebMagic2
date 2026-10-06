import { FloorDirectory, type FloorInstanceRecord } from "../src/net/matchmaking";
import {
  CHANNEL_AUTHORITY,
  CHANNEL_PEER,
  CHANNEL_TO_HOST,
  type ClientMsg,
  type MemberInfo,
  type ServerMsg,
} from "../src/net/protocol";
import type { AccountStore } from "./accounts";
import { Ledger, type FloorEntry, type LedgerOptions } from "./ledger";

/** The router — the gameplay-blind half of the server. Pure logic (I/O
 * injected via `send`), so the host-migration/authority/routing rules are
 * unit-testable without a socket in sight.
 *
 * Responsibilities — and the complete list, by design:
 *  - connections, and floor instances via FloorDirectory (rare same-floor
 *    encounters, max 4 per instance) — seated wherever the ledger says
 *  - host designation + migration (epoch bumps on every change)
 *  - clock pongs (one shared timeline for interpolation)
 *  - relaying opaque envelopes by channel-prefix rule:
 *      "a:" only the host may send (to the instance, or one member via `to`)
 *      "h:" anyone → current host only
 *      "p:" anyone → the rest of the instance
 *  - asking the host to world-sync each late joiner
 *
 * Everything an account owns — identity, runs and their pace, saves, grants
 * — is the ledger's (server/ledger.ts); the router hands it every message
 * that isn't routing. Gameplay is client-side code: adding a networked
 * feature never changes this file. */

export interface RelayPeer {
  id: string;
  name: string;
  send(msg: ServerMsg): void;
}

export type RelayOptions = LedgerOptions;

export class Relay {
  private peers = new Map<string, RelayPeer>();
  private epochs = new Map<string, number>();
  private ledger: Ledger;

  constructor(
    private directory: FloorDirectory,
    accounts: AccountStore,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
    options: RelayOptions = {},
  ) {
    this.ledger = new Ledger(
      accounts,
      {
        instanceOf: (id) => this.directory.instanceOf(id),
        hostOf: (id) => this.hostOf(id),
        isConnected: (id) => this.peers.has(id),
        nameOf: (id) => this.peers.get(id)?.name ?? "Wizard",
        setName: (id, name) => {
          const peer = this.peers.get(id);
          if (peer) peer.name = name;
        },
        send: (id, msg) => this.peers.get(id)?.send(msg),
        seat: (id, entry) => this.seat(this.peers.get(id)!, entry),
      },
      now,
      log,
      options,
    );
  }

  connect(peer: RelayPeer): void {
    this.peers.set(peer.id, peer);
    peer.send({ t: "welcome", playerId: peer.id });
  }

  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.leaveInstance(peer);
    this.directory.forget(peerId);
    this.peers.delete(peerId);
    this.ledger.disconnect(peerId);
  }

  handle(peerId: string, msg: ClientMsg): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    switch (msg.t) {
      case "ping":
        peer.send({ t: "pong", sent: msg.sent, serverTime: this.now() });
        return;
      case "msg":
        this.relay(peer, msg.ch, msg.data, msg.to);
        return;
      case "leaveDungeon":
        this.leaveInstance(peer); // …and the ledger hears it too (a held entry drops)
        break;
    }
    this.ledger.handle(peerId, msg);
  }

  // ── Instances ──────────────────────────────────────────────────────────────

  /** Seat a connection on the floor the ledger decided, leaving its current
   * one, and tell everyone concerned. */
  private seat(peer: RelayPeer, entry: FloorEntry): FloorInstanceRecord {
    this.leaveInstance(peer);
    const inst = this.directory.join(peer.id, entry.floor, { preferInstanceId: entry.preferInstanceId });
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
        runFloors: entry.runFloors,
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
    this.log(`${peer.id} -> floor ${inst.floor} (${inst.id}, ${inst.players.size} player(s))`);
    return inst;
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

  /** Drop per-instance bookkeeping for instances the directory has let go
   * (empty ones linger briefly for reconnects, then vanish). */
  private pruneGone(): void {
    const exists = (id: string) => this.directory.instanceById(id) !== null;
    for (const id of this.epochs.keys()) if (!exists(id)) this.epochs.delete(id);
    this.ledger.prune(exists);
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
