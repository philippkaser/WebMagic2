/** Wire protocol between client and the server.
 *
 * Two kinds of messages. Gameplay travels in opaque channel envelopes the
 * ROUTER (server/relay.ts) relays without reading — what an enemy or a
 * spell is never reaches it, and all of it is defined client-side
 * (net/channels.ts), so adding a networked feature never touches the server
 * or this file. Everything an account owns goes to the LEDGER
 * (server/ledger.ts): login, runs, saves, and loot — the floor host reports
 * what died, the ledger rolls what it dropped and grants each orb once.
 *
 * The envelopes' authorization model is the channel-name prefix:
 *
 *   "a:"  authority — only the instance host may send; relayed to the rest
 *         of the instance (or to one member via `to`, e.g. late-join sync).
 *   "h:"  to-host   — anyone may send; delivered to the current host only.
 *   "p:"  peer      — anyone may send; broadcast to the rest of the instance.
 */

import type { LootSource } from "../items/dropTables";
import type { IssuedOrb } from "../items/lootBook";

/** A specific drop, for tests and the dev room (see ClientMsg "loot"). */
export interface DevLoot {
  kind: "dev";
  itemId: string | null;
  gold: number;
}

export interface MemberInfo {
  id: string;
  name: string;
}

export interface FloorAssignment {
  instanceId: string;
  floor: number;
  /** Deterministic seed — every client in the instance generates the same floor. */
  seed: number;
  /** The instance's simulation host: its first joiner (migrating on leave),
   * or SERVER_HOST_ID when the server hosts the floor. */
  hostId: string;
  /** Host generation, bumped on every migration. Authority traffic is
   * relay-stamped with it so stale-host packets are identifiable. */
  epoch: number;
  /** Everyone currently in the instance, including the recipient. */
  members: MemberInfo[];
  /** Floors this run has played, counting this one — the server's count is
   * the one the way home is judged by, so the client adopts it. Absent
   * offline (the client counts for itself). */
  runFloors?: number;
}

/** Opaque gameplay envelope, client → server. */
export interface Envelope {
  ch: string;
  data: unknown;
  /** Direct recipient (host → one member; only honored on "a:" channels). */
  to?: string;
}

/** Banked equipment on the wire. Item ids are OPAQUE STRINGS to the server —
 * it validates provenance (was this granted?), never meaning. */
export interface WireEquipment {
  staff: string;
  amulet: string | null;
  cloak: string | null;
  boots: string | null;
}

/** One inventory cell on the wire (consumables stack). */
export interface WireStack {
  id: string;
  qty: number;
}

/** The full banked inventory: equipment, the Q/E belt, the 5-slot bag, the
 * 30-slot village chest, and gold. Item ids stay opaque to the server; it
 * validates PROVENANCE (multiset ⊆ owned ∪ granted), never meaning. */
export interface WireInventory {
  equipment: WireEquipment;
  bag: (WireStack | null)[];
  belt: (WireStack | null)[];
  chest: (WireStack | null)[];
  gold: number;
}

/** The server-authoritative save. What the client has locally is a cache. */
export interface ServerSave {
  /** Deepest floor ever walked home from (0 = never). */
  deepest: number;
  inventory: WireInventory;
}

