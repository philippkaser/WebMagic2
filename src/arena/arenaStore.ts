import { create } from "zustand";
import { netBus } from "../net/bus";
import { netClock } from "../net/clock";
import type { ArenaAssignment } from "../net/protocol";
import type { Phase } from "../state/gameStore";
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
  /** When Varr's count ends and the fighting starts (server time, ms) —
   * null while the hall gathers. */
  fightAt: number | null;
  /** When we told the hall we'd arrived (server time, ms; null: not yet). */
  readyAt: number | null;
}

export interface ArenaState {
  /** Our place in line at the obelisk (null: not waiting). */
  queue: { position: number; waiting: number } | null;
  bout: Bout | null;
  record: ArenaRecord | null;
  /** We stepped back from the line and the relay hasn't answered yet: a bout
   * dealt in that moment was dealt to somebody who'd already left it. */
  steppingBack: boolean;
}

export const useArena = create<ArenaState>(() => ({ queue: null, bout: null, record: null, steppingBack: false }));

/** In a bout (from the moment it's dealt until we're home again). */
export function inArena(): boolean {
  return useArena.getState().bout !== null;
}

/** Is the fighting on? Not while the hall gathers or Varr counts it in, and
 * not once it's over: until then, and after, nobody can be harmed. */
export function boutLive(bout: Bout | null, serverNow = netClock.serverNow()): boolean {
  return !!bout && !bout.ended && bout.fightAt !== null && serverNow >= bout.fightAt;
}

/** A wizard in the bout who's yielded and not yet risen. */
export function isFallen(id: string, now = performance.now()): boolean {
  const until = useArena.getState().bout?.fallen[id];
  return until !== undefined && until > now;
}

export function leaveBout(): void {
  useArena.setState({ bout: null });
}

/** Can a wizard who stands where `phase` puts them take a bout just dealt?
 * Only one who's home (in the camp, or reading the Weighing at its gate)
 * and on no journey. One already on the road down (the gate's ENTER, an
 * enterFloor that crossed the deal) turns it down, or they'd end up in the
 * hall and on a floor at once. */
export function canTakeBout(phase: Phase, traveling: boolean): boolean {
  return !traveling && (phase === "village" || phase === "weighing");
}

/** A bout dealt and taken (arenaFlow.ts decides): out of the line, a fresh
 * board. */
export function takeBout(a: ArenaAssignment): void {
  useArena.setState({
    queue: null,
    bout: {
      ...a,
      board: a.members.map((m) => ({ id: m.id, name: m.name, kills: 0, falls: 0, scoredAt: 0 })),
      fallen: {},
      feed: [],
      ended: null,
      fightAt: null,
      readyAt: null,
    },
  });
}

const FEED_KEEP = 5;
/** How long a fallen wizard stays down before rising (the server's rule). */
const RISE_MS = ARENA.respawnMs;
let feedId = 1;

netBus.on("arenaQueue", (q) =>
  useArena.setState((s) => ({
    queue: q.position > 0 ? q : null,
    // The relay's answer to a step back is "position 0": the moment's over.
    steppingBack: s.steppingBack && q.position > 0,
  })),
);

// The line went with the dropped connection: the relay lets go of whoever
// disconnects, and we come back as somebody new. Nobody's holding our place
// at the obelisk any more.
netBus.on("reconnected", () => useArena.setState({ queue: null, steppingBack: false }));

netBus.on("arenaBegin", ({ fightAt, endsAt }) => {
  const bout = useArena.getState().bout;
  if (bout) useArena.setState({ bout: { ...bout, fightAt, endsAt } });
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
