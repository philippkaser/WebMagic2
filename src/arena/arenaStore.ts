import { create } from "zustand";
import { netBus } from "../net/bus";
import type { ArenaAssignment } from "../net/protocol";
import { ARENA, type ArenaRecord, type ArenaScore } from "./rules";

/** The Proving Ground as this client sees it: our place at the obelisk, the
 * bout we're in (its scoreboard, who's fallen, how it ended) and our record
 * with Varr. The relay is the truth (server/relay.ts); this mirrors it. Pure
 * state — the journeys in and out live in arenaFlow.ts, the hall in
 * ArenaFloor.tsx, the boards in ui3d/layers/arena. */

export interface FeedLine {
  id: number;
  victim: string;
  by: string | null;
  at: number;
}

export interface Bout extends ArenaAssignment {
  board: ArenaScore[];
  /** Who's down, until when (performance.now() ms). */
  fallen: Record<string, number>;
  /** The latest falls, newest last. */
  feed: FeedLine[];
  /** Set once the bout is over: the final board, best first. */
  ended: { board: ArenaScore[]; winner: string | null; at: number } | null;
}

export interface ArenaState {
  /** Our place in line at the obelisk (null: not waiting). */
  queue: { position: number; waiting: number } | null;
  bout: Bout | null;
  record: ArenaRecord | null;
}

export const useArena = create<ArenaState>(() => ({ queue: null, bout: null, record: null }));

/** In a bout (from the moment it's dealt until we're home again). */
export function inArena(): boolean {
  return useArena.getState().bout !== null;
}

/** A wizard in the bout who's yielded and not yet risen. */
export function isFallen(id: string, now = performance.now()): boolean {
  const until = useArena.getState().bout?.fallen[id];
  return until !== undefined && until > now;
}

export function leaveBout(): void {
  useArena.setState({ bout: null });
}

const FEED_KEEP = 5;
/** How long a fallen wizard stays down before rising (the server's rule). */
const RISE_MS = ARENA.respawnMs;
let feedId = 1;

netBus.on("arenaQueue", (q) => useArena.setState({ queue: q.position > 0 ? q : null }));

netBus.on("arenaAssigned", (a) => {
  useArena.setState({
    queue: null,
    bout: {
      ...a,
      board: a.members.map((m) => ({ id: m.id, name: m.name, kills: 0, falls: 0, scoredAt: 0 })),
      fallen: {},
      feed: [],
      ended: null,
    },
  });
});

netBus.on("arenaScore", ({ board, fell }) => {
  const bout = useArena.getState().bout;
  if (!bout) return;
  const now = performance.now();
  useArena.setState({
    bout: {
      ...bout,
      board,
      fallen: { ...bout.fallen, [fell.victim]: now + RISE_MS },
      feed: [...bout.feed, { id: feedId++, victim: fell.victim, by: fell.by, at: now }].slice(-FEED_KEEP),
    },
  });
});

netBus.on("arenaEnded", ({ board, winner, record }) => {
  const bout = useArena.getState().bout;
  useArena.setState({ record, ...(bout ? { bout: { ...bout, board, ended: { board, winner, at: performance.now() } } } : {}) });
});

netBus.on("serverSave", (save) => {
  if (save.arena) useArena.setState({ record: save.arena });
});

// Dev-only hook for end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__arena = useArena;
}
