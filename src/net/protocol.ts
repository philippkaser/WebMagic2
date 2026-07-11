/** Wire protocol between client and the relay server.
 *
 * The server is deliberately GAMEPLAY-BLIND. It handles matchmaking, host
 * designation, clock pongs and relaying of opaque channel envelopes — it
 * never learns what an "enemy" or an "orb" is. All gameplay messages are
 * defined client-side (net/channels.ts), so adding a networked feature never
 * touches the server or this file.
 *
 * The entire authorization model is the channel-name prefix:
 *
 *   "a:"  authority — only the instance host may send; relayed to the rest
 *         of the instance (or to one member via `to`, e.g. late-join sync).
 *   "h:"  to-host   — anyone may send; delivered to the current host only.
 *   "p:"  peer      — anyone may send; broadcast to the rest of the instance.
 */

export interface MemberInfo {
  id: string;
  name: string;
}

export interface FloorAssignment {
  instanceId: string;
  floor: number;
  /** Deterministic seed — every client in the instance generates the same floor. */
  seed: number;
  /** The instance's simulation host (first joiner; migrates on leave). */
  hostId: string;
  /** Host generation, bumped on every migration. Authority traffic is
   * relay-stamped with it so stale-host packets are identifiable. */
  epoch: number;
  /** Everyone currently in the instance, including the recipient. */
  members: MemberInfo[];
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
  checkpoint: number;
  inventory: WireInventory;
}

export type ClientMsg =
  /** Device identity: no token = new account; the reply carries the token to
   * keep. Also updates the display name. */
  | { t: "login"; name: string; token?: string }
  | { t: "enterFloor"; floor: number }
  | { t: "leaveDungeon" }
  /** Checkpoint banking. The server validates every item against what was
   * actually granted this run (host-attested) and answers with `saved`. */
  | { t: "bank"; inventory: WireInventory }
  /** Feather escape: bank from ANY dungeon floor by consuming a Feather of
   * Safe Passage. Same provenance rules as `bank`, does not move the
   * checkpoint; the server verifies a feather was actually spent. */
  | { t: "escape"; inventory: WireInventory }
  /** Village-only inventory rearrangement (chest/bag/belt moves, item
   * discards). Must be a sub-multiset of the current save — nothing new can
   * enter this way. Answered with `saved`. */
  | { t: "stash"; inventory: WireInventory }
  /** Merchant purchase: `inventory` is the client's post-purchase arrangement.
   * The server checks price and gold and that exactly the bought item was
   * added, then answers with `saved`. */
  | { t: "buy"; itemId: string; inventory: WireInventory }
  /** The run is lost — the server discards this run's grants. */
  | { t: "died" }
  /** HOST attestation: `playerId` legitimately picked up `itemId`. The only
   * path by which an item becomes bankable. Non-host senders are ignored. */
  | { t: "grant"; playerId: string; itemId: string }
  /** HOST attestation of a gold pickup — gold's provenance path, mirroring
   * `grant` (server-side sanity caps in items/economy.ts GOLD_RULES). */
  | { t: "grantGold"; playerId: string; amount: number }
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
  /** Relayed gameplay envelope. `serverTime` is stamped at relay time, which
   * gives every receiver one consistent timeline for interpolation. */
  | { t: "msg"; ch: string; from: string; epoch: number; serverTime: number; data: unknown };

export const CHANNEL_AUTHORITY = "a:";
export const CHANNEL_TO_HOST = "h:";
export const CHANNEL_PEER = "p:";

export type ChannelPrefix =
  | typeof CHANNEL_AUTHORITY
  | typeof CHANNEL_TO_HOST
  | typeof CHANNEL_PEER;
