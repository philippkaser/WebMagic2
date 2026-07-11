import { create } from "zustand";

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

/** Reactive variant for components that must re-render on host migration. */
export function selectIsHost(s: NetState): boolean {
  return s.mode !== "online" || s.hostId === "" || s.hostId === s.playerId;
}
