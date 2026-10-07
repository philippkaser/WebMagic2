import type { Rapier } from "../src/sim/floorPhysics";
import { FloorHost, type FloorHostIO, type FloorHostOptions, type FloorInstance, type FloorLedger } from "./floorHost";

/** Who hosts a floor — the one decision that picks between a wizard's
 * browser and the server as a floor's authority. The router asks it; it
 * never reads gameplay itself.
 *
 *   "never"  — every floor is hosted by its oldest wizard (the classic
 *              model: cheapest for the server, trusts that browser).
 *   "shared" — a floor is handed to the server the moment a second wizard
 *              is seated on it: nobody can be cheated on a floor where they
 *              are alone, and nobody hosts a floor a stranger shares. The
 *              default.
 *   "always" — the server hosts every floor from its first wizard (PvP
 *              arenas, or a server with cores to spare).
 *
 * Once the server hosts a floor it keeps it until the floor is gone: a
 * floor can't be taken back by everyone else leaving. */

export type HostingPolicy = "never" | "shared" | "always";

/** A floor hosted server-side, as the router sees it (server/floorHost.ts). */
export interface HostedFloor {
  readonly isHost: boolean;
  /** A gameplay envelope from a member — its poses and commands, and while
   * still a replica, the current host's authority traffic. */
  receive(from: string, ch: string, data: unknown, serverTime: number): void;
  joined(playerId: string): void;
  left(playerId: string): void;
  /** A late joiner needs the floor's state. */
  sync(playerId: string): void;
  /** A wizard on this floor drank a draught (the ledger checked it). */
  drank(playerId: string, effect: { heal?: number; mana?: number }): void;
  promote(): void;
  tick(dt: number): void;
  free(): void;
}

export interface FloorHosting {
  /** Should this instance be hosted server-side, now that it holds
   * `players` wizards? */
  wants(inst: { floor: number; players: number }): boolean;
  create(inst: FloorInstance, ledger: FloorLedger, io: FloorHostIO): HostedFloor;
}

export function parseHostingPolicy(raw: string | undefined): HostingPolicy {
  return raw === "never" || raw === "always" ? raw : "shared";
}

/** Server-side floor hosts by `policy`, simulated with Rapier `R`
 * (initialized by the caller). */
export function serverHosting(R: Rapier, policy: HostingPolicy, opts: FloorHostOptions = {}): FloorHosting {
  return {
    wants: ({ players }) => policy === "always" || (policy === "shared" && players >= 2),
    create: (inst, ledger, io) => new FloorHost(R, inst, ledger, io, opts),
  };
}
