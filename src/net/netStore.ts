import { create } from "zustand";

/** Reactive networking state, updated by the GameSession. Components use it
 * to switch between simulating (host) and replicating (everyone else). */
export interface NetState {
  playerId: string;
  /** Simulation host of the current floor instance. */
  hostId: string;
  mode: "connecting" | "online" | "offline";
  /** Players on this floor including us. */
  floorPlayers: number;
}

export const useNet = create<NetState>(() => ({
  playerId: "",
  hostId: "",
  mode: "connecting",
  floorPlayers: 1,
}));

/** Are we the simulation authority? Offline single-player is always host, so
 * the host code path is exactly the classic single-player path. */
export function isHost(): boolean {
  const s = useNet.getState();
  return s.mode !== "online" || s.hostId === "" || s.hostId === s.playerId;
}

/** Reactive variant for components that must re-render on host migration. */
export function selectIsHost(s: NetState): boolean {
  return s.mode !== "online" || s.hostId === "" || s.hostId === s.playerId;
}
