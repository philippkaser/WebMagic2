import { DUNGEON, ENCOUNTER } from "../core/config";
import { RARITIES, RARITY_ORDER } from "../items/rarity";
import type { ItemInstance } from "../items/types";
import { FloorDirectory, type FloorInstanceRecord } from "./matchmaking";
import type { ChestInfo, ClientMsg, PeerState, ServerMsg } from "./protocol";

/** The game server's rules, independent of any socket. `server/server.ts`
 * wires it to Bun WebSockets; the offline LocalTransport runs the very same
 * core in-process with a single client. Responsibilities:
 *
 *  - matchmaking (FloorDirectory: encounters, pacts travel together)
 *  - relaying peer state/casts and host-authority entity traffic
 *  - wizard-vs-wizard hits (pacts: impulse only, no damage)
 *  - death chests & remains: server-owned so each is claimed exactly once
 */

interface CoreClient {
  id: string;
  name: string;
  send: (msg: ServerMsg) => void;
  state: PeerState | null;
  allies: Set<string>;
  /** Pact offers this client has made and that are still pending. */
  offeredTo: Set<string>;
}

interface Chest {
  info: ChestInfo;
  items: ItemInstance[];
  diedAt: number;
}

export interface ServerCoreOptions {
  random?: () => number;
  now?: () => number;
  log?: (text: string) => void;
  /** Override ENCOUNTER.joinChance (playtests: 1 = always meet). */
  joinChance?: number;
}

export class GameServerCore {
  private clients = new Map<string, CoreClient>();
  readonly directory: FloorDirectory;
  private chests = new Map<string, Map<string, Chest>>(); // instanceId → chests
  private remains = new Map<number, Chest[]>(); // floor → unclaimed chests
  private chestCounter = 1;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: (text: string) => void;

