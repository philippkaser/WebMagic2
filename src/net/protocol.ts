/** Wire protocol between client and the relay server.
 *
 * The server is BLIND TO THE WORLD: it never learns what an "enemy" or an
 * "orb" is, and every gameplay message about the floor is defined
 * client-side (net/channels.ts) and relayed as an opaque envelope — so a new
 * networked feature on the floor never touches the server or this file.
 * What it does know is the BANK: accounts, provenance, and the shared pure
 * economy rules it runs on banked inventories (prices, the gamble, the
 * cauldron and the forge — the same functions the client runs offline),
 * plus the social rooms (the camp, chat, fellowships).
 *
 * The entire authorization model is the channel-name prefix:
 *
 *   "a:"  authority — only the instance host may send; relayed to the rest
 *         of the instance (or to one member via `to`, e.g. late-join sync).
 *   "h:"  to-host   — anyone may send; delivered to the current host only.
 *   "p:"  peer      — anyone may send; broadcast to the rest of the instance.
 */
import type { AuthErrorReason } from "./credentials";
import type { PartyError } from "./party";

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
  /** Floors this run has played, counting this one — the server's count is
   * the one the way home is judged by, so the client adopts it. Absent
   * offline (the client counts for itself). */
  runFloors?: number;
}

/** A seat in the camp (the village every wizard shares when home): who's
 * there and who hosts its little world. */
export interface CampAssignment {
  instanceId: string;
  hostId: string;
  epoch: number;
  members: MemberInfo[];
}

