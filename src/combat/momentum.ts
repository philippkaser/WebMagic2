/** Momentum: kills chained close together make the game cheer. Each kill
 * within MOMENTUM.window of the last climbs the kill chime one step up a
 * pentatonic scale; a double, a triple, a rampage burns a rune word beside
 * the aim; and each chained kill pours a little mana back, so aggression
 * feeds itself. The staff burns hotter while the streak is alive.
 *
 * Credit is the host's: only kills whose death note names the local wizard
 * (`enemyKilled.mine`) count. But the chime plays the instant the killing
 * blow lands — before the host's word can arrive — so a kill we SAW land is
 * held as `pending` for a moment, and the chime's step counts it, as long
 * as the credit (or someone else's) hasn't come back yet.
 *
 * Pure; the caller passes the time (seconds). */

export const MOMENTUM = {
  /** A kill within this long of the last one chains. */
  window: 1.2,
  /** A kill we saw land waits this long for the host's word. */
  pendingFor: 1,
  /** Heat holds this long after the last kill, then cools over `cool`. */
  hold: 2.5,
  cool: 1,
  /** Heat each kill adds (0…1). */
  heatPerKill: 0.25,
} as const;

/** Semitones of the major pentatonic, two octaves: the chime's climb. */
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;

/** Rune words, by chain length. */
const CALLOUTS: Readonly<Record<number, string>> = {
  2: "DOUBLE",
  3: "TRIPLE",
  4: "RAMPAGE",
  6: "MASSACRE",
  9: "CATACLYSM",
};

const PENDING_SLOTS = 8;

export interface Momentum {
  /** Credited kills in the current chain. */
  chain: number;
  lastCredit: number;
  /** Heat at the last kill, and when that was. */
  heat: number;
  heatAt: number;
  /** Kills we saw land, waiting for credit. */
  pendingIds: string[];
  pendingAt: number[];
}

export function createMomentum(): Momentum {
  return {
    chain: 0,
    lastCredit: -Infinity,
    heat: 0,
    heatAt: -Infinity,
    pendingIds: new Array<string>(PENDING_SLOTS).fill(""),
    pendingAt: new Array<number>(PENDING_SLOTS).fill(-Infinity),
  };
}

function liveChain(m: Momentum, now: number): number {
  return now - m.lastCredit <= MOMENTUM.window ? m.chain : 0;
}

function livePending(m: Momentum, now: number): number {
  let n = 0;
  for (let i = 0; i < PENDING_SLOTS; i++) if (m.pendingIds[i] !== "" && now - m.pendingAt[i]! <= MOMENTUM.pendingFor) n++;
  return n;
}

/** The chime's step for a kill landing now (0 = the first in a chain),
 * counting kills still waiting on the host. */
export function chimeStep(m: Momentum, now: number): number {
  return Math.min(PENTATONIC.length - 1, liveChain(m, now) + livePending(m, now));
}

/** Pitch ratio of a chime step. */
export function stepRatio(step: number): number {
  const s = PENTATONIC[Math.max(0, Math.min(PENTATONIC.length - 1, Math.floor(step)))]!;
  return 2 ** (s / 12);
}

/** We saw a killing blow land on `id`: hold it until the host's word. */
export function predictKill(m: Momentum, now: number, id: string): void {
  let slot = 0;
  for (let i = 0; i < PENDING_SLOTS; i++) {
    if (m.pendingIds[i] === id) return;
    if (m.pendingAt[i]! < m.pendingAt[slot]!) slot = i;
  }
  m.pendingIds[slot] = id;
  m.pendingAt[slot] = now;
}

function forget(m: Momentum, id: string): boolean {
  for (let i = 0; i < PENDING_SLOTS; i++) {
    if (m.pendingIds[i] === id) {
      m.pendingIds[i] = "";
      m.pendingAt[i] = -Infinity;
      return true;
    }
  }
  return false;
}

export interface KillReward {
  /** The chain's length with this kill (1 = a lone kill). */
  multi: number;
  /** The chime's step for it. */
  step: number;
  /** A rune word to burn, or null. */
  callout: string | null;
  /** Mana poured back. */
  mana: number;
}
const reward: KillReward = { multi: 0, step: 0, callout: null, mana: 0 };

/** Mana a kill pours back at chain length `multi`: a sip for a lone kill,
 * more the longer the chain, capped. */
export function manaFor(multi: number): number {
  return multi <= 1 ? 2 : Math.min(12, 2 + multi * 2);
}

/** The host says creature `id` died, `mine` if by our hand. Credits a kill
 * of ours (one scratch reward — read it at once); someone else's just
 * clears it from pending and returns null. */
export function creditKill(m: Momentum, now: number, id: string, mine: boolean): KillReward | null {
  forget(m, id);
  if (!mine) return null;
  m.chain = liveChain(m, now) + 1;
  m.lastCredit = now;
  m.heat = Math.min(1, heatAt(m, now) + MOMENTUM.heatPerKill);
  m.heatAt = now;
  reward.multi = m.chain;
  reward.step = Math.min(PENTATONIC.length - 1, m.chain - 1);
  reward.callout = CALLOUTS[m.chain] ?? null;
  reward.mana = manaFor(m.chain);
  return reward;
}

/** How hot the staff burns from the streak, 0…1. */
export function heatAt(m: Momentum, now: number): number {
  if (!(m.heat > 0)) return 0;
  const since = now - m.heatAt;
  if (since <= MOMENTUM.hold) return m.heat;
  return Math.max(0, m.heat * (1 - (since - MOMENTUM.hold) / MOMENTUM.cool));
}
