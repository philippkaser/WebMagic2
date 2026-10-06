import { resolveItem } from "../items/catalog";

/** The rules of a run — pure, shared by the client (portal UI, HUD, store)
 * and the server (entry validation, banking), so the two can never disagree.
 *
 * A run in three sentences:
 *  1. THE WEIGHING — the village portal reads the resonance of the gear you
 *     wear and casts you to the depth where that weight belongs. You don't
 *     pick a floor; your gear does.
 *  2. THE TITHE OF FIVE — the deep only lets go once you've given it five
 *     floors. From your fifth floor on, every floor's way-home portal opens.
 *  3. Die before you get home and everything you found this run stays below
 *     (on a shared floor, in a grave anyone may plunder). */

export const RUN = {
  /** Floors a run must play before any way-home portal opens. */
  floorsBeforeExit: 5,
  /** Entry depth per point of gear level. Slightly below 1, so the portal
   * drops you a little shallower than your gear was found — the first floor
   * of a run is a warm-up, the fifth is where it bites. */
  entryDepthPerLevel: 0.85,
  /** Deepest entry the portal will ever cast anyone to: a run must still be
   * able to play its five floors before the bottom. */
  maxEntryFloor: 95,
} as const;

/** The four gear slots that resonate. The staff counts like any other piece;
 * an empty slot counts as zero, so a half-dressed wizard is cast shallower. */
export const RESONANT_SLOTS = 4;

/** Gear level — the mean item level across the four gear slots (empty = 0).
 * Takes plain item ids so the server can evaluate wire equipment directly.
 * Unknown/corrupt ids resonate as nothing. */
export function gearLevel(gearIds: readonly (string | null | undefined)[]): number {
  let total = 0;
  for (const id of gearIds.slice(0, RESONANT_SLOTS)) {
    if (!id) continue;
    try {
      const item = resolveItem(id);
      if (item.def.slot !== "consumable") total += item.level;
    } catch {
      // A forged or retired id carries no weight.
    }
  }
  return total / RESONANT_SLOTS;
}

/** The floor the Weighing casts a wizard of this gear level to. */
export function entryFloorFor(level: number): number {
  const floor = Math.round(Math.max(0, level) * RUN.entryDepthPerLevel);
  return Math.max(1, Math.min(RUN.maxEntryFloor, floor));
}

/** Convenience: equipment ids → entry floor. */
export function entryFloorForGear(gearIds: readonly (string | null | undefined)[]): number {
  return entryFloorFor(gearLevel(gearIds));
}

/** Floors still owed before the way home opens (0 = it's open). `floorsPlayed`
 * counts the floor you're standing on. */
export function floorsUntilExit(floorsPlayed: number): number {
  return Math.max(0, RUN.floorsBeforeExit - Math.max(0, floorsPlayed));
}

/** May a wizard who has played this many floors this run walk home? */
export function canLeave(floorsPlayed: number): boolean {
  return floorsUntilExit(floorsPlayed) === 0;
}

// ── The deep's pace ──────────────────────────────────────────────────────────

/** Nobody goes deeper faster than a fast human walks. Every floor a wizard
 * enters — a fresh run through the gate, or one floor deeper — spends one
 * token; tokens come back one per `msPerFloor`, and a wizard holds at most
 * `burst`. A lucky chain of warp runes never waits, but a script that skips
 * floors does: the server holds an early floor request back until a token is
 * due (server/relay.ts), and the wizard just hovers a little longer in the
 * rift. Re-entering the floor you're on (a reconnect) is free. */
export interface PaceRules {
  msPerFloor: number;
  burst: number;
}

export const PACE: PaceRules = { msPerFloor: 15_000, burst: 3 };

/** One account's tokens as of `at` (server time, ms). Absent = a full burst. */
export interface PaceState {
  tokens: number;
  at: number;
}

function tokensAt(state: PaceState | undefined, now: number, rules: PaceRules): number {
  if (!state) return rules.burst;
  return Math.min(rules.burst, state.tokens + Math.max(0, now - state.at) / rules.msPerFloor);
}

/** How long until another floor may be entered (0 = now). */
export function paceWaitMs(state: PaceState | undefined, now: number, rules: PaceRules = PACE): number {
  const held = tokensAt(state, now, rules);
  // (The epsilon keeps a wait of exactly the computed length from coming
  // back 1 ms short to float rounding.)
  return held >= 1 - 1e-9 ? 0 : Math.ceil((1 - held) * rules.msPerFloor);
}

/** Spend a token on entering a floor (callers check paceWaitMs first). */
export function spendPace(state: PaceState | undefined, now: number, rules: PaceRules = PACE): PaceState {
  return { tokens: tokensAt(state, now, rules) - 1, at: now };
}