/** A fellowship as its members see it (net/party.ts). */
export interface PartyInfo {
  code: string;
  leader: string;
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

/** Where an item sits in a wire inventory: an equipment slot, or a grid
 * cell (the forge's anvil target). */
export type WireSlot =
  | { c: "equipment"; s: keyof WireEquipment }
  | { c: "bag" | "belt" | "pouch" | "chest"; i: number };

/** The largest grid (the chest) bounds every cell index. */
const MAX_GRID_CELLS = 30;

export function isWireSlot(raw: unknown): raw is WireSlot {
  const s = raw as Partial<{ c: unknown; s: unknown; i: unknown }> | null;
  if (!s || typeof s !== "object") return false;
  if (s.c === "equipment") return s.s === "staff" || s.s === "amulet" || s.s === "cloak" || s.s === "boots";
  if (s.c === "bag" || s.c === "belt" || s.c === "pouch" || s.c === "chest") {
    return typeof s.i === "number" && Number.isInteger(s.i) && s.i >= 0 && s.i < MAX_GRID_CELLS;
  }
  return false;
}

/** One inventory cell on the wire (consumables stack). */
export interface WireStack {
  id: string;
  qty: number;
}

/** The full banked inventory: equipment, the Q/E belt, the 5-slot bag, the
 * reagent pouch, the 30-slot village chest, and gold. Item ids stay opaque to the server; it
 * validates PROVENANCE (multiset ⊆ owned ∪ granted), never meaning. */
export interface WireInventory {
  equipment: WireEquipment;
  bag: (WireStack | null)[];
  belt: (WireStack | null)[];
  /** The reagent pouch (materials). Absent in saves from before it existed. */
  pouch: (WireStack | null)[];
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
  /** Identity: the stored token — a member's sign-in token or a guest's
   * device token; none = a new guest account. The reply (`loggedIn`) carries
   * the token to keep. A lapsed or revoked sign-in token is answered with
   * `authError` "session-expired" instead. Also updates the display name. */
  | { t: "login"; name: string; token?: string }
  /** The ledger (server/auth.ts) — title screen / village only. Each is
   * answered with `authOk` (a fresh sign-in token to keep in place of any
   * other) or `authError`. Passwords are hashed with argon2id, never kept.
   *
   * register: write a NEW wizard into the ledger (`name` = its display name;
   * the username is only for signing in). */
  | { t: "register"; username: string; password: string; name?: string }
  /** Sign in to an existing wizard. */
  | { t: "loginPassword"; username: string; password: string }
  /** The guest this connection plays seals itself with a username and
   * password — its progress carries over; its device token stops working. */
  | { t: "claim"; username: string; password: string }
  /** Revoke this connection's sign-in token (`everywhere`: all of the
   * account's) and unbind it; answered with `loggedOut`. */
  | { t: "logout"; everywhere?: boolean }
  /** Enter a dungeon floor. `fresh` = a new run from the village portal: the
   * server ignores the requested floor and casts the wizard to the depth
   * their banked gear resonates at (run/rules.ts). Otherwise the request must
   * continue the current run: the same floor (reconnect) or one deeper
   * (portal, warp rune). Anything else forfeits the run and starts fresh. */
  | { t: "enterFloor"; floor: number; fresh?: boolean }
  | { t: "leaveDungeon" }
  /** Home: take a seat in the camp among the other wizards there (your
   * fellowship's camp first). Answered with `campAssigned`. Entering a floor
   * leaves the camp. */
  | { t: "enterCamp" }
  /** Say something to whoever shares your room (camp or floor), or — with
   * `party` — to your fellowship wherever they are. The server trims and
   * rate-limits it. */
  | { t: "chat"; text: string; party?: boolean }
  /** Fellowships (net/party.ts). Each answered with `party` (to every
   * member) or `partyError`. */
  | { t: "partyCreate" }
  | { t: "partyJoin"; code: string }
  | { t: "partyLeave" }
  /** Invite a wizard who shares your room; they get `partyInvited`. */
  | { t: "partyInvite"; to: string }
  | { t: "partyAccept" }
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
  /** Wenna's cauldron or Brannoc's forge (items/crafting.ts): the SERVER
   * applies the shared pure recipe to the banked inventory with its own
   * dice and answers with `crafted`. Village only. `expect` is the item id
   * the client saw at `target`: if the server's banked inventory holds
   * something else there, it refuses rather than work the wrong piece. */
  | { t: "craft"; recipe: string; target?: WireSlot; expect?: string }
  /** The run is lost — the server discards this run's grants. */
  | { t: "died" }
  /** HOST attestation: `playerId` legitimately picked up `itemId`. The only
   * path by which an item becomes bankable. Non-host senders are ignored.
   * `source: "grave"` = plundered from a grave: honored only against what
   * wizards who died in that instance were actually granted (their grave
   * pool), so a forged grave can't mint bankable items. */
  | { t: "grant"; playerId: string; itemId: string; qty?: number; source?: "grave" }
  /** HOST attestation of a gold pickup — gold's provenance path, mirroring
   * `grant` (server-side sanity caps in items/economy.ts GOLD_RULES). */
  | { t: "grantGold"; playerId: string; amount: number; source?: "grave" }
  /** Clock sync probe; `sent` is the sender's local monotonic time. */
  | { t: "ping"; sent: number }
  | ({ t: "msg" } & Envelope);

export type ServerMsg =
  | { t: "welcome"; playerId: string }
  /** `username` is set for members (signed-in accounts), absent for guests. */
  | { t: "loggedIn"; token: string; save: ServerSave; username?: string }
  /** The ledger accepted: keep `token`; `name` is the wizard's display name. */
  | { t: "authOk"; token: string; username: string; name: string; save: ServerSave }
  | { t: "authError"; reason: AuthErrorReason; retryAfterMs?: number }
  | { t: "loggedOut" }
  /** Authoritative save after a bank request (cheated items stripped). */
  | { t: "saved"; save: ServerSave }
  /** A craft's result: the authoritative save, and what happened. */
  | {
      t: "crafted";
      /** The recipe asked for (so a reply can never be mislabelled). */
      recipe: string;
      save: ServerSave;
      ok: boolean;
      reason?: string;
      produced?: WireStack[];
      changed?: { from: string; to: string };
    }
  | { t: "floorAssigned"; assignment: FloorAssignment }
  | { t: "campAssigned"; assignment: CampAssignment }
  | { t: "chat"; from: string; name: string; text: string; party: boolean }
  /** Your fellowship as it now stands (null: you have none). */
  | { t: "party"; party: PartyInfo | null }
  | { t: "partyInvited"; from: string; name: string }
  | { t: "partyError"; reason: PartyError }
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
