/** The Proving Ground's rules — Varr's, and Varr keeps the score. Pure: the
 * relay runs them (it owns the clock and the scoreboard), the client shows
 * them. Duels to the yield, not the death: a wizard who falls rises again at
 * a spawn stone a few breaths later, and loses nothing.
 *
 * A bout ends when someone reaches KILLS_TO_WIN or when the sands run out;
 * the most yields taken wins (a tie goes to whoever fell least, then to
 * whoever reached the score first). */

export const ARENA = {
  minPlayers: 2,
  maxPlayers: 6,
  /** A bout's length, ms. */
  durationMs: 180_000,
  killsToWin: 10,
  /** How long a fallen wizard waits before rising again, ms. */
  respawnMs: 3000,
  /** The queue waits this long for more challengers once two are ready. */
  gatherMs: 8000,
  /** After the bout, the hall holds everyone this long before home. */
  afterMs: 6000,
} as const;

export interface ArenaScore {
  id: string;
  name: string;
  kills: number;
  falls: number;
  /** When they last scored (ties go to the earlier; 0 = never — and a
   * wizard who never scored only ties with others who never did). */
  scoredAt: number;
}

export type Scoreboard = ArenaScore[];

export function newScoreboard(players: readonly { id: string; name: string }[]): Scoreboard {
  return players.map((p) => ({ id: p.id, name: p.name, kills: 0, falls: 0, scoredAt: 0 }));
}

/** A wizard fell; `killer` (if any, and not themself) takes the yield. */
export function recordFall(board: Scoreboard, victim: string, killer: string | null, now: number): Scoreboard {
  return board.map((s) => {
    if (s.id === victim) return { ...s, falls: s.falls + 1 };
    if (killer && killer !== victim && s.id === killer) return { ...s, kills: s.kills + 1, scoredAt: now };
    return s;
  });
}

/** Best first: most kills, then fewest falls, then who got there first. */
export function ranked(board: Scoreboard): Scoreboard {
  return [...board].sort((a, b) => b.kills - a.kills || a.falls - b.falls || a.scoredAt - b.scoredAt);
}

/** Is the bout over at `now` (started at `startedAt`)? */
export function boutOver(board: Scoreboard, startedAt: number, now: number): boolean {
  return now - startedAt >= ARENA.durationMs || board.some((s) => s.kills >= ARENA.killsToWin);
}

/** The winner's id (null if nobody took a single yield). Only wizards in
 * `present` can win, when given (a deserter keeps their row, not the bout). */
export function winnerOf(board: Scoreboard, present?: ReadonlySet<string>): string | null {
  const best = ranked(present ? board.filter((s) => present.has(s.id)) : board)[0];
  return best && best.kills > 0 ? best.id : null;
}

/** A wizard's standing with Varr, kept on their account. */
export interface ArenaRecord {
  bouts: number;
  wins: number;
  /** Yields taken, all bouts together. */
  yields: number;
}