export type ClientMsg =
  /** Device identity: no token = new account; the reply carries the token to
   * keep. Also updates the display name. */
  | { t: "login"; name: string; token?: string }
  /** Enter a dungeon floor. `fresh` = a new run from the village portal: the
   * server ignores the requested floor and casts the wizard to the depth
   * their banked gear resonates at (run/rules.ts). Otherwise the request must
   * continue the current run: the same floor (reconnect) or one deeper
   * (portal, warp rune). Anything else forfeits the run and starts fresh.
   * New floors keep the deep's pace (run/rules.ts PACE): one asked for too
   * soon is answered once it's due, not refused. */
  | { t: "enterFloor"; floor: number; fresh?: boolean }
  | { t: "leaveDungeon" }
  /** Walk home through a way-home portal. Refused until the run has played
   * RUN.floorsBeforeExit floors; the server validates every item against what
   * was actually granted this run (host-attested) and answers with `saved`. */
  | { t: "bank"; inventory: WireInventory }
  /** Feather escape: bank from ANY dungeon floor by consuming a Feather of
   * Safe Passage — even before the Tithe of Five is paid. Same provenance
   * rules as `bank`, never counts as a deepest; the server verifies a feather
   * was actually spent. */
  | { t: "escape"; inventory: WireInventory }
  /** Village-only inventory rearrangement (chest/bag/belt moves, item
   * discards). Must be a sub-multiset of the current save — nothing new can
   * enter this way. Answered with `saved`. */
  | { t: "stash"; inventory: WireInventory }
  /** Merchant purchase: `inventory` is the client's post-purchase arrangement.
   * The server checks price and gold and that exactly the bought item was
   * added, then answers with `saved`. */
  | { t: "buy"; itemId: string; inventory: WireInventory }
  /** Merchant sale: `inventory` is the post-sale arrangement (the sold copies
   * gone). The server checks the copies were owned and credits the shared
   * economy sell value. Answered with `saved`. */
  | { t: "sell"; itemId: string; qty: number; inventory: WireInventory }
  /** Orb of Fortune: the SERVER rolls the item (shared pure rollGamble),
   * deducts the price, places it in the bag and answers with `saved` — the
   * client learns what it won from the save diff. Village only. */
  | { t: "gamble" }
  /** The run is lost — the server discards this run's grants. */
  | { t: "died" }
  /** The gear this wizard is wearing now (sent on entering a floor and on
   * every change). The server checks it against what the account carries
   * and, on a floor it hosts, casts this wizard's spells with THESE stats
   * (computed server-side) — never the ones a cast message claims. */
  | { t: "loadout"; equipment: WireEquipment }
  /** The wizard drank one draught (a healing or mana potion) from what they
   * carry. The server takes it off the account — so it can be drunk once,
   * and banked never — and counts its effect: on a floor the server hosts,
   * the heal and the mana are applied there (that's the health that
   * counts); anywhere, it raises the health the server will believe on the
   * next floor it hosts. */
  | { t: "drink"; itemId: string }
  /** HOST report: `id` died or broke at `at` (enemy "e3", prop "p12", the
   * "boss", or a runtime spawn described by `source`). The server rolls what
   * it drops from its own loot book (items/lootBook.ts) and answers the host
   * with `lootRolled` — the host says WHAT fell, never what it dropped. A
   * `dev` source (a specific item or gold) is honored only by a server
   * started for testing. */
  | { t: "loot"; id: string; source: LootSource | DevLoot; at: [number, number, number] }
  /** The sender let one copy of `itemId` fall to the floor (an inventory
   * drop — anyone there may take it). `runLoot` says which copy: one found
   * this run, or one brought from home. The server takes it off the sender
   * and answers with `released`: the copy, now an orb anyone may claim. */
  | { t: "drop"; itemId: string; runLoot: boolean }
  /** HOST attestation: `playerId` took orb `orbId` (a drop, a gift, the floor
   * treasure). The ONLY way anything found becomes bankable: the server
   * grants what it put in that orb, once. */
  | { t: "claim"; playerId: string; orbId: string }
  /** HOST attestation: `playerId` plundered `itemId` from a grave — honored
   * only against what the wizards who died in this instance were granted. */
  | { t: "grant"; playerId: string; itemId: string; source: "grave" }
  /** HOST attestation: grave gold, up to what the dead carried. */
  | { t: "grantGold"; playerId: string; amount: number; source: "grave" }
  /** Clock sync probe; `sent` is the sender's local monotonic time. */
  | { t: "ping"; sent: number }
  | ({ t: "msg" } & Envelope);

export type ServerMsg =
  | { t: "welcome"; playerId: string }
  | { t: "loggedIn"; token: string; save: ServerSave }
  /** Authoritative save after a bank request (cheated items stripped). */
  | { t: "saved"; save: ServerSave }
  | { t: "floorAssigned"; assignment: FloorAssignment }
  | { t: "peerJoined"; member: MemberInfo }
  | { t: "peerLeft"; playerId: string }
  | { t: "hostChanged"; hostId: string; epoch: number }
  | { t: "pong"; sent: number; serverTime: number }
  /** Server → host: a joiner needs the current world state. The host answers
   * on an "a:" channel with `to` = that player. */
  | { t: "syncRequest"; playerId: string }
  /** To the host: what `id` dropped, as orbs to spawn at `at`. */
  | { t: "lootRolled"; id: string; at: [number, number, number]; orbs: IssuedOrb[] }
  /** To a dropper: its dropped copy, now orb `orb` — ask the host to spawn it. */
  | { t: "released"; orb: IssuedOrb }
  /** Relayed gameplay envelope. `serverTime` is stamped at relay time, which
   * gives every receiver one consistent timeline for interpolation. */
  | { t: "msg"; ch: string; from: string; epoch: number; serverTime: number; data: unknown };

/** The host id of a floor the SERVER hosts (server/floorHost.ts). Never a
 * wizard's id; every wizard on such a floor is a replica. */
export const SERVER_HOST_ID = "@host";

export const CHANNEL_AUTHORITY = "a:";
export const CHANNEL_TO_HOST = "h:";
export const CHANNEL_PEER = "p:";

export type ChannelPrefix =
  | typeof CHANNEL_AUTHORITY
  | typeof CHANNEL_TO_HOST
  | typeof CHANNEL_PEER;
