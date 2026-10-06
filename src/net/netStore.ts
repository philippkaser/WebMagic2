import { create } from "zustand";
import { SERVER_HOST_ID } from "./protocol";

/** Reactive networking state, updated by the GameSession. Components use it
 * to switch between simulating (authority) and replicating (everyone else). */
export interface NetState {
  playerId: string;
  /** Simulation host of the current floor instance. */
  hostId: string;
  /** Host generation — bumps on migration. */
  epoch: number;
  mode: "connecting" | "online" | "offline";
  /** Floor-mates by id → display name (includes us once assigned). */
  roster: Record<string, string>;
}

export const useNet = create<NetState>(() => ({
  playerId: "",
  hostId: "",
  epoch: 0,
  mode: "connecting",
  roster: {},
}));

/** Players on this floor including us. */
export function floorPlayerCount(s: NetState): number {
  return Math.max(1, Object.keys(s.roster).length);
}

/** Are we the simulation authority? Offline single-player is always host, so
 * the host code path is exactly the classic single-player path. */
export function isHost(): boolean {
  return selectIsHost(useNet.getState());
}

/** Is the current floor hosted by the server (server/floorHost.ts)? Then
 * every wizard is a replica, and the effects of each wizard's own spells
 * are that wizard's to report. */
export function isServerHosted(): boolean {
  const s = useNet.getState();
  return s.mode === "online" && s.hostId === SERVER_HOST_ID;
}

/** Does this machine apply the entity effects of a spell cast by `casterId`
 * (its pull, its blast)? The floor's host does on a wizard-hosted floor —
 * it sees every hole — but on a server-hosted floor the caster does, and its
 * hits travel as commands like every other spell's. */
export function appliesSpellEffects(casterId: string, localId: string): boolean {
  return isServerHosted() ? casterId === localId : isHost();
}

/** Reactive variant for components that must re-render on host migration. */
export function selectIsHost(s: NetState): boolean {
  return s.mode !== "online" || s.hostId === "" || s.hostId === s.playerId;
}
