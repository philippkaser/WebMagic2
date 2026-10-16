import { ACT } from "./anticipation";

/** The Warden's heart. It burns inside an opaque shell, and a precision hit
 * on it is the hardest-earned crit there is (weapons/precision: CRIT.maxMult)
 * — so it's only there to hit while the shell stands open: as the Warden
 * gathers itself (risen for a slam, braced for a charge) and for a breath
 * after it lets go. The rest of the fight the heart is shut, and fire at its
 * middle is plain fire.
 *
 * Driven by the act this client shows (anticipation.ts — the host's brain
 * on the host, the replicated act everywhere else), because a crit is
 * decided on the shooter's machine: every wizard gets the same window, on
 * the same tell they can see. Pure; tested in wardenCore.test.ts. Times are
 * seconds on the caller's clock. */

export const CORE = {
  /** The shell stays open this long after the slam or brace ends (s). */
  linger: 0.5,
  /** A precision hit's multiplier while it's open. */
  mult: 2,
} as const;

export interface CoreGate {
  /** Open until then (s); −∞ = it hasn't opened yet. */
  until: number;
}

export function createCoreGate(): CoreGate {
  return { until: -Infinity };
}

/** Does act `code` open the shell? Only the wind-ups that heat the heart. */
export function opensCore(code: number): boolean {
  return code === ACT.slam || code === ACT.brace;
}

/** One frame of the act this client shows: an opening act holds the shell
 * open, and it lingers open CORE.linger after. */
export function stepCore(g: CoreGate, code: number, now: number): void {
  if (opensCore(code)) g.until = now + CORE.linger;
}

/** Is the heart there to hit at `now`? */
export function coreOpen(g: CoreGate, now: number): boolean {
  return now < g.until;
}

/** How much of the linger is left, 1 → 0 (0 once shut): the act's heat
 * bleeding out of the shell as it closes. */
export function coreLinger(g: CoreGate, now: number): number {
  const left = (g.until - now) / CORE.linger;
  return left > 1 ? 1 : left > 0 ? left : 0;
}
