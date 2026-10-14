/** How hard a blow lands on the eye: the hitstop (a few frozen frames of the
 * picture — never the physics, see core/presentTime) and the kill punch on
 * the post chain (exposure pops, the lens splits colour).
 *
 * A heavy hit catches the frame for a blink, a kill for longer, a precision
 * kill longer still, the Warden's death for a quarter second. A beam's or a
 * flame's ticks never stop it: they'd stutter the stream. Stops that come
 * hard on each other's heels (a flame sweeping a nest of slimes) are cut
 * short, so the picture never stammers.
 *
 * Pure; the caller passes the time (seconds). */

export const STOP = {
  /** A heavy shot (rail, lance, shell, blast) that didn't kill. */
  heavy: 0.04,
  /** A precision hit that didn't kill. */
  crit: 0.05,
  kill: 0.08,
  /** A stream's tick that happened to kill. */
  tickKill: 0.04,
  critKill: 0.12,
  /** The Warden's death. */
  boss: 0.22,
  /** A shot this heavy (0…1) or more is heavy… */
  heavyWeight: 0.6,
  /** …and lighter than this, a tick. */
  tickWeight: 0.2,
  /** A stop starting within this long of the last one's end is halved. */
  refractory: 0.15,
} as const;

export interface Blow {
  /** The shot's heft, 0…1 (weapons/castFeel hitWeight). */
  weight: number;
  killed: boolean;
  crit: boolean;
  /** The Warden. */
  boss: boolean;
}

/** Seconds of hitstop a blow earns, before the refractory rule. */
export function hitstopFor(b: Blow): number {
  if (b.killed) {
    if (b.boss) return STOP.boss;
    if (b.crit) return STOP.critKill;
    return b.weight < STOP.tickWeight ? STOP.tickKill : STOP.kill;
  }
  if (b.weight < STOP.tickWeight) return 0;
  if (b.crit) return STOP.crit;
  return b.weight >= STOP.heavyWeight ? STOP.heavy : 0;
}

export interface Stopper {
  /** When the last stop ends. */
  endsAt: number;
}

export function createStopper(): Stopper {
  return { endsAt: -Infinity };
}

/** Ask for a stop of `seconds` now. Returns how long it should really be:
 * halved while one runs or has only just ended (the Warden's never is). */
export function requestStop(s: Stopper, now: number, seconds: number, boss = false): number {
  if (seconds <= 0) return 0;
  const out = !boss && now < s.endsAt + STOP.refractory ? seconds * 0.5 : seconds;
  s.endsAt = Math.max(s.endsAt, now + out);
  return out;
}

/** The kill punch's strength, 0…1: a kill pops, a precision kill or a big
 * overkill pops harder, the Warden fills it. */
export function punchFor(crit: boolean, boss: boolean, over: number): number {
  if (boss) return 1;
  return Math.min(1, 0.5 + (crit ? 0.25 : 0) + Math.min(1, Math.max(0, over)) * 0.25);
}
