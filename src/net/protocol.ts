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
}

export interface PeerState {
  playerId: string;
  name: string;
  position: Vec3Like;
  yaw: number;
  staffId: string;
}

export type ClientMsg =
  | { t: "hello"; name: string }
  | { t: "enterFloor"; floor: number }
  | { t: "leaveDungeon" }
  | { t: "state"; position: Vec3Like; yaw: number; staffId: string }
  | { t: "castAbility"; abilityId: string; origin: Vec3Like; dir: Vec3Like };

export type ServerMsg =
  | { t: "welcome"; playerId: string }
  | { t: "floorAssigned"; assignment: FloorAssignment }
  | { t: "peerJoined"; peer: PeerState }
  | { t: "peerLeft"; playerId: string }
  | { t: "snapshot"; peers: PeerState[] }
  | { t: "peerCast"; playerId: string; abilityId: string; origin: Vec3Like; dir: Vec3Like };