  constructor(opts: ServerCoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? (() => {});
    this.directory = new FloorDirectory({
      maxPerInstance: ENCOUNTER.maxPerInstance,
      joinChance: opts.joinChance ?? ENCOUNTER.joinChance,
      random: this.random,
      seedFn: () => Math.floor(this.random() * 0xffffffff) >>> 0,
      now: this.now,
    });
    this.directory.onDispose = (inst) => this.retireChests(inst);
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  connect(id: string, send: (msg: ServerMsg) => void): void {
    this.clients.set(id, { id, name: "Wizard", send, state: null, allies: new Set(), offeredTo: new Set() });
    send({ t: "welcome", playerId: id });
    this.log(`${id} connected (${this.clients.size} online)`);
  }

  disconnect(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    this.leaveDungeon(client);
    this.clients.delete(id);
    this.log(`${id} disconnected (${this.clients.size} online)`);
  }

  get onlineCount(): number {
    return this.clients.size;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  receive(id: string, msg: ClientMsg): void {
    const client = this.clients.get(id);
    if (!client) return;
    switch (msg.t) {
      case "hello":
        client.name = String(msg.name).slice(0, 24) || "Wizard";
        break;
      case "enterFloor":
        this.enterFloor(client, msg.floor);
        break;
      case "leaveDungeon":
        this.leaveDungeon(client);
        break;
      case "state": {
        client.state = {
          playerId: client.id,
          name: client.name,
          position: msg.position,
          yaw: msg.yaw,
          staffId: msg.staffId,
          hp: msg.hp,
          gear: msg.gear,
        };
        this.broadcast(client, { t: "snapshot", peers: [client.state] });
        break;
      }
      case "castAbility":
        this.broadcast(client, {
          t: "peerCast",
          playerId: client.id,
          abilityId: msg.abilityId,
          origin: msg.origin,
          dir: msg.dir,
        });
        break;

      // ── Host-authority replication relays ─────────────────────────────────
      case "entity":
        if (this.isHost(client)) this.broadcast(client, { t: "entitySnap", ents: msg.ents });
        break;
      case "entityEvent":
        if (this.isHost(client)) this.broadcast(client, { t: "entityEvent", ev: msg.ev });
        break;
      case "hit": {
        const host = this.hostClient(client);
        if (host && host !== client) {
          host.send({ t: "hitRequest", playerId: client.id, targetId: msg.targetId, damage: msg.damage, impulse: msg.impulse });
        }
        break;
      }
      case "takeOrb": {
        const host = this.hostClient(client);
        if (host && host !== client) host.send({ t: "orbRequest", playerId: client.id, orbId: msg.orbId });
        break;
      }
      case "stateSync": {
        const target = this.clients.get(msg.to);
        if (this.isHost(client) && target && this.sameInstance(client, target)) {
          target.send({ t: "stateSync", state: msg.state });
        }
        break;
      }

      // ── Wizard vs wizard ──────────────────────────────────────────────────
      case "pvpHit": {
        const target = this.clients.get(msg.targetId);
        if (!target || !this.sameInstance(client, target)) break;
        // Allies still get shoved (blast-jumping together is half the fun),
        // but pact spells never wound.
        const damage = client.allies.has(target.id) ? 0 : Math.max(0, Math.min(Number(msg.damage) || 0, 400));
        target.send({ t: "pvpHit", fromId: client.id, damage, impulse: msg.impulse });
        break;
      }
      case "pactOffer":
        this.offerPact(client, msg.targetId);
        break;
      case "pactBreak":
        this.breakPacts(client);
        break;

      // ── Death & chests ────────────────────────────────────────────────────
      case "died":
        this.died(client, msg.pos, msg.items, msg.killerId);
        break;
      case "openChest":
        this.openChest(client, msg.chestId);
        break;
    }
  }

  // ── Floors ─────────────────────────────────────────────────────────────────

  private enterFloor(client: CoreClient, rawFloor: number): void {
    const floor = Math.max(1, Math.min(DUNGEON.maxFloor, Math.floor(rawFloor) || 1));
    this.leaveInstance(client);
    client.state = null; // stale position from the previous floor
    const { instance, joinedExisting, created } = this.directory.join(client.id, floor, client.allies);
    if (created) this.adoptRemains(instance);
    client.send({
      t: "floorAssigned",
      assignment: {
        instanceId: instance.id,
        floor: instance.floor,
        seed: instance.seed,
        playerCount: instance.players.size,
        hostId: this.directory.hostOf(instance),
        joinedExisting,
        chests: [...(this.chests.get(instance.id)?.values() ?? [])].map((c) => c.info),
      },
    });
    const others = this.mates(client);
    for (const m of others) m.send({ t: "peerJoined", peer: placeholderState(client) });
    // The joiner learns about EVERY mate, including ones that haven't
    // broadcast a position yet (placeholder below the world until they do).
    if (others.length > 0) client.send({ t: "snapshot", peers: others.map((m) => m.state ?? placeholderState(m)) });
    // Late join: the host brings this player up to date (dead entities, live
    // positions, loot) so they don't see a ghost floor.
    const host = this.hostClient(client);
    if (host && host !== client) host.send({ t: "stateRequest", playerId: client.id });
    this.log(`${client.id} -> floor ${floor} (${instance.id}, ${instance.players.size} wizard(s)${joinedExisting ? ", encounter" : ""})`);
  }

  /** Leave the current instance (descending, extracting, dying). */
  private leaveInstance(client: CoreClient): void {
    const inst = this.directory.instanceOf(client.id);
    if (!inst) return;
    const wasHost = this.directory.hostOf(inst) === client.id;
    const remaining = this.mates(client);
    for (const m of remaining) m.send({ t: "peerLeft", playerId: client.id });
    this.directory.leave(client.id);
    if (wasHost && remaining.length > 0) {
      const newHost = this.directory.hostOf(inst);
      for (const m of remaining) m.send({ t: "hostChanged", hostId: newHost });
      this.log(`host of ${inst.id} -> ${newHost}`);
    }
  }

  /** Leaving the dungeon ends the run: pacts are run-scoped. */
  private leaveDungeon(client: CoreClient): void {
    this.leaveInstance(client);
    this.breakPacts(client);
    client.offeredTo.clear();
  }

  // ── Pacts ──────────────────────────────────────────────────────────────────

  private offerPact(client: CoreClient, targetId: string): void {
    const target = this.clients.get(targetId);
    if (!target || target === client || !this.sameInstance(client, target) || client.allies.has(targetId)) return;
    if (target.offeredTo.has(client.id)) {
      target.offeredTo.delete(client.id);
      client.offeredTo.delete(target.id);
      client.allies.add(target.id);
      target.allies.add(client.id);
      client.send({ t: "pactFormed", allyId: target.id });
      target.send({ t: "pactFormed", allyId: client.id });
      this.log(`pact: ${client.id} + ${target.id}`);
    } else {
      client.offeredTo.add(target.id);
      target.send({ t: "pactOffered", fromId: client.id });
    }
  }

  private breakPacts(client: CoreClient): void {
    for (const allyId of client.allies) {
      const ally = this.clients.get(allyId);
      ally?.allies.delete(client.id);
      ally?.send({ t: "pactBroken", allyId: client.id });
      client.send({ t: "pactBroken", allyId });
    }
    client.allies.clear();
  }

  // ── Death & chests ─────────────────────────────────────────────────────────

  private died(client: CoreClient, pos: [number, number, number], items: ItemInstance[], killerId: string | null): void {
    const inst = this.directory.instanceOf(client.id);
    if (!inst) return;
    const killer = killerId ? this.clients.get(killerId) ?? null : null;
    const safeItems = Array.isArray(items) ? items.slice(0, 64) : [];
    if (safeItems.length > 0) {
      const chest: Chest = {
        info: {
          id: `chest_${this.chestCounter++}`,
          owner: client.name,
          itemCount: safeItems.length,
          glow: glowFor(safeItems),
          pos,
          slot: null,
        },
        items: safeItems,
        diedAt: this.now(),
      };
      let map = this.chests.get(inst.id);
      if (!map) this.chests.set(inst.id, (map = new Map()));
      map.set(chest.info.id, chest);
      for (const m of this.mates(client)) m.send({ t: "chestSpawn", chest: chest.info });
    }
    for (const m of this.mates(client)) {
      m.send({ t: "peerDied", playerId: client.id, name: client.name, killerId: killer?.id ?? null, killerName: killer?.name ?? null });
    }
    this.log(`${client.id} died on floor ${inst.floor}${killer ? ` (slain by ${killer.id})` : ""}, chest of ${safeItems.length}`);
    this.leaveDungeon(client);
  }

  private openChest(client: CoreClient, chestId: string): void {
    const inst = this.directory.instanceOf(client.id);
    const map = inst && this.chests.get(inst.id);
    const chest = map?.get(chestId);
    if (!inst || !map || !chest) return; // already claimed — first come, first served
    map.delete(chestId);
    client.send({ t: "chestGrant", chestId, items: chest.items.map((i) => ({ ...i, runLoot: true })) });
    client.send({ t: "chestOpened", chestId, by: client.id });
    this.broadcast(client, { t: "chestOpened", chestId, by: client.id });
  }

  /** When an instance empties, its unclaimed chests become *remains* that
   * later instances of the same floor inherit. */
  private retireChests(inst: FloorInstanceRecord): void {
    const map = this.chests.get(inst.id);
    this.chests.delete(inst.id);
    if (!map || map.size === 0) return;
    const pool = this.remains.get(inst.floor) ?? [];
    pool.push(...map.values());
    pool.sort((a, b) => b.diedAt - a.diedAt);
    this.remains.set(inst.floor, pool.slice(0, ENCOUNTER.maxRemainsPerFloor));
  }

  private adoptRemains(inst: FloorInstanceRecord): void {
    const pool = (this.remains.get(inst.floor) ?? []).filter((c) => this.now() - c.diedAt < ENCOUNTER.remainsTtlMs);
    if (pool.length === 0) {
      this.remains.delete(inst.floor);
      return;
    }
    // A new instance inherits at most two sets of remains; the rest wait.
    const adopted = pool.splice(0, 2);
    this.remains.set(inst.floor, pool);
    const map = new Map<string, Chest>();
    adopted.forEach((c, slot) => {
      c.info = { ...c.info, pos: null, slot };
      map.set(c.info.id, c);
    });
    this.chests.set(inst.id, map);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private mates(client: CoreClient): CoreClient[] {
    const inst = this.directory.instanceOf(client.id);
    if (!inst) return [];
    const out: CoreClient[] = [];
    for (const pid of inst.players) {
      if (pid === client.id) continue;
      const c = this.clients.get(pid);
      if (c) out.push(c);
    }
    return out;
  }

  private broadcast(client: CoreClient, msg: ServerMsg): void {
    for (const m of this.mates(client)) m.send(msg);
  }

  private isHost(client: CoreClient): boolean {
    const inst = this.directory.instanceOf(client.id);
    return !!inst && this.directory.hostOf(inst) === client.id;
  }

  private hostClient(client: CoreClient): CoreClient | null {
    const inst = this.directory.instanceOf(client.id);
    return inst ? this.clients.get(this.directory.hostOf(inst)) ?? null : null;
  }

  private sameInstance(a: CoreClient, b: CoreClient): boolean {
    const ia = this.directory.instanceOf(a.id);
    return !!ia && ia === this.directory.instanceOf(b.id);
  }
}

function placeholderState(client: CoreClient): PeerState {
  return {
    playerId: client.id,
    name: client.name,
    position: { x: 0, y: -999, z: 0 },
    yaw: 0,
    staffId: "apprentice_staff",
    hp: 1,
    gear: 1,
  };
}

function glowFor(items: ItemInstance[]): string {
  let best = 0;
  for (const i of items) best = Math.max(best, RARITY_ORDER.indexOf(i.rarity));
  return RARITIES[RARITY_ORDER[best]].color;
}
