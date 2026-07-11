import { Emitter } from "../core/events";
import type { FloorAssignment, MemberInfo } from "./protocol";

/** Internal networking event hub. The session publishes connection/relay
 * events here; channels, entities and players subscribe. Keeping this
 * separate from the gameplay bus (core/events) means net internals never
 * leak into UI code, and there are no import cycles inside net/. */

export interface NetBusEvents extends Record<string, unknown> {
  /** Incoming gameplay envelope from a floor-mate. */
  envelope: { ch: string; from: string; epoch: number; serverTime: number; data: unknown };
  /** We were assigned to a floor instance (fresh join or reconnect). */
  assigned: FloorAssignment;
  peerJoined: MemberInfo;
  peerLeft: { playerId: string };
  hostChanged: { hostId: string; epoch: number };
  /** Server asked us (the host) to bring a late joiner up to date. */
  syncRequest: { playerId: string };
  /** We left the dungeon (banked, died, or quit) — floor peers are gone. */
  leftDungeon: undefined;
  /** The connection dropped and was re-established with a fresh identity. */
  reconnected: undefined;
}

export const netBus = new Emitter<NetBusEvents>();
