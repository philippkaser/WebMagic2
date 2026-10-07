import { FloorDirectory, type FloorInstanceRecord } from "../src/net/matchmaking";
import {
  CHANNEL_AUTHORITY,
  CHANNEL_PEER,
  CHANNEL_TO_HOST,
  SERVER_HOST_ID,
  type ClientMsg,
  type MemberInfo,
  type ServerMsg,
} from "../src/net/protocol";
import type { AccountStore } from "./accounts";
import type { FloorHosting, HostedFloor } from "./hosting";
import { Ledger, type FloorEntry, type LedgerOptions } from "./ledger";

/** The router — the gameplay-blind half of the server. Pure logic (I/O
 * injected via `send`), so the host-migration/authority/routing rules are
 * unit-testable without a socket in sight.
 *
 * Responsibilities — and the complete list, by design:
 *  - connections, and floor instances via FloorDirectory (rare same-floor
 *    encounters, max 4 per instance) — seated wherever the ledger says
 *  - host designation + migration (epoch bumps on every change). A floor's
 *    host is its oldest wizard, or — where the hosting policy says so
 *    (server/hosting.ts) — a floor host on the server (server/floorHost.ts),
 *    which takes the floor over from its wizard host like any migration
 *  - clock pongs (one shared timeline for interpolation)
 *  - relaying opaque envelopes by channel-prefix rule:
 *      "a:" only the host may send (to the instance, or one member via `to`)
 *      "h:" anyone → current host only
 *      "p:" anyone → the rest of the instance
 *    A server-side host is one more member: it hears what members hear and
 *    its "a:" envelopes go out like a wizard host's.
 *  - asking the host to world-sync each late joiner
 *
 * Everything an account owns — identity, runs and their pace, saves, grants
 * — is the ledger's (server/ledger.ts); the router hands it every message
 * that isn't routing. Gameplay is client-side code and the floor host's:
 * adding a networked feature never changes this file. */

export interface RelayPeer {
  id: string;
  name: string;
  send(msg: ServerMsg): void;
}

export interface RelayOptions extends LedgerOptions {
  /** Who may host floors server-side (server/hosting.ts). Absent: every
   * floor is hosted by a wizard. */
  hosting?: FloorHosting;
}

/** A server-side host taking a floor over waits this long for the wizard
 * host's world sync before it takes the floor with what it has seen. */
export const HANDOVER_TIMEOUT_MS = 3000;

interface ServerHosted {
  host: HostedFloor;
  /** When it started listening (a replica until promoted). */
  since: number;
}

export class Relay {
  private peers = new Map<string, RelayPeer>();
  private epochs = new Map<string, number>();
  private hosted = new Map<string, ServerHosted>();
  private ledger: Ledger;
  private hosting: FloorHosting | null;
  private sinceSweep = 0;

