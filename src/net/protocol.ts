/** Wire protocol shared by the client, the Bun server and the offline
 * loopback. Both "servers" run the same GameServerCore (net/serverCore.ts),
 * so single-player and online play speak exactly this message set.
 * See docs/ARCHITECTURE.md for the authority model. */

import type { ItemInstance } from "../items/types";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type Tuple3 = [number, number, number];

/** A death chest: everything a wizard lost when they fell. Server-owned, so
 * it can be claimed exactly once — even across host migration. `slot` marks
 * *remains*: a chest inherited from an older instance of this floor, placed
 * by the client at a deterministic remains slot of the new layout. */
export interface ChestInfo {
  id: string;
  owner: string;
  itemCount: number;
  /** Highest rarity inside — drives the chest's glow. */
  glow: string;
  pos: Tuple3 | null;
  slot: number | null;
}

export interface FloorAssignment {
  instanceId: string;
  floor: number;
  /** Deterministic seed — every client in the instance generates the same floor. */
  seed: number;
  playerCount: number;
  /** The instance's simulation host (first joiner; migrates on leave). The
   * host's simulation of enemies/props/loot is authoritative; everyone else
   * renders replicated state. */
  hostId: string;
  /** True when matchmaking dropped us into an instance already in progress. */
  joinedExisting: boolean;
  chests: ChestInfo[];
}

/** Position (+ optional health) of one replicated entity, host → replicas. */
export interface EntitySnap {
  id: string;
  p: Tuple3;
  hp?: number;
}

/** A rolled loot item on the floor. */
export interface OrbInfo {
  orbId: string;
  item: ItemInstance;
  pos: Tuple3;
}

/** Discrete world events, host → replicas (except pickup *requests*, which
 * flow replica → host as takeOrb). `silent` marks late-join catch-up: apply
 * the state change without death/break VFX. */
export type EntityEvent =
  | { k: "death"; id: string; silent?: boolean }
  | { k: "propBroken"; id: string; silent?: boolean }
  | { k: "orbSpawn"; orb: OrbInfo }
  | { k: "orbTaken"; orbId: string; by: string }
  | { k: "treasureTaken"; by: string; silent?: boolean }
  | {
      k: "enemyCast";
      origin: Tuple3;
      velocity: Tuple3;
      damage: number;
      color: string;
      size: number;
      blastRadius: number;
      blastImpulse: number;
      /** Gravity scale for lobbed casts (arcs). */
      gravity?: number;
      /** Lob leaves a burning ground patch for this many seconds. */
      burn?: number;
    }
  | {
      k: "boom";
      pos: Tuple3;
      radius: number;
      damage: number;
      impulse: number;
      color: string;
    };

export interface PeerState {
  playerId: string;
  name: string;
  position: Vec3Like;
  yaw: number;
  staffId: string;
  /** Health fraction 0..1 — floor-mates see how hurt you are. */
  hp: number;
  /** Gear level — how dangerous you look. */
  gear: number;
}

/** Authoritative floor state the host sends to a late joiner so they don't
 * see a pristine "ghost" floor where the host already fought. */
export interface FloorSyncState {
  deadIds: string[];
  ents: EntitySnap[];
  orbs: OrbInfo[];
  treasureTaken: boolean;
}

export type ClientMsg =
  | { t: "hello"; name: string }
  | { t: "enterFloor"; floor: number }
  | { t: "leaveDungeon" }
  | { t: "state"; position: Vec3Like; yaw: number; staffId: string; hp: number; gear: number }
  | { t: "castAbility"; abilityId: string; origin: Vec3Like; dir: Vec3Like }
  // Host only — dropped by the server if sent by anyone else:
  | { t: "entity"; ents: EntitySnap[] }
  | { t: "entityEvent"; ev: EntityEvent }
  | { t: "stateSync"; to: string; state: FloorSyncState }
  // Replica → host:
  | { t: "hit"; targetId: string; damage: number; impulse: Vec3Like }
  | { t: "takeOrb"; orbId: string }
  // Wizard vs wizard (shooter-authoritative; relayed within an instance,
  // damage zeroed between pact allies):
  | { t: "pvpHit"; targetId: string; damage: number; impulse: Vec3Like }
  | { t: "pactOffer"; targetId: string }
  | { t: "pactBreak" }
  // Death & chests (server-authoritative):
  | { t: "died"; pos: Tuple3; items: ItemInstance[]; killerId: string | null }
  | { t: "openChest"; chestId: string };

export type ServerMsg =
  | { t: "welcome"; playerId: string }
  | { t: "floorAssigned"; assignment: FloorAssignment }
  | { t: "peerJoined"; peer: PeerState }
  | { t: "peerLeft"; playerId: string }
  | { t: "hostChanged"; hostId: string }
  | { t: "snapshot"; peers: PeerState[] }
  | { t: "peerCast"; playerId: string; abilityId: string; origin: Vec3Like; dir: Vec3Like }
  | { t: "entitySnap"; ents: EntitySnap[] }
  | { t: "entityEvent"; ev: EntityEvent }
  | { t: "hitRequest"; playerId: string; targetId: string; damage: number; impulse: Vec3Like }
  | { t: "orbRequest"; playerId: string; orbId: string }
  /** Host: a late joiner needs the current floor state. */
  | { t: "stateRequest"; playerId: string }
  /** Late joiner: authoritative floor state from the host. */
  | { t: "stateSync"; state: FloorSyncState }
  /** Another wizard's spell landed on you. */
  | { t: "pvpHit"; fromId: string; damage: number; impulse: Vec3Like }
  | { t: "pactOffered"; fromId: string }
  | { t: "pactFormed"; allyId: string }
  | { t: "pactBroken"; allyId: string }
  | { t: "peerDied"; playerId: string; name: string; killerId: string | null; killerName: string | null }
  | { t: "chestSpawn"; chest: ChestInfo }
  | { t: "chestOpened"; chestId: string; by: string }
  /** You won the race for a chest: its contents are yours. */
  | { t: "chestGrant"; chestId: string; items: ItemInstance[] };
