/** Wire protocol shared between client and (future) authoritative server.
 *
 * Designed for an authoritative-server model: clients send inputs, the server
 * simulates each floor instance and broadcasts snapshots. The local loopback
 * transport implements the same protocol so single-player and online play run
 * identical game code. See docs/ARCHITECTURE.md for the scaling plan.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
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
}

/** Position (+ optional health) of one replicated entity, host → replicas. */
export interface EntitySnap {
  id: string;
  p: [number, number, number];
  hp?: number;
}

/** Discrete world events, host → replicas (except pickup *requests*, which
 * flow replica → host as takeOrb). `silent` marks late-join catch-up: apply
 * the state change without death/break VFX. */
export type EntityEvent =
  | { k: "death"; id: string; silent?: boolean }
  | { k: "propBroken"; id: string; silent?: boolean }
  | { k: "orbSpawn"; orbId: string; defId: string; pos: [number, number, number] }
  | { k: "orbTaken"; orbId: string; by: string }
  | { k: "treasureTaken"; by: string; silent?: boolean }
  | {
      k: "enemyCast";
      origin: [number, number, number];
      velocity: [number, number, number];
      damage: number;
      color: string;
      size: number;
      blastRadius: number;
      blastImpulse: number;
    }
  | {
      k: "boom";
      pos: [number, number, number];
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
}

/** Authoritative floor state the host sends to a late joiner so they don't
 * see a pristine "ghost" floor where the host already fought. */
export interface FloorSyncState {
  deadIds: string[];
  ents: EntitySnap[];
  orbs: { orbId: string; defId: string; pos: [number, number, number] }[];
  treasureTaken: boolean;
}

export type ClientMsg =
  | { t: "hello"; name: string }
  | { t: "enterFloor"; floor: number }
  | { t: "leaveDungeon" }
  | { t: "state"; position: Vec3Like; yaw: number; staffId: string }
  | { t: "castAbility"; abilityId: string; origin: Vec3Like; dir: Vec3Like }
  // Host only — dropped by the server if sent by anyone else:
  | { t: "entity"; ents: EntitySnap[] }
  | { t: "entityEvent"; ev: EntityEvent }
  | { t: "stateSync"; to: string; state: FloorSyncState }
  // Replica → host:
  | { t: "hit"; targetId: string; damage: number; impulse: Vec3Like }
  | { t: "takeOrb"; orbId: string };

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
  | { t: "stateSync"; state: FloorSyncState };