  constructor(
    private directory: FloorDirectory,
    accounts: AccountStore,
    private now: () => number = () => Date.now(),
    private log: (text: string) => void = () => {},
    options: RelayOptions = {},
  ) {
    this.hosting = options.hosting ?? null;
    this.ledger = new Ledger(
      accounts,
      {
        instanceOf: (id) => this.directory.instanceOf(id),
        instanceById: (id) => this.directory.instanceById(id),
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

  /** Advance every server-hosted floor by `dt` seconds, and hand over the
   * floors whose wizard host never sent its sync. */
  tick(dt: number): void {
    this.sinceSweep += dt;
    if (this.sinceSweep >= 1) {
      this.sinceSweep = 0;
      this.pruneGone(); // floors whose instance lingered out
    }
    for (const [instId, h] of this.hosted) {
      h.host.tick(dt);
      if (!h.host.isHost && this.now() - h.since >= HANDOVER_TIMEOUT_MS) {
        this.promote(instId, "the wizard host never synced");
      }
    }
  }

  /** Is this instance's floor hosted by the server (tests, logs)? */
  serverHosts(instanceId: string): boolean {
    return this.hosted.get(instanceId)?.host.isHost === true;
  }

  // ── Instances ──────────────────────────────────────────────────────────────

  /** Seat a connection on the floor the ledger decided, leaving its current
   * one, and tell everyone concerned. */
  private seat(peer: RelayPeer, entry: FloorEntry): FloorInstanceRecord {
    this.leaveInstance(peer);
    const inst = this.directory.join(peer.id, entry.floor, { preferInstanceId: entry.preferInstanceId });
    if (!this.epochs.has(inst.id)) this.epochs.set(inst.id, 1);
    const wizardHost = this.oldestOf(inst);
    this.hostServerSide(inst, peer.id, wizardHost);
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
    const served = this.hosted.get(inst.id);
    if (served?.host.isHost) {
      served.host.sync(peer.id);
    } else {
      const host = this.peers.get(hostId);
      if (host && host.id !== peer.id) host.send({ t: "syncRequest", playerId: peer.id });
    }
    this.log(`${peer.id} -> floor ${inst.floor} (${inst.id}, ${inst.players.size} player(s))`);
    return inst;
  }

  /** The hosting policy's call for an instance that just took a wizard: a
   * floor already hosted server-side learns of its new member; one the
   * policy now wants server-side gets a host — fresh when nobody hosted it
   * yet, else as a replica of its wizard host, which is asked for a world
   * sync (the handover completes when it arrives, see promote()). */
  private hostServerSide(inst: FloorInstanceRecord, joiner: string, wizardHost: string): void {
    const served = this.hosted.get(inst.id);
    if (served) {
      served.host.joined(joiner);
      return;
    }
    if (!this.hosting?.wants({ floor: inst.floor, players: inst.players.size })) return;
    const instId = inst.id;
    const host = this.hosting.create({ id: inst.id, floor: inst.floor, seed: inst.seed }, this.ledger, {
      send: (name, data, to) => this.fromServerHost(instId, CHANNEL_AUTHORITY + name, data, to),
      nameOf: (id) => this.peers.get(id)?.name ?? "Wizard",
      ready: () => this.promote(instId, "synced"),
      log: this.log,
    });
    for (const id of inst.players) host.joined(id);
    this.hosted.set(instId, { host, since: this.now() });
    // Alone on a new floor (or the policy hosts every floor): nothing to take
    // over. Otherwise the wizard who has been hosting hands its floor over.
    const previous = this.peers.get(wizardHost);
    if (inst.players.size === 1 || !previous || wizardHost === joiner) {
      // Nobody to migrate from: the joiner's assignment names this host.
      host.promote();
      this.log(`server hosts ${instId} (fresh floor)`);
    } else {
      previous.send({ t: "syncRequest", playerId: SERVER_HOST_ID });
      this.log(`server taking over ${instId} from ${wizardHost}`);
    }
  }

  /** The server-side host takes the floor: every wizard becomes a replica. */
  private promote(instId: string, why: string): void {
    const served = this.hosted.get(instId);
    if (!served || served.host.isHost) return;
    served.host.promote();
    const inst = this.directory.instanceById(instId);
    if (!inst) return;
    const epoch = (this.epochs.get(instId) ?? 1) + 1;
    this.epochs.set(instId, epoch);
    for (const id of inst.players) this.peers.get(id)?.send({ t: "hostChanged", hostId: SERVER_HOST_ID, epoch });
    this.log(`server hosts ${instId} (epoch ${epoch}, ${why})`);
  }

  private leaveInstance(peer: RelayPeer): void {
    const inst = this.directory.instanceOf(peer.id);
    if (!inst) return;
    const wasHost = this.hostOf(peer.id) === peer.id;
    const remaining = this.mates(peer.id);
    for (const m of remaining) m.send({ t: "peerLeft", playerId: peer.id });
    this.directory.leave(peer.id);
    const served = this.hosted.get(inst.id);
    served?.host.left(peer.id);
    this.pruneGone();
    if (!this.directory.instanceById(inst.id)) return; // garbage-collected
    if (!wasHost) return;
    // The wizard host left mid-handover: the server takes what it has.
    if (served && !served.host.isHost) {
      this.promote(inst.id, "the wizard host left");
      return;
    }
    // Host migration: promote the next-oldest member, bump the epoch.
    if (remaining.length > 0) {
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
    const served = this.hosted.get(inst.id)?.host;
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
        if (to === SERVER_HOST_ID) {
          served?.receive(sender.id, ch, data); // the handover's world sync
          return;
        }
        if (to !== undefined) {
          const target = this.peers.get(to);
          // Deliver only if the target is still in the same instance.
          if (target && this.directory.instanceOf(to)?.id === inst.id) {
            target.send(relayed);
          }
          return;
        }
        for (const m of this.mates(sender.id)) m.send(relayed);
        served?.receive(sender.id, ch, data); // a server host listening in
        return;
      }
      case CHANNEL_TO_HOST: {
        if (sender.id === hostId) return; // host handles its own locally
        if (hostId === SERVER_HOST_ID) served?.receive(sender.id, ch, data);
        else this.peers.get(hostId)?.send(relayed);
        return;
      }
      case CHANNEL_PEER: {
        for (const m of this.mates(sender.id)) m.send(relayed);
        served?.receive(sender.id, ch, data);
        return;
      }
      default:
        return; // unknown prefix — drop
    }
  }

  /** An authority envelope from the server-side host of `instId`. */
  private fromServerHost(instId: string, ch: string, data: unknown, to?: string): void {
    const inst = this.directory.instanceById(instId);
    if (!inst) return;
    const msg: ServerMsg = {
      t: "msg",
      ch,
      from: SERVER_HOST_ID,
      epoch: this.epochs.get(instId) ?? 1,
      serverTime: this.now(),
      data,
    };
    if (to !== undefined) {
      if (inst.players.has(to)) this.peers.get(to)?.send(msg);
      return;
    }
    for (const id of inst.players) this.peers.get(id)?.send(msg);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Drop per-instance bookkeeping for instances the directory has let go
   * (empty ones linger briefly for reconnects, then vanish). */
  private pruneGone(): void {
    const exists = (id: string) => this.directory.instanceById(id) !== null;
    for (const id of this.epochs.keys()) if (!exists(id)) this.epochs.delete(id);
    for (const [id, h] of this.hosted) {
      if (exists(id)) continue;
      h.host.free();
      this.hosted.delete(id);
    }
    this.ledger.prune(exists);
  }

  /** Simulation host: the server, where it hosts the floor; otherwise the
   * first (oldest) member of the instance's player set. */
  private hostOf(playerId: string): string {
    const inst = this.directory.instanceOf(playerId);
    if (!inst) return "";
    if (this.hosted.get(inst.id)?.host.isHost) return SERVER_HOST_ID;
    return this.oldestOf(inst);
  }

  private oldestOf(inst: FloorInstanceRecord): string {
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
