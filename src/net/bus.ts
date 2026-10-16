import { Emitter } from "../core/events";
import type { AuthErrorReason } from "./credentials";
import type { PartyError } from "./party";
import type { ArenaAssignment, CampAssignment, FloorAssignment, MemberInfo, PartyInfo, ServerMsg, ServerSave } from "./protocol";

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
  /** `name` is the display name they had (already gone from the roster). */
  peerLeft: { playerId: string; name: string };
  hostChanged: { hostId: string; epoch: number };
  /** Server asked us (the host) to bring a late joiner up to date. */
  syncRequest: { playerId: string };
  /** We left the dungeon (banked, died, or quit) — floor peers are gone. */
  leftDungeon: undefined;
  /** The server's authoritative save arrived (login or bank ack). */
  serverSave: ServerSave;
  /** The connection dropped and was re-established with a fresh identity. */
  reconnected: undefined;
  /** The server worked a craft (or refused it). */
  crafted: Extract<ServerMsg, { t: "crafted" }>;
  /** The ledger answered: who this connection plays as now, or why not
   * (state/account.ts turns it into the title screen's ledger). */
  ledger: LedgerEvent;
  /** We took a seat in the camp (social/ reads who's here). */
  camp: CampAssignment;
  chat: { from: string; name: string; text: string; party: boolean };
  party: PartyInfo | null;
  partyInvited: { from: string; name: string };
  partyError: PartyError;
  /** The Proving Ground (arena/arenaStore.ts): the line at the obelisk, a
   * bout dealt (arena/arenaFlow.ts takes it or turns it down), a fall
   * scored, the bout's end. */
  arenaQueue: { position: number; waiting: number };
  arenaAssigned: ArenaAssignment;
  arenaBegin: { fightAt: number; endsAt: number };
  arenaScore: Extract<ServerMsg, { t: "arenaScore" }>;
  arenaEnded: Extract<ServerMsg, { t: "arenaEnded" }>;
}

export type LedgerEvent =
  | { kind: "guest" }
  /** `name` is the display name the server holds (absent on a resume). */
  | { kind: "member"; username: string; name?: string }
  | { kind: "signedOut" }
  | { kind: "refused"; reason: AuthErrorReason; retryAfterMs?: number };

export const netBus = new Emitter<NetBusEvents>();
